import express from "express";
import { buildIntegrationCatalog } from "./catalog.js";

const MAX_PROVIDER_RESPONSE = 2 * 1024 * 1024;

function configuredUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.hash) return null;
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch { return null; }
}

function cleanPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) return null;
  return path;
}

function bounded(value, max = 12000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidBase64Audio(value, maxBytes = 8 * 1024 * 1024) {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0 || value.length > Math.ceil(maxBytes * 4 / 3)) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.length <= maxBytes && decoded.toString("base64") === value;
}

async function requestJson(fetchImpl, url, { method = "GET", headers = {}, body, timeoutMs = 20000 } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  if (raw.length > MAX_PROVIDER_RESPONSE) throw Object.assign(new Error("Integration response exceeded the 2 MB limit."), { status: 502, code: "PROVIDER_RESPONSE_TOO_LARGE" });
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { responseText: raw.slice(0, 2000) }; }
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    throw Object.assign(new Error("Connected provider returned HTTP " + response.status + "."), { status, code: "PROVIDER_REQUEST_FAILED" });
  }
  return data;
}

function safeError(res, error, fallback) {
  const status = Number(error?.status);
  const code = bounded(error?.code, 80);
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return res.status(504).json({ error: { code: "INTEGRATION_TIMEOUT", message: fallback + " timed out." } });
  }
  return res.status(status >= 400 && status <= 599 ? status : 502).json({
    error: { code: code || "INTEGRATION_FAILED", message: fallback + " could not complete the request." }
  });
}

function providerHeaders(apiKey) {
  return apiKey ? { Authorization: "Bearer " + apiKey } : {};
}

export function createIntegrationRouter({ env = process.env, fetchImpl = globalThis.fetch, requireSupabaseUser }) {
  const router = express.Router();

  // Authenticated, machine-readable readiness for the future UI and agent tools.
  // This reports configuration state only; it never claims an upstream is reachable.
  router.get("/integrations/catalog", requireSupabaseUser, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      generatedAt: new Date().toISOString(),
      verification: "configuration_only",
      integrations: buildIntegrationCatalog(env)
    });
  });


  // ComfyUI has a documented queue/history API. The workflow remains server-side
  // validated JSON and never accepts a caller-supplied upstream URL.
  router.post("/integrations/comfyui/queue", requireSupabaseUser, async (req, res) => {
    const base = configuredUrl(env.COMFYUI_BASE_URL);
    const workflow = req.body?.workflow;
    if (!base) return res.status(503).json({ error: { code: "COMFYUI_NOT_CONFIGURED", message: "Configure COMFYUI_BASE_URL with a reachable ComfyUI API endpoint." } });
    if (!isObject(workflow) || !Object.keys(workflow).length || JSON.stringify(workflow).length > 1_500_000) {
      return res.status(400).json({ error: { code: "INVALID_COMFYUI_WORKFLOW", message: "workflow must be a non-empty JSON object under 1.5 MB." } });
    }
    try {
      const payload = await requestJson(fetchImpl, base + "/prompt", {
        method: "POST",
        headers: providerHeaders(env.COMFYUI_API_KEY),
        body: { prompt: workflow },
        timeoutMs: 30000
      });
      if (typeof payload?.prompt_id !== "string" || !payload.prompt_id) {
        return res.status(502).json({ error: { code: "COMFYUI_INVALID_RESPONSE", message: "ComfyUI did not return a prompt_id." } });
      }
      res.status(202).json({ provider: "comfyui", promptId: payload.prompt_id, nodeErrors: payload.node_errors || {}, status: "queued" });
    } catch (error) { safeError(res, error, "ComfyUI queue"); }
  });

  router.get("/integrations/comfyui/jobs/:promptId", requireSupabaseUser, async (req, res) => {
    const base = configuredUrl(env.COMFYUI_BASE_URL);
    const promptId = bounded(req.params.promptId, 160);
    if (!base) return res.status(503).json({ error: { code: "COMFYUI_NOT_CONFIGURED", message: "Configure COMFYUI_BASE_URL first." } });
    if (!/^[a-zA-Z0-9_-]+$/.test(promptId)) return res.status(400).json({ error: { code: "INVALID_PROMPT_ID", message: "ComfyUI prompt ID is invalid." } });
    try {
      const history = await requestJson(fetchImpl, base + "/history/" + encodeURIComponent(promptId), {
        headers: providerHeaders(env.COMFYUI_API_KEY), timeoutMs: 15000
      });
      const job = history?.[promptId] || null;
      res.json({ provider: "comfyui", promptId, found: Boolean(job), job });
    } catch (error) { safeError(res, error, "ComfyUI job lookup"); }
  });

  router.get("/integrations/comfyui/status", requireSupabaseUser, async (_req, res) => {
    const base = configuredUrl(env.COMFYUI_BASE_URL);
    if (!base) return res.status(503).json({ error: { code: "COMFYUI_NOT_CONFIGURED", message: "Configure COMFYUI_BASE_URL first." } });
    try {
      const [system, queue] = await Promise.all([
        requestJson(fetchImpl, base + "/system_stats", { headers: providerHeaders(env.COMFYUI_API_KEY), timeoutMs: 12000 }),
        requestJson(fetchImpl, base + "/queue", { headers: providerHeaders(env.COMFYUI_API_KEY), timeoutMs: 12000 })
      ]);
      const running = Array.isArray(queue?.queue_running) ? queue.queue_running : [];
      const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
      res.json({
        provider: "comfyui",
        reachable: true,
        system: {
          devices: Array.isArray(system?.devices) ? system.devices.map(device => ({
            name: bounded(device?.name, 160),
            type: bounded(device?.type, 80),
            vramTotal: Number.isFinite(device?.vram_total) ? device.vram_total : undefined,
            vramFree: Number.isFinite(device?.vram_free) ? device.vram_free : undefined
          })) : []
        },
        queue: { running: running.length, pending: pending.length }
      });
    } catch (error) { safeError(res, error, "ComfyUI status check"); }
  });

  router.get("/integrations/comfyui/queue", requireSupabaseUser, async (_req, res) => {
    const base = configuredUrl(env.COMFYUI_BASE_URL);
    if (!base) return res.status(503).json({ error: { code: "COMFYUI_NOT_CONFIGURED", message: "Configure COMFYUI_BASE_URL first." } });
    try {
      const queue = await requestJson(fetchImpl, base + "/queue", { headers: providerHeaders(env.COMFYUI_API_KEY), timeoutMs: 15000 });
      const summarize = items => (Array.isArray(items) ? items : []).slice(0, 100).map(item => ({
        queueNumber: Number.isFinite(item?.[0]) ? item[0] : undefined,
        promptId: typeof item?.[1] === "string" ? item[1] : undefined,
        workflowName: bounded(item?.[3]?.extra_pnginfo?.workflow?.name, 120) || undefined
      }));
      res.json({
        provider: "comfyui",
        running: summarize(queue?.queue_running),
        pending: summarize(queue?.queue_pending),
        truncated: (queue?.queue_running?.length || 0) + (queue?.queue_pending?.length || 0) > 100
      });
    } catch (error) { safeError(res, error, "ComfyUI queue lookup"); }
  });

  router.delete("/integrations/comfyui/jobs/:promptId", requireSupabaseUser, async (req, res) => {
    const base = configuredUrl(env.COMFYUI_BASE_URL);
    const promptId = bounded(req.params.promptId, 160);
    if (!base) return res.status(503).json({ error: { code: "COMFYUI_NOT_CONFIGURED", message: "Configure COMFYUI_BASE_URL first." } });
    if (!/^[a-zA-Z0-9_-]+$/.test(promptId)) return res.status(400).json({ error: { code: "INVALID_PROMPT_ID", message: "ComfyUI prompt ID is invalid." } });
    try {
      await requestJson(fetchImpl, base + "/queue", {
        method: "POST",
        headers: providerHeaders(env.COMFYUI_API_KEY),
        body: { delete: [promptId] },
        timeoutMs: 15000
      });
      res.json({ provider: "comfyui", promptId, requested: "cancel_queued_job" });
    } catch (error) { safeError(res, error, "ComfyUI job cancellation"); }
  });

  // HeyGem, OmniVoice and Handy implementations differ by deployment. These
  // adapters require explicit paths, rather than guessing undocumented APIs.
  const genericAdapters = [
    { id: "heygem", baseKey: "HEYGEM_API_BASE_URL", tokenKey: "HEYGEM_API_KEY", pathKey: "HEYGEM_JOB_PATH", route: "/integrations/heygem/jobs", label: "HeyGem", timeoutMs: 45000 },
    { id: "omnivoice", baseKey: "OMNIVOICE_API_BASE_URL", tokenKey: "OMNIVOICE_API_KEY", pathKey: "OMNIVOICE_SYNTHESIS_PATH", route: "/integrations/omnivoice/synthesize", label: "OmniVoice", timeoutMs: 90000 },
    { id: "handy", baseKey: "ULTRON_HANDY_BRIDGE_URL", tokenKey: "ULTRON_HANDY_BRIDGE_TOKEN", pathKey: "ULTRON_HANDY_TRANSCRIBE_PATH", route: "/integrations/handy/transcribe", label: "Handy", timeoutMs: 90000 }
  ];

  for (const adapter of genericAdapters) {
    router.post(adapter.route, requireSupabaseUser, async (req, res) => {
      const base = configuredUrl(env[adapter.baseKey]);
      const path = cleanPath(env[adapter.pathKey]);
      const token = String(env[adapter.tokenKey] || "").trim();
      if (!base || !path || (adapter.tokenKey && !token)) {
        return res.status(503).json({
          error: {
            code: adapter.id.toUpperCase() + "_NOT_CONFIGURED",
            message: "Configure " + adapter.baseKey + ", " + adapter.pathKey + " and the required service token before using this integration."
          }
        });
      }
      const payload = req.body?.payload;
      if (!isObject(payload) || !Object.keys(payload).length || JSON.stringify(payload).length > 1_500_000) {
        return res.status(400).json({ error: { code: "INVALID_PROVIDER_PAYLOAD", message: "payload must be a non-empty JSON object under 1.5 MB." } });
      }
      if (adapter.id === "omnivoice" && !bounded(payload.text, 30000)) {
        return res.status(400).json({ error: { code: "OMNIVOICE_TEXT_REQUIRED", message: "payload.text is required and must be non-empty." } });
      }
      if (adapter.id === "handy" && !isValidBase64Audio(payload.audioBase64)) {
        return res.status(400).json({ error: { code: "HANDY_AUDIO_REQUIRED", message: "payload.audioBase64 must be canonical base64 audio up to 8 MB decoded." } });
      }
      try {
        const data = await requestJson(fetchImpl, base + path, {
          method: "POST",
          headers: providerHeaders(token),
          body: payload,
          timeoutMs: adapter.timeoutMs
        });
        res.json({ provider: adapter.id, result: data });
      } catch (error) { safeError(res, error, adapter.label); }
    });
  }

  return router;
}
