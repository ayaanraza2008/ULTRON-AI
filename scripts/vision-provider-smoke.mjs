import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeServiceBase } from "../network-safety.js";
import { safeOutboundFetch } from "../safe-outbound-fetch.js";

const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_MODELS = 8;
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfS8AAAAASUVORK5CYII=";
const FREE_MODEL = /^(?:openrouter\/free|[a-z0-9][a-z0-9._-]{0,79}\/[a-z0-9][a-z0-9._-]{0,119}:free)$/i;

function candidatesFrom(env) {
  const apiKey = typeof env.OPENROUTER_API_KEY === "string" ? env.OPENROUTER_API_KEY.trim() : "";
  const baseUrl = safeServiceBase(env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_URL);
  if (!apiKey || !baseUrl) return { candidates: [], reason: "OPENROUTER_KEY_AND_SAFE_BASE_URL_REQUIRED" };

  const rawModels = typeof env.ULTRON_VISION_MODELS === "string" ? env.ULTRON_VISION_MODELS.slice(0, 3000).split(",") : [];
  const models = [...new Set(rawModels.map(value => value.trim()).filter(value => FREE_MODEL.test(value)))].slice(0, MAX_MODELS);
  if (!models.length) return { candidates: [], reason: "FREE_VISION_MODEL_LIST_REQUIRED" };

  return {
    candidates: models.map((model, index) => ({ name: "openrouter-vision-" + (index + 1), model, apiKey, baseUrl })),
    reason: ""
  };
}

async function readJsonLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Response is not stream-readable"), { code: "UNSAFE_RESPONSE_BODY" });
  const chunks = [];
  const decoder = new TextDecoder();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    try { return JSON.parse(chunks.join("")); }
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
 * Sends one tiny inline PNG to explicitly configured free vision models.
 * This is opt-in, never stores the image, and never returns model text or secrets.
 */
export async function runVisionProviderSmoke({
  env = process.env,
  fetchImpl = safeOutboundFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof fetchImpl !== "function") return { status: "blocked", reason: "FETCH_UNAVAILABLE", attempts: [], generatedAt: now() };
  const { candidates, reason } = candidatesFrom(env);
  if (!candidates.length) return { status: "blocked", reason, attempts: [], generatedAt: now() };

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
            { role: "system", content: "You are running a vision connectivity diagnostic. Reply with the exact token ULTRON_VISION_SMOKE_OK if you can accept the supplied image input." },
            { role: "user", content: [
              { type: "text", text: "Process this tiny diagnostic image input. Reply with ULTRON_VISION_SMOKE_OK." },
              { type: "image_url", image_url: { url: PNG_1X1 } }
            ] }
          ],
          max_tokens: 20,
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
      if (!completion.toUpperCase().includes("ULTRON_VISION_SMOKE_OK")) {
        attempts.push({ provider: provider.name, model: provider.model, code: "UNEXPECTED_COMPLETION", httpStatus: response.status });
        continue;
      }
      return {
        status: "passed",
        provider: provider.name,
        model: typeof data?.model === "string" && data.model.length <= 200 ? data.model : provider.model,
        imageInputAccepted: true,
        challengeVerified: true,
        attempts,
        successfulAttempt: attempts.length + 1,
        generatedAt: now()
      };
    } catch (error) {
      attempts.push({ provider: provider.name, model: provider.model, code: failureCode(error, response?.status) });
    }
  }
  return { status: "failed", reason: "ALL_CONFIGURED_FREE_VISION_MODELS_FAILED", attempts, generatedAt: now() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const report = await runVisionProviderSmoke();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.status !== "passed") process.exitCode = report.status === "blocked" ? 2 : 1;
}
