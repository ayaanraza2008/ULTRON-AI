import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeServiceBase } from "../network-safety.js";
import { safeOutboundFetch } from "../safe-outbound-fetch.js";

const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
const MAX_PROVIDER_COUNT = 6;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

function safeProviderName(value, fallback = "provider") {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(value) ? value : fallback;
}

function safeModel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200 ? value.trim() : "";
}

function secureBaseUrl(value) {
  // Use the same public-host policy as runtime routing before forwarding a key.
  // HTTP remains limited to explicit loopback development endpoints.
  return safeServiceBase(value);
}

function loadProviderCandidates(env) {
  const candidates = [];
  const errors = [];
  if (typeof env.OPENROUTER_API_KEY === "string" && env.OPENROUTER_API_KEY.trim()) {
    const baseUrl = secureBaseUrl(env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_URL);
    const model = safeModel(env.OPENROUTER_DEFAULT_MODEL || "openrouter/free");
    if (baseUrl && model) {
      candidates.push({ name: "openrouter", baseUrl, apiKey: env.OPENROUTER_API_KEY.trim(), model, priority: 0 });
    } else {
      errors.push({ provider: "openrouter", code: "INVALID_PROVIDER_CONFIGURATION" });
    }
  }

  let parsed = [];
  if (typeof env.ULTRON_MODEL_PROVIDERS_JSON === "string" && env.ULTRON_MODEL_PROVIDERS_JSON.trim()) {
    try {
      const value = JSON.parse(env.ULTRON_MODEL_PROVIDERS_JSON);
      if (!Array.isArray(value)) throw new TypeError("Provider registry must be an array.");
      parsed = value.slice(0, MAX_PROVIDER_COUNT);
    } catch {
      errors.push({ provider: "registry", code: "INVALID_PROVIDER_REGISTRY" });
    }
  }

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({ provider: "registry-entry", code: "INVALID_PROVIDER_CONFIGURATION" });
      continue;
    }
    const name = safeProviderName(entry.name, "");
    const apiKeyEnv = typeof entry.apiKeyEnv === "string" && /^[A-Z][A-Z0-9_]{0,100}$/.test(entry.apiKeyEnv) ? entry.apiKeyEnv : "";
    const baseUrl = secureBaseUrl(entry.baseUrl);
    const model = safeModel(entry.model);
    const apiKey = apiKeyEnv && typeof env[apiKeyEnv] === "string" ? env[apiKeyEnv].trim() : "";
    if (!name || !apiKeyEnv || !apiKey || !baseUrl || !model) {
      errors.push({ provider: name || "registry-entry", code: "PROVIDER_NOT_ELIGIBLE" });
      continue;
    }
    candidates.push({ name, baseUrl, apiKey, model, priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 100 });
  }

  // Keep the explicit smoke diagnostic aligned with runtime routing: after a
  // primary OpenRouter failure, it may try other free IDs from the same model list.
  const openRouter = candidates.find(candidate => candidate.name === "openrouter");
  if (openRouter) {
    const knownModels = new Set(
      candidates.filter(candidate => candidate.baseUrl === openRouter.baseUrl).map(candidate => candidate.model)
    );
    const freeModels = String(env.ULTRON_AVAILABLE_MODELS || "")
      .slice(0, 3000)
      .split(",")
      .map(model => model.trim())
      .filter(model => model === "openrouter/free" ||
        /^[a-z0-9][a-z0-9._-]{0,79}\/[a-z0-9][a-z0-9._-]{0,119}:free$/i.test(model))
      .slice(0, 12);
    let fallbackIndex = 0;
    for (const model of freeModels) {
      if (knownModels.has(model) || fallbackIndex >= 5) continue;
      candidates.push({
        name: "openrouter-free-fallback-" + (++fallbackIndex),
        baseUrl: openRouter.baseUrl,
        apiKey: openRouter.apiKey,
        model,
        priority: 10 + fallbackIndex
      });
      knownModels.add(model);
    }
  }

  return { candidates: candidates.slice(0, MAX_PROVIDER_COUNT + 1).sort((a, b) => a.priority - b.priority), errors };
}

async function readJsonLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Response is not stream-readable"), { code: "UNSAFE_RESPONSE_BODY" });
  const chunks = [];
  let totalBytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const raw = chunks.join("");
    try { return raw ? JSON.parse(raw) : {}; }
    catch { throw Object.assign(new Error("Invalid JSON"), { code: "INVALID_PROVIDER_RESPONSE" }); }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function failureCode(error, status) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "TIMEOUT") return "TIMEOUT";
  if (status === 401 || status === 403) return "PROVIDER_AUTH_REJECTED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return error?.code && /^[A-Z0-9_]{1,60}$/.test(error.code) ? error.code : "REQUEST_FAILED";
}

/**
 * Executes one minimal provider completion only when explicitly invoked by an
 * operator. It never returns credentials, generated text, or raw upstream errors.
 */
export async function runModelProviderSmoke({ env = process.env, fetchImpl = safeOutboundFetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => new Date().toISOString() } = {}) {
  if (typeof fetchImpl !== "function") return { status: "blocked", reason: "FETCH_UNAVAILABLE", attempts: [], generatedAt: now() };
  const { candidates, errors } = loadProviderCandidates(env);
  if (!candidates.length) {
    return { status: "blocked", reason: "NO_ELIGIBLE_PROVIDER", configurationErrors: errors, attempts: [], generatedAt: now() };
  }

  const attempts = [];
  const boundedTimeoutMs = Math.max(1000, Math.min(20_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  for (const provider of candidates) {
    let response;
    try {
      response = await fetchImpl(provider.baseUrl + "/chat/completions", {
        method: "POST",
        redirect: "error",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + provider.apiKey },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: "You are running a connectivity test. Reply with the single token ULTRON_SMOKE_OK." },
            { role: "user", content: "Reply with ULTRON_SMOKE_OK." }
          ],
          max_tokens: 16,
          temperature: 0,
          stream: false
        }),
        signal: AbortSignal.timeout(boundedTimeoutMs)
      });
      if (!response.ok) {
        const status = response.status;
        try { await response.body?.cancel?.(); } catch {}
        attempts.push({ provider: provider.name, model: provider.model, code: failureCode(null, status), httpStatus: status });
        continue;
      }
      const data = await readJsonLimited(response);
      const content = data?.choices?.[0]?.message?.content;
      const completion = typeof content === "string" ? content.trim()
        : Array.isArray(content) ? content.map(item => typeof item?.text === "string" ? item.text : "").join("").trim() : "";
      if (!completion) {
        attempts.push({ provider: provider.name, model: provider.model, code: "EMPTY_COMPLETION", httpStatus: response.status });
        continue;
      }
      // HTTP 200 plus arbitrary text is not enough to prove the expected model
      // completion contract. Verify the challenge token without exposing output.
      if (!completion.toUpperCase().includes("ULTRON_SMOKE_OK")) {
        attempts.push({ provider: provider.name, model: provider.model, code: "UNEXPECTED_COMPLETION", httpStatus: response.status });
        continue;
      }
      return {
        status: "passed",
        provider: provider.name,
        model: safeModel(data?.model) || provider.model,
        completionReceived: true,
        challengeVerified: true,
        attempts,
        successfulAttempt: attempts.length + 1,
        generatedAt: now()
      };
    } catch (error) {
      attempts.push({ provider: provider.name, model: provider.model, code: failureCode(error, response?.status) });
    }
  }
  return { status: "failed", reason: "ALL_CONFIGURED_PROVIDERS_FAILED", attempts, configurationErrors: errors, generatedAt: now() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const report = await runModelProviderSmoke();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.status !== "passed") process.exitCode = report.status === "blocked" ? 2 : 1;
}