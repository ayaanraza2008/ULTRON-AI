import express from "express";
import { isIP } from "node:net";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = new Set([
  "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4",
  "audio/webm", "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac",
  "audio/opus", "audio/x-m4a", "video/mp4"
]);
const OUTPUT_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);

function bounded(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (version === 6) {
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    return first < 0x2000 || first > 0x3fff ||
      host.startsWith("2001:db8:") || host.startsWith("2001:0:") || host.startsWith("2002:");
  }
  return !host.includes(".");
}

function voiceStudioConfig(env = process.env) {
  const raw = bounded(env.VOICESTUDIO_BASE_URL, 500);
  const token = bounded(env.VOICESTUDIO_API_KEY, 2000);
  if (!raw) return { configured: false, reason: "not_configured" };
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash || url.search) return { configured: false, reason: "invalid_url" };
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    if (url.protocol === "https:") {
      if (isPrivateOrLocalHost(url.hostname)) return { configured: false, reason: "unsafe_remote_host" };
    } else if (url.protocol !== "http:" || !local) return { configured: false, reason: "https_required" };
    if (!local && !token) return { configured: false, reason: "remote_api_key_required" };
    const baseUrl = url.toString();
    return { configured: true, baseUrl: baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl, token, local };
  } catch {
    return { configured: false, reason: "invalid_url" };
  }
}

function providerHeaders(config, extra = {}) {
  return {
    Accept: "application/json",
    ...(config.token ? { Authorization: "Bearer " + config.token } : {}),
    ...extra
  };
}

async function readLimited(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("VoiceStudio response exceeded the configured size limit."), { status: 502, code: "VOICESTUDIO_RESPONSE_TOO_LARGE" });
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw Object.assign(new Error("VoiceStudio response exceeded the configured size limit."), { status: 502, code: "VOICESTUDIO_RESPONSE_TOO_LARGE" });
    }
    return buffer;
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("VoiceStudio response exceeded the configured size limit."), { status: 502, code: "VOICESTUDIO_RESPONSE_TOO_LARGE" });
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function readTextLimited(response, maxBytes) {
  const buffer = await readLimited(response, maxBytes);
  return buffer.toString("utf8");
}

async function requestJson(fetchImpl, url, config, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: providerHeaders(config, options.headers || {}),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs || 15000)
  });
  const raw = await readTextLimited(response, 1_000_000);
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    throw Object.assign(new Error("VoiceStudio returned HTTP " + response.status), { status, code: "VOICESTUDIO_UPSTREAM_FAILED" });
  }
  return data;
}

function errorResponse(res, error, operation) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return res.status(504).json({ error: { code: "VOICESTUDIO_TIMEOUT", message: operation + " timed out." } });
  }
  const status = Number(error?.status);
  return res.status(status >= 400 && status <= 599 ? status : 502).json({
    error: { code: bounded(error?.code, 80) || "VOICESTUDIO_FAILED", message: operation + " could not complete. Check VoiceStudio status and model readiness." }
  });
}

export function voiceStudioReadiness(env = process.env) {
  const config = voiceStudioConfig(env);
  return {
    configured: config.configured,
    state: config.configured ? "configured_unverified" : config.reason,
    baseUrlConfigured: Boolean(bounded(env.VOICESTUDIO_BASE_URL, 500)),
    apiKeyConfigured: Boolean(bounded(env.VOICESTUDIO_API_KEY, 2000)),
    mode: config.local ? "same_machine_local_api" : "remote_api",
    capabilities: ["text_to_speech", "voice_catalog", "speech_to_text"],
    note: config.configured
      ? "Configuration only; call the status endpoint to verify live connectivity and installed models."
      : "VoiceStudio must be installed and running. A cloud-hosted ULTRON cannot reach your PC's localhost; use the Windows companion or a secured HTTPS endpoint with an API key."
  };
}

export function createVoiceStudioRouter({ env = process.env, fetchImpl = globalThis.fetch, requireSupabaseUser }) {
  const router = express.Router();
  router.get("/integrations/voicestudio/status", requireSupabaseUser, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const config = voiceStudioConfig(env);
    if (!config.configured) return res.status(503).json({ ...voiceStudioReadiness(env), reachable: false });
    try {
      const [discovery, models] = await Promise.all([
        requestJson(fetchImpl, config.baseUrl + "/.well-known/voicestudio-speech", config, { timeoutMs: 10000 }),
        requestJson(fetchImpl, config.baseUrl + "/v1/models", config, { timeoutMs: 10000 })
      ]);
      return res.json({
        ...voiceStudioReadiness(env),
        reachable: true,
        discovery: {
          name: bounded(discovery.name || discovery.product || "VoiceStudio", 100),
          version: bounded(discovery.version, 80) || undefined
        },
        modelCount: Array.isArray(models.data) ? models.data.length : 0
      });
    } catch (error) {
      return errorResponse(res, error, "VoiceStudio connectivity check");
    }
  });

  router.get("/integrations/voicestudio/voices", requireSupabaseUser, async (_req, res) => {
    const config = voiceStudioConfig(env);
    if (!config.configured) return res.status(503).json({ error: { code: "VOICESTUDIO_NOT_CONFIGURED", message: "Configure VOICESTUDIO_BASE_URL; remote hosts also require VOICESTUDIO_API_KEY." } });
    try {
      const data = await requestJson(fetchImpl, config.baseUrl + "/v1/audio/voices", config);
      const voices = Array.isArray(data.voices) ? data.voices : Array.isArray(data.data) ? data.data : [];
      return res.json({ provider: "voicestudio", voices: voices.slice(0, 200).map(v => ({
        id: bounded(v.voice_id || v.id, 160),
        name: bounded(v.name, 160),
        language: bounded(v.language, 80) || undefined
      })).filter(v => v.id || v.name) });
    } catch (error) { return errorResponse(res, error, "VoiceStudio voice listing"); }
  });

  router.post("/integrations/voicestudio/synthesize", requireSupabaseUser, async (req, res) => {
    const config = voiceStudioConfig(env);
    if (!config.configured) return res.status(503).json({ error: { code: "VOICESTUDIO_NOT_CONFIGURED", message: "Configure VOICESTUDIO_BASE_URL; remote hosts also require VOICESTUDIO_API_KEY." } });
    const text = bounded(req.body?.text, 5000);
    const format = bounded(req.body?.format || "wav", 12).toLowerCase();
    if (!text) return res.status(400).json({ error: { code: "VOICESTUDIO_TEXT_REQUIRED", message: "Provide non-empty text up to 5,000 characters." } });
    if (!OUTPUT_FORMATS.has(format)) return res.status(400).json({ error: { code: "VOICESTUDIO_FORMAT_INVALID", message: "format must be mp3, opus, aac, flac, wav, or pcm." } });
    const payload = {
      model: bounded(req.body?.model || "tts-1", 160),
      input: text,
      voice: bounded(req.body?.voice || "default", 160),
      response_format: format,
      ...(typeof req.body?.speed === "number" && req.body.speed >= 0.25 && req.body.speed <= 4 ? { speed: req.body.speed } : {}),
      ...(bounded(req.body?.instructions, 1000) ? { instructions: bounded(req.body.instructions, 1000) } : {})
    };
    try {
      const response = await fetchImpl(config.baseUrl + "/v1/audio/speech", {
        method: "POST",
        headers: providerHeaders(config, { "Content-Type": "application/json", Accept: "audio/*" }),
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
        throw Object.assign(new Error("VoiceStudio speech synthesis failed."), { status, code: "VOICESTUDIO_UPSTREAM_FAILED" });
      }
      const audio = await readLimited(response, MAX_RESPONSE_BYTES);
      if (!audio.length) return res.status(502).json({ error: { code: "VOICESTUDIO_EMPTY_AUDIO", message: "VoiceStudio returned empty audio." } });
      return res.json({ provider: "voicestudio", format, contentType: response.headers.get("content-type") || "audio/wav", audioBase64: audio.toString("base64"), bytes: audio.byteLength });
    } catch (error) { return errorResponse(res, error, "VoiceStudio speech synthesis"); }
  });

  router.post("/integrations/voicestudio/transcribe", requireSupabaseUser, async (req, res) => {
    const config = voiceStudioConfig(env);
    if (!config.configured) return res.status(503).json({ error: { code: "VOICESTUDIO_NOT_CONFIGURED", message: "Configure VOICESTUDIO_BASE_URL; remote hosts also require VOICESTUDIO_API_KEY." } });
    const encoded = bounded(req.body?.audioBase64, Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 16);
    const mime = bounded(req.body?.mimeType || "audio/wav", 100).toLowerCase().split(";")[0];
    const language = bounded(req.body?.language, 30);
    if (!encoded || encoded.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0 || !AUDIO_TYPES.has(mime)) {
      return res.status(400).json({ error: { code: "VOICESTUDIO_AUDIO_INVALID", message: "Provide valid base64 audio (up to 8 MB) and a supported audio MIME type." } });
    }
    const audio = Buffer.from(encoded, "base64");
    if (!audio.length || audio.byteLength > MAX_AUDIO_BYTES || audio.toString("base64") !== encoded) {
      return res.status(400).json({ error: { code: "VOICESTUDIO_AUDIO_INVALID", message: "Audio encoding or size is invalid." } });
    }
    try {
      const form = new FormData();
      const extension = mime === "audio/mpeg" || mime === "audio/mp3" ? "mp3"
        : mime === "audio/webm" ? "webm" : mime === "audio/ogg" || mime === "audio/opus" ? "ogg"
        : mime === "audio/flac" || mime === "audio/x-flac" ? "flac"
        : mime === "audio/mp4" || mime === "video/mp4" || mime === "audio/x-m4a" ? "m4a"
        : mime === "audio/aac" ? "aac" : "wav";
      form.append("file", new Blob([audio], { type: mime }), "ultron-audio." + extension);
      form.append("model", bounded(req.body?.model || "whisper-1", 160));
      form.append("response_format", "json");
      if (language) form.append("language", language);
      const response = await fetchImpl(config.baseUrl + "/v1/audio/transcriptions", {
        method: "POST",
        headers: providerHeaders(config),
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(120000)
      });
      const raw = await readTextLimited(response, 1_000_000);
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { text: raw.slice(0, 10000) }; }
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
        throw Object.assign(new Error("VoiceStudio transcription failed."), { status, code: "VOICESTUDIO_UPSTREAM_FAILED" });
      }
      return res.json({ provider: "voicestudio", text: bounded(data.text || data.transcript, 20000), language: bounded(data.language, 40) || undefined });
    } catch (error) { return errorResponse(res, error, "VoiceStudio transcription"); }
  });
  return router;
}
