import { safePinnedFetch, safeServiceBase } from "../network-safety.js";
import {
  createChromeActionApproval,
  getChromeActionApproval,
  consumeChromeActionApproval
} from "./chrome-action-approvals.js";

const CHROME_ACTIONS = new Set([
  "status", "navigate", "click", "inspect_click", "fill", "screenshot", "page_snapshot",
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
  if (input.approvalFingerprint !== undefined) {
    const item = input.approvalFingerprint;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw Object.assign(new Error("Invalid approval fingerprint."), { code: "CHROME_APPROVAL_FINGERPRINT_INVALID", status: 400 });
    }
    const fields = ["origin", "pageUrl", "selector", "label", "tag", "type", "formActionOrigin"];
    for (const field of fields) {
      const max = field === "pageUrl" ? 1000 : field === "selector" ? 600 : 300;
      if (typeof item[field] !== "string" || item[field].length > max) {
        throw Object.assign(new Error("Invalid approval fingerprint."), { code: "CHROME_APPROVAL_FINGERPRINT_INVALID", status: 400 });
      }
    }
    if (typeof item.highImpact !== "boolean" || typeof item.crossOriginForm !== "boolean") {
      throw Object.assign(new Error("Invalid approval fingerprint."), { code: "CHROME_APPROVAL_FINGERPRINT_INVALID", status: 400 });
    }
    allowed.approvalFingerprint = {
      origin: item.origin,
      pageUrl: item.pageUrl,
      selector: item.selector,
      label: item.label,
      tag: item.tag,
      type: item.type,
      formActionOrigin: item.formActionOrigin,
      highImpact: item.highImpact,
      crossOriginForm: item.crossOriginForm
    };
  }
  if (allowed.action === "click" && allowed.confirmExternalAction === true && !allowed.approvalFingerprint) {
    throw Object.assign(new Error("A one-time exact-target approval fingerprint is required."), { code: "CHROME_APPROVAL_FINGERPRINT_REQUIRED", status: 403 });
  }
  if (allowed.action === "navigate" && !allowed.url) throw Object.assign(new Error("Navigation requires a URL."), { code: "CHROME_URL_REQUIRED", status: 400 });
  if (["click", "inspect_click", "fill"].includes(allowed.action) && !allowed.selector) throw Object.assign(new Error("Click/fill requires a selector."), { code: "CHROME_SELECTOR_REQUIRED", status: 400 });
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

async function requestBridgeAction({ baseUrl, token, action, fetchImpl }) {
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
    return {
      state: "failed",
      execution: "chrome_devtools",
      status: response.status,
      error: { code: bounded(body?.error?.code || "CHROME_ACTION_FAILED", 80), message: bounded(body?.error?.message || "Chrome DevTools action failed.", 500) }
    };
  }
  return { state: "completed", execution: "chrome_devtools", action: action.action, result: body.result };
}

function readinessForOwner(env, userId) {
  const baseUrl = safeServiceBase(env.ULTRON_CHROME_DEVTOOLS_URL);
  const token = bounded(env.ULTRON_CHROME_DEVTOOLS_TOKEN, 500);
  const expectedOwner = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  const configured = Boolean(baseUrl && token.length >= 32 && expectedOwner);
  const ownerAuthorized = Boolean(expectedOwner && userId && expectedOwner === userId);
  return {
    configured,
    ownerAuthorized,
    state: !configured ? "blocked" : !ownerAuthorized ? "owner_only" : "configured_unverified",
    requiredEnv: ["ULTRON_CHROME_DEVTOOLS_URL", "ULTRON_CHROME_DEVTOOLS_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
    note: configured
      ? (ownerAuthorized
          ? "Bridge URL, token and owner guard are configured; live Chrome connectivity has not yet been verified."
          : "Chrome DevTools bridge is restricted to the configured ULTRON owner.")
      : "Requires an authenticated local Chrome DevTools HTTP bridge, a random token of at least 32 characters, and the exact owner UUID. A hosted backend cannot reach a developer PC's localhost."
  };
}

export function getChromeDevToolsReadiness(env = process.env, userId = "") {
  return readinessForOwner(env, userId);
}

export async function runChromeDevToolsAction({
  env = process.env,
  fetchImpl = safePinnedFetch,
  userId = "",
  input
} = {}) {
  const readiness = readinessForOwner(env, userId);
  if (!readiness.configured) {
    return { state: "blocked", execution: "not_started", code: "CHROME_DEVTOOLS_NOT_CONFIGURED", blocker: readiness.note };
  }
  if (!readiness.ownerAuthorized) {
    return { state: "blocked", execution: "not_started", code: "CHROME_DEVTOOLS_OWNER_ONLY", blocker: readiness.note };
  }

  const action = readInput(input);
  // Model-generated confirmation is never accepted. Consequential clicks first
  // go through an inspect-only request and receive a short-lived user challenge.
  if (action.action === "click" && action.confirmExternalAction === true) {
    return { state: "blocked", execution: "not_started", code: "MODEL_CONFIRMATION_REJECTED", message: "Model arguments cannot authorize a consequential browser click." };
  }

  const baseUrl = safeServiceBase(env.ULTRON_CHROME_DEVTOOLS_URL);
  const token = bounded(env.ULTRON_CHROME_DEVTOOLS_TOKEN, 500);

  if (action.action === "click") {
    const inspection = await requestBridgeAction({
      baseUrl, token, fetchImpl,
      action: { action: "inspect_click", selector: action.selector }
    });
    if (inspection.state !== "completed") return inspection;
    if (inspection.result?.requiresConfirmation === true) {
      const challenge = createChromeActionApproval({ userId, inspection: inspection.result });
      if (!challenge.ok) {
        return { state: "failed", execution: "not_started", code: challenge.code, message: "ULTRON could not create a safe browser approval challenge." };
      }
      return {
        state: "approval_required",
        execution: "not_started",
        approvalRequired: true,
        approvalId: challenge.id,
        approvalPhrase: challenge.approvalPhrase,
        expiresAt: challenge.expiresAt,
        summary: challenge.summary,
        message: "No click was performed. Review the exact page, element and action, then send the approval phrase as your entire next message. The approval expires in 90 seconds."
      };
    }
  }
  return requestBridgeAction({ baseUrl, token, action, fetchImpl });
}

export async function approveChromeDevToolsAction({
  env = process.env,
  fetchImpl = safePinnedFetch,
  userId = "",
  approvalId
} = {}) {
  const readiness = readinessForOwner(env, userId);
  if (!readiness.configured) return { state: "blocked", execution: "not_started", code: "CHROME_DEVTOOLS_NOT_CONFIGURED", blocker: readiness.note };
  if (!readiness.ownerAuthorized) return { state: "blocked", execution: "not_started", code: "CHROME_DEVTOOLS_OWNER_ONLY", blocker: readiness.note };

  const pending = getChromeActionApproval({ approvalId, userId });
  if (!pending.ok) {
    return {
      state: "blocked",
      execution: "not_started",
      code: pending.code,
      message: pending.code === "CHROME_APPROVAL_EXPIRED"
        ? "The browser approval expired. Repeat the browser request to create a fresh challenge."
        : "No matching pending browser approval exists for this account."
    };
  }

  const baseUrl = safeServiceBase(env.ULTRON_CHROME_DEVTOOLS_URL);
  const token = bounded(env.ULTRON_CHROME_DEVTOOLS_TOKEN, 500);
  const inspection = await requestBridgeAction({
    baseUrl, token, fetchImpl,
    action: { action: "inspect_click", selector: pending.fingerprint.selector }
  });
  if (inspection.state !== "completed") return inspection;
  const consumed = consumeChromeActionApproval({
    approvalId: pending.id,
    userId,
    inspection: inspection.result
  });
  if (!consumed.ok) {
    return {
      state: "blocked",
      execution: "not_started",
      code: consumed.code,
      message: "The page or target element changed after the approval challenge was shown. No click was performed; request a new challenge."
    };
  }
  return requestBridgeAction({
    baseUrl, token, fetchImpl,
    action: {
      action: "click",
      selector: consumed.fingerprint.selector,
      confirmExternalAction: true,
      approvalFingerprint: consumed.fingerprint
    }
  });
}
