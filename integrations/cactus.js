/**
 * Cactus local inference readiness and health checks.
 * Cactus is an optional external runtime; ULTRON never downloads model weights.
 */
import { isIP } from "node:net";
import { safeServiceBase } from "../network-safety.js";
import { safeFetch } from "../outbound-transport.js";

function bounded(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function loopbackHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function parseCactusBase(value) {
  const normalized = safeServiceBase(String(value || ""));
  if (!normalized) return null;
  let url;
  try { url = new URL(normalized); } catch { return null; }
  const local = loopbackHost(url.hostname);
  const host = url.hostname.replace(/^\\[|\\]$/g, "");
  if ((url.port && url.port !== "443" && !local) ||
      url.pathname.split("/").some(segment => segment === "..")) return null;
  // Cactus remote services must use a hostname, not an IP literal.
  if (!local && isIP(host) !== 0) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "/v1") return null;
  url.pathname = path || "/v1";
  return { baseUrl: url.toString().replace(/\/+$/, ""), local };
}

function blocked(code, message) {
  return { state: "blocked", provider: "cactus", error: { code, message } };
}

function getConfig(env, userId) {
  if (env.ULTRON_INTEGRATION_OWNER_USER_ID && userId &&
      env.ULTRON_INTEGRATION_OWNER_USER_ID !== userId) {
    return { error: blocked("INTEGRATION_OWNER_NOT_CONFIGURED", "This Cactus endpoint is reserved for ULTRON's configured owner account.") };
  }
  const parsed = parseCactusBase(env.CACTUS_BASE_URL);
  const model = bounded(env.CACTUS_MODEL, 180);
  const token = bounded(env.CACTUS_API_KEY, 3000);
  if (!parsed || !model || (!parsed.local && !token)) {
    return { error: blocked("CACTUS_NOT_CONFIGURED", "Set CACTUS_BASE_URL, CACTUS_MODEL, and for remote endpoints a CACTUS_API_KEY accepted by its authentication gateway. No upstream request was made.") };
  }
  return { ...parsed, model, token, localFirst: env.CACTUS_LOCAL_FIRST !== "false" };
}

async function readJsonLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > 512_000) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Cactus response exceeded its size limit."), { code: "CACTUS_RESPONSE_TOO_LARGE", status: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Cactus response cannot be safely size-limited."), { code: "CACTUS_RESPONSE_UNBOUNDED", status: 502 });
  let size = 0, raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512_000) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Cactus response exceeded its size limit."), { code: "CACTUS_RESPONSE_TOO_LARGE", status: 502 });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { try { reader.releaseLock(); } catch {} }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Cactus returned invalid JSON."), { code: "CACTUS_INVALID_JSON", status: 502 }); }
}

function modelIds(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return rows.slice(0, 100).map(item => bounded(item?.id ?? item?.name ?? item?.model, 180)).filter(Boolean);
}

export function getCactusReadiness(env = process.env) {
  const parsed = parseCactusBase(env.CACTUS_BASE_URL);
  const model = bounded(env.CACTUS_MODEL, 180);
  const token = bounded(env.CACTUS_API_KEY, 3000);
  const configured = Boolean(parsed && model && (parsed.local || token));
  return {
    state: !env.CACTUS_BASE_URL ? "desktop_companion_required" : configured ? "configured_unverified" : "missing_configuration",
    configured,
    endpointConfigured: Boolean(parsed),
    modelConfigured: Boolean(model),
    localEndpoint: parsed?.local ?? null,
    apiKeyConfigured: Boolean(token),
    localFirst: env.CACTUS_LOCAL_FIRST !== "false",
    confidenceThreshold: Number.isFinite(Number(env.CACTUS_CONFIDENCE_THRESHOLD))
      ? Math.max(0, Math.min(1, Number(env.CACTUS_CONFIDENCE_THRESHOLD))) : 0.72,
    source: "https://github.com/cactus-compute/cactus",
    companion: {
      repository: "https://github.com/cactus-compute/needle",
      abilities: ["small on-device tool routing", "typed structured extraction", "text embeddings", "Whistle speech-to-text"],
      note: "Cactus/Needle must be installed and started separately. ULTRON never downloads weights or assumes local microphone/compute are available on the cloud host."
    },
    features: ["OpenAI-compatible local chat completion", "function/tool calling when supported by the chosen model", "optional confidence-based fallback to the next configured provider"],
    limitations: ["No model is downloaded by ULTRON.", "Render cannot reach a PC's loopback endpoint; run ULTRON and Cactus in the same host, or use an authenticated HTTPS gateway.", "Start the Cactus server with --no-cloud-handoff unless cloud handoff is deliberately configured and reviewed.", "The Cactus core repository license limits its grant to personal/non-commercial and qualifying small organizations; review before commercial use."]
  };
}

export async function checkCactusService({ env = process.env, fetchImpl = safeFetch, userId } = {}) {
  const config = getConfig(env, userId);
  if (config.error) return config.error;
  const url = config.baseUrl + "/models";
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...(config.token ? { Authorization: "Bearer " + config.token } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await readJsonLimited(response);
    if (!response.ok) return {
      state: "failed", provider: "cactus",
      error: { code: response.status === 429 ? "CACTUS_RATE_LIMITED" : "CACTUS_REQUEST_FAILED", message: "Cactus model endpoint returned HTTP " + response.status + "." }
    };
    const availableModels = modelIds(payload);
    return {
      state: "completed", provider: "cactus", endpointReachable: true,
      configuredModel: config.model,
      configuredModelListed: availableModels.length ? availableModels.includes(config.model) : null,
      availableModels,
      localFirst: config.localFirst,
      confidenceFallback: true,
      modelDownloadedByUltron: false,
      notice: "This checks only the model-list endpoint. It does not load/download weights or run an inference request."
    };
  } catch (error) {
    return {
      state: "failed", provider: "cactus",
      error: { code: bounded(error?.code, 80) || "CACTUS_UNAVAILABLE", message: error?.status ? bounded(error.message, 220) : "Cactus endpoint is unreachable. Start the local service and check network reachability." }
    };
  }
}

export function resolveCactusProvider(env = process.env) {
  const parsed = parseCactusBase(env.CACTUS_BASE_URL);
  const model = bounded(env.CACTUS_MODEL, 180);
  const token = bounded(env.CACTUS_API_KEY, 3000);
  if (!parsed || !model || (!parsed.local && !token)) return null;
  const threshold = Number(env.CACTUS_CONFIDENCE_THRESHOLD);
  return {
    name: "cactus",
    baseUrl: parsed.baseUrl,
    apiKey: token,
    model,
    priority: env.CACTUS_LOCAL_FIRST === "false" ? 50 : -10,
    supportsTools: env.CACTUS_SUPPORTS_TOOLS !== "false",
    confidenceThreshold: Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0.72
  };
}
