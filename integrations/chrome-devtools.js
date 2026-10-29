import { safePinnedFetch, safeServiceBase } from "../network-safety.js";

const CHROME_ACTIONS = new Set([
  "status", "navigate", "click", "fill", "screenshot", "page_snapshot",
  "console_logs", "network_requests", "performance_trace"
]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function bounded(value, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !CHROME_ACTIONS.has(input.action)) {
    throw Object.assign(new Error("Unsupported Chrome DevTools action."), { code: "CHROME_ACTION_NOT_SUPPORTED", status: 400 });
  }
  const allowed = { action: input.action };
  if (input.url !== undefined) {
    if (typeof input.url !== "string" || input.url.length > 2048) throw Object.assign(new Error("Invalid browser URL."), { code: "CHROME_URL_INVALID", status: 400 });
    allowed.url = input.url;
  }
  if (input.selector !== undefined) {
    if (typeof input.selector !== "string" || !input.selector.trim() || input.selector.length > 600) throw Object.assign(new Error("Invalid browser selector."), { code: "CHROME_SELECTOR_INVALID", status: 400 });
    allowed.selector = input.selector.trim();
  }
  if (input.text !== undefined) {
    if (typeof input.text !== "string" || input.text.length > 5000) throw Object.assign(new Error("Invalid form text."), { code: "CHROME_TEXT_INVALID", status: 400 });
    allowed.text = input.text;
  }
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw Object.assign(new Error("Invalid log limit."), { code: "CHROME_LIMIT_INVALID", status: 400 });
    allowed.limit = input.limit;
  }
  if (input.durationMs !== undefined) {
    if (!Number.isInteger(input.durationMs) || input.durationMs < 1000 || input.durationMs > 10000) throw Object.assign(new Error("Trace duration must be between 1000 and 10000 milliseconds."), { code: "CHROME_DURATION_INVALID", status: 400 });
    allowed.durationMs = input.durationMs;
  }
  if (input.confirmExternalAction !== undefined) {
    if (typeof input.confirmExternalAction !== "boolean") throw Object.assign(new Error("Invalid confirmation flag."), { code: "CHROME_CONFIRMATION_INVALID", status: 400 });
    allowed.confirmExternalAction = input.confirmExternalAction;
  }
  if (allowed.action === "navigate" && !allowed.url) throw Object.assign(new Error("Navigation requires a URL."), { code: "CHROME_URL_REQUIRED", status: 400 });
  if (["click", "fill"].includes(allowed.action) && !allowed.selector) throw Object.assign(new Error("Click/fill requires a selector."), { code: "CHROME_SELECTOR_REQUIRED", status: 400 });
  if (allowed.action === "fill" && allowed.text === undefined) throw Object.assign(new Error("Fill requires text."), { code: "CHROME_TEXT_REQUIRED", status: 400 });
  return allowed;
}

async function readResponseTextLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Chrome DevTools response exceeded the size limit."), { code: "CHROME_RESPONSE_TOO_LARGE", status: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Chrome DevTools response cannot be safely size-limited."), { code: "CHROME_RESPONSE_UNBOUNDED", status: 502 });
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Chrome DevTools response exceeded the size limit."), { code: "CHROME_RESPONSE_TOO_LARGE", status: 502 });
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

export function getChromeDevToolsReadiness(env = process.env, userId = "") {
  const baseUrl = safeServiceBase(env.ULTRON_CHROME_DEVTOOLS_URL);
  const token = bounded(env.ULTRON_CHROME_DEVTOOLS_TOKEN, 500);
  const expectedOwner = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  const configured = Boolean(baseUrl && token.length >= 32 && expectedOwner);
  const ownerAuthorized = Boolean(expectedOwner && userId && expectedOwner === userId);
  const state = !configured ? "blocked" : !ownerAuthorized ? "owner_only" : "configured_unverified";
  return {
    configured,
    ownerAuthorized,
    state,
    requiredEnv: ["ULTRON_CHROME_DEVTOOLS_URL", "ULTRON_CHROME_DEVTOOLS_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
    note: configured
      ? (ownerAuthorized
          ? "Bridge URL, token and owner guard are configured; live Chrome connectivity has not yet been verified."
          : "Chrome DevTools bridge is restricted to the configured ULTRON owner.")
      : "Requires an authenticated local Chrome DevTools HTTP bridge, a random token of at least 32 characters, and the exact owner UUID. A hosted backend cannot reach a developer PC's localhost."
  };
}

export async function runChromeDevToolsAction({
  env = process.env,
  fetchImpl = safePinnedFetch,
  userId = "",
  input
} = {}) {
  const readiness = getChromeDevToolsReadiness(env, userId);
  if (!readiness.configured) {
    return { state: "blocked", execution: "not_started", code: "CHROME_DEVTOOLS_NOT_CONFIGURED", blocker: readiness.note };
  }
  if (!readiness.ownerAuthorized) {
    return { state: "blocked", execution: "not_started", code: "CHROME_DEVTOOLS_OWNER_ONLY", blocker: readiness.note };
  }

  const action = readInput(input);
  const baseUrl = safeServiceBase(env.ULTRON_CHROME_DEVTOOLS_URL);
  const token = bounded(env.ULTRON_CHROME_DEVTOOLS_TOKEN, 500);
  const timeout = action.action === "performance_trace" ? 25000 : 15000;
  let response;
  try {
    response = await fetchImpl(baseUrl + "/action", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(action),
      redirect: "error",
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    const code = error?.code || (error?.name === "TimeoutError" ? "CHROME_DEVTOOLS_TIMEOUT" : "CHROME_DEVTOOLS_UNREACHABLE");
    return {
      state: "failed",
      execution: "chrome_devtools",
      error: { code: bounded(code, 80), message: "The Chrome DevTools bridge could not be reached. Confirm the local bridge is running and reachable from this ULTRON backend." }
    };
  }

  let body;
  try {
    const raw = await readResponseTextLimited(response);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    return { state: "failed", execution: "chrome_devtools", error: { code: bounded(error?.code || "CHROME_RESPONSE_INVALID", 80), message: "Chrome DevTools returned an invalid or oversized response." } };
  }
  if (!response.ok || body.ok !== true) {
    const message = bounded(body?.error?.message || "Chrome DevTools action failed.", 500);
    return {
      state: "failed",
      execution: "chrome_devtools",
      status: response.status,
      error: { code: bounded(body?.error?.code || "CHROME_ACTION_FAILED", 80), message }
    };
  }
  return { state: "completed", execution: "chrome_devtools", action: action.action, result: body.result };
}
