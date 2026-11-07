import express from "express";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = new Set([
  "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4",
  "audio/webm", "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac",
  "audio/opus", "audio/x-m4a", "video/mp4"
]);

function bounded(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function resolveFreyaConfig(env = process.env) {
  const apiKey = bounded(env.FREYA_API_KEY, 2000);
  const ttsRaw = bounded(env.FREYA_TTS_BASE_URL || "https://tts.freyavoice.ai", 500);
  const sttRaw = bounded(env.FREYA_STT_BASE_URL || "https://stt.freyavoice.ai", 500);
  const ttsBase = safeServiceBase(ttsRaw);
  const sttBase = safeServiceBase(sttRaw);
  return {
    configured: Boolean(apiKey && ttsBase && sttBase),
    apiKey,
    ttsBase,
    sttBase,
    ttsModel: bounded(env.FREYA_TTS_MODEL || "freya-tts", 120),
    ttsVoice: bounded(env.FREYA_TTS_VOICE || "leyla", 120),
    sttModel: bounded(env.FREYA_STT_MODEL || "freya-stt", 120),
    sttLanguage: bounded(env.FREYA_STT_LANGUAGE, 32)
  };
}

async function readLimited(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Freya response exceeded the configured size limit."), { status: 502, code: "FREYA_RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Freya response cannot be safely size-limited."), { status: 502, code: "FREYA_RESPONSE_UNSAFE_STREAM" });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Freya response exceeded the configured size limit."), { status: 502, code: "FREYA_RESPONSE_TOO_LARGE" });
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function errorResponse(res, error, operation) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return res.status(504).json({ error: { code: "FREYA_TIMEOUT", message: operation + " timed out." } });
  }
  const status = Number(error?.status);
  return res.status(status >= 400 && status <= 599 ? status : 502).json({
    error: { code: bounded(error?.code, 80) || "FREYA_UPSTREAM_FAILED", message: operation + " failed. Check Freya credentials, quota, and provider availability." }
  });
}

export function freyaVoiceReadiness(env = process.env) {
  const config = resolveFreyaConfig(env);
  return {
    provider: "freya",
    configured: config.configured,
    state: config.configured ? "configured_unverified" : "missing_api_key_or_invalid_endpoint",
    ttsEndpointConfigured: Boolean(config.ttsBase),
    sttEndpointConfigured: Boolean(config.sttBase),
    apiKeyConfigured: Boolean(config.apiKey),
    ttsModel: config.ttsModel,
    ttsVoice: config.ttsVoice,
    sttModel: config.sttModel,
    capabilities: ["text_to_speech", "speech_to_text"],
    note: "Configuration does not prove live provider access or Hindi/Hinglish voice quality. Run authenticated synthesis and transcription tests."
  };
}

export function createFreyaVoiceRouter({ env = process.env, fetchImpl = safePinnedFetch, requireSupabaseUser }) {
  const router = express.Router();

  function requireIntegrationOwner(req, res, next) {
    const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
    if (!ownerId) return res.status(503).json({ error: { code: "INTEGRATION_OWNER_NOT_CONFIGURED", message: "Set ULTRON_INTEGRATION_OWNER_USER_ID before enabling shared Freya API credentials." } });
    const userId = typeof req.supabaseUser?.id === "string" ? req.supabaseUser.id : "";
    if (!userId) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to use Freya voice." } });
    if (userId !== ownerId) return res.status(403).json({ error: { code: "INTEGRATION_OWNER_ONLY", message: "Freya voice is restricted to the configured ULTRON owner account." } });
    return next();
  }

  router.get("/integrations/freya/status", requireSupabaseUser, requireIntegrationOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const readiness = freyaVoiceReadiness(env);
    return res.status(readiness.configured ? 200 : 503).json({ ...readiness, reachable: null });
  });

  router.post("/integrations/freya/synthesize", requireSupabaseUser, requireIntegrationOwner, async (req, res) => {
    const config = resolveFreyaConfig(env);
    if (!config.configured) return res.status(503).json({ error: { code: "FREYA_NOT_CONFIGURED", message: "Configure FREYA_API_KEY and valid Freya TTS/STT endpoints on the backend." } });
    const input = bounded(req.body?.text, 5000);
    if (!input) return res.status(400).json({ error: { code: "FREYA_TEXT_REQUIRED", message: "Provide non-empty text up to 5,000 characters." } });
    try {
      const response = await fetchImpl(config.ttsBase + "/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json", Accept: "audio/*" },
        body: JSON.stringify({ model: config.ttsModel, voice: bounded(req.body?.voice, 120) || config.ttsVoice, input }),
        redirect: "error",
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status === 401 ? 502 : 400;
        throw Object.assign(new Error("Freya TTS upstream failed."), { status, code: response.status === 401 ? "FREYA_AUTH_FAILED" : "FREYA_TTS_UPSTREAM_FAILED" });
      }
      const audio = await readLimited(response, MAX_RESPONSE_BYTES);
      if (!audio.length) return res.status(502).json({ error: { code: "FREYA_EMPTY_AUDIO", message: "Freya returned empty audio." } });
      return res.json({ provider: "freya", format: bounded(response.headers.get("content-type"), 80) || "audio/wav", audioBase64: audio.toString("base64"), bytes: audio.byteLength });
    } catch (error) { return errorResponse(res, error, "Freya speech synthesis"); }
  });

  router.post("/integrations/freya/transcribe", requireSupabaseUser, requireIntegrationOwner, async (req, res) => {
    const config = resolveFreyaConfig(env);
    if (!config.configured) return res.status(503).json({ error: { code: "FREYA_NOT_CONFIGURED", message: "Configure FREYA_API_KEY and valid Freya TTS/STT endpoints on the backend." } });
    const encoded = bounded(req.body?.audioBase64, Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 16);
    const mime = bounded(req.body?.mimeType || "audio/wav", 100).toLowerCase().split(";")[0];
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0 || !AUDIO_TYPES.has(mime)) {
      return res.status(400).json({ error: { code: "FREYA_AUDIO_INVALID", message: "Provide valid base64 audio up to 8 MB and a supported audio MIME type." } });
    }
    const audio = Buffer.from(encoded, "base64");
    if (!audio.length || audio.byteLength > MAX_AUDIO_BYTES || audio.toString("base64") !== encoded) {
      return res.status(400).json({ error: { code: "FREYA_AUDIO_INVALID", message: "Audio encoding or size is invalid." } });
    }
    try {
      const extension = mime === "audio/mpeg" || mime === "audio/mp3" ? "mp3"
        : mime === "audio/webm" ? "webm" : mime === "audio/ogg" || mime === "audio/opus" ? "ogg"
        : mime === "audio/flac" || mime === "audio/x-flac" ? "flac"
        : mime === "audio/mp4" || mime === "video/mp4" || mime === "audio/x-m4a" ? "m4a"
        : mime === "audio/aac" ? "aac" : "wav";
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime }), "ultron-audio." + extension);
      form.append("model", config.sttModel);
      if (config.sttLanguage) form.append("language", config.sttLanguage);
      const response = await fetchImpl(config.sttBase + "/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + config.apiKey },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(60000)
      });
      const raw = await readLimited(response, 1_000_000);
      let data = {};
      try { data = raw.length ? JSON.parse(raw.toString("utf8")) : {}; } catch { data = { text: raw.toString("utf8").slice(0, 10000) }; }
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
        throw Object.assign(new Error("Freya STT upstream failed."), { status, code: response.status === 401 ? "FREYA_AUTH_FAILED" : "FREYA_STT_UPSTREAM_FAILED" });
      }
      return res.json({ provider: "freya", text: bounded(data.text || data.transcript, 20000), language: bounded(data.language, 40) || undefined });
    } catch (error) { return errorResponse(res, error, "Freya transcription"); }
  });

  return router;
}
