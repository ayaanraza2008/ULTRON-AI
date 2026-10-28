import { deflateSync } from "node:zlib";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";
import { getPublicBaseUrl } from "../public-base-url.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_MODELS = 6;
const CHALLENGE_OK = "ULTRON_VISION_SMOKE_OK";

function report(status, fields, now) {
  return { status, ...fields, generatedAt: now() };
}

function isFreeModel(model) {
  return model === "openrouter/free" ||
    /^[a-z0-9][a-z0-9._-]{0,79}\/[a-z0-9][a-z0-9._-]{0,119}:free$/i.test(model);
}

function loadConfiguration(env) {
  const apiKey = typeof env.OPENROUTER_API_KEY === "string" ? env.OPENROUTER_API_KEY.trim() : "";
  if (!apiKey) return { error: "OPENROUTER_API_KEY_REQUIRED" };
  const rawBase = typeof env.OPENROUTER_BASE_URL === "string" && env.OPENROUTER_BASE_URL.trim()
    ? env.OPENROUTER_BASE_URL.trim()
    : DEFAULT_BASE_URL;
  const baseUrl = safeServiceBase(rawBase);
  if (!baseUrl) return { error: "UNSAFE_PROVIDER_URL" };
  let parsed;
  try { parsed = new URL(baseUrl); } catch { return { error: "UNSAFE_PROVIDER_URL" }; }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (parsed.protocol !== "https:" || !(host === "openrouter.ai" || host.endsWith(".openrouter.ai"))) {
    return { error: "OPENROUTER_HOST_REQUIRED" };
  }

  const configured = typeof env.ULTRON_VISION_MODELS === "string" && env.ULTRON_VISION_MODELS.trim()
    ? env.ULTRON_VISION_MODELS.slice(0, 3000).split(",").map(value => value.trim())
    : ["openrouter/free"];
  const models = [...new Set(configured.filter(isFreeModel))].slice(0, MAX_MODELS);
  if (!models.length) return { error: "NO_ELIGIBLE_FREE_VISION_MODELS" };
  return { apiKey, baseUrl, models };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([size, typeBytes, data, checksum]);
}

// Tiny synthetic test image: the left half is red and the right half is blue.
function createVisionChallengePng() {
  const width = 64, height = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 2;  // truecolour RGB
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // PNG filter: None
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      if (x < width / 2) {
        row[offset] = 255; row[offset + 1] = 0; row[offset + 2] = 0;
      } else {
        row[offset] = 0; row[offset + 1] = 0; row[offset + 2] = 255;
      }
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND")
  ]);
}

async function readJsonLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Response body is not safely stream-readable"), { code: "UNSAFE_RESPONSE_BODY" });
  const chunks = [];
  let total = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    try { return JSON.parse(chunks.join("")); }
    catch { throw Object.assign(new Error("Malformed response"), { code: "INVALID_PROVIDER_RESPONSE" }); }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function extractText(message) {
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content.map(part => typeof part?.text === "string" ? part.text : "").join("").trim();
  }
  return "";
}

function safeFailureCode(error, status) {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_REJECTED";
  if (status === 402) return "PROVIDER_PAYMENT_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "TIMEOUT";
  return error?.code && /^[A-Z0-9_]{1,60}$/.test(error.code) ? error.code : "REQUEST_FAILED";
}

/**
 * Executes a low-token, free-model-only vision challenge when explicitly confirmed.
 * The generated image is synthetic and contains no user files or personal data.
 * The report never includes credentials, generated text, or raw provider errors.
 */
export async function runVisionProviderSmoke({
  env = process.env,
  fetchImpl = safePinnedFetch,
  now = () => new Date().toISOString(),
  timeoutMs = 12_000
} = {}) {
  if (env.ULTRON_CONFIRM_VISION_SMOKE !== "YES") {
    return report("blocked", { reason: "EXPLICIT_CONFIRMATION_REQUIRED", attempts: [] }, now);
  }
  if (typeof fetchImpl !== "function") return report("blocked", { reason: "FETCH_UNAVAILABLE", attempts: [] }, now);
  const configuration = loadConfiguration(env);
  if (configuration.error) return report("blocked", { reason: configuration.error, attempts: [] }, now);

  const image = createVisionChallengePng().toString("base64");
  const attempts = [];
  const timeout = Math.max(1000, Math.min(20_000, Number(timeoutMs) || 12_000));
  for (const model of configuration.models) {
    let response;
    try {
      response = await fetchImpl(configuration.baseUrl + "/chat/completions", {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + configuration.apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          "HTTP-Referer": getPublicBaseUrl(env),
          "X-Title": "ULTRON AI Vision Smoke Test"
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 20,
          stream: false,
          messages: [{
            role: "system",
            content: "Inspect the attached image itself. Reply with exactly ULTRON_VISION_SMOKE_OK only if the left half is red and the right half is blue. Otherwise reply with exactly ULTRON_VISION_SMOKE_WRONG."
          }, {
            role: "user",
            content: [
              { type: "text", text: "Inspect this image and choose the correct token." },
              { type: "image_url", image_url: { url: "data:image/png;base64," + image, detail: "low" } }
            ]
          }]
        }),
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      attempts.push({ model, code: safeFailureCode(error, 0) });
      continue;
    }

    if (!response.ok) {
      const status = response.status;
      try { await response.body?.cancel?.(); } catch {}
      attempts.push({ model, code: safeFailureCode(null, status), httpStatus: status });
      continue;
    }

    let data;
    try { data = await readJsonLimited(response); }
    catch (error) {
      attempts.push({ model, code: safeFailureCode(error, response.status), httpStatus: response.status });
      continue;
    }
    const text = extractText(data?.choices?.[0]?.message);
    if (/^ULTRON_VISION_SMOKE_OK[.!]?$/i.test(text)) {
      attempts.push({ model, code: "VISION_CHALLENGE_PASSED", httpStatus: response.status });
      return report("passed", {
        provider: "openrouter",
        model,
        successfulAttempt: attempts.length,
        challengeVerified: true,
        completionReceived: true,
        attempts
      }, now);
    }
    attempts.push({ model, code: text ? "VISION_CHALLENGE_FAILED" : "EMPTY_COMPLETION", httpStatus: response.status });
  }
  return report("failed", {
    reason: "ALL_FREE_VISION_MODELS_FAILED",
    challengeVerified: false,
    attempts
  }, now);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const result = await runVisionProviderSmoke();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "passed") process.exitCode = 1;
}
