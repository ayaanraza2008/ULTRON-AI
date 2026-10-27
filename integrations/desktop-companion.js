import { safeServiceBase } from "../network-safety.js";
import { safeFetch } from "../outbound-transport.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const TOKEN_MAX_LENGTH = 2000;
const DEVICE_ID_MAX_LENGTH = 120;
const DEVICE_NAME_MAX_LENGTH = 120;
const ALLOWED_READ_ONLY_CAPABILITIES = new Set(["status", "system_info"]);

function bounded(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeBaseUrl(value) {
  const base = safeServiceBase(typeof value === "string" ? value.trim() : "");
  if (!base) return null;
  try {
    const url = new URL(base);
    // The companion contract is mounted at a fixed root-relative path. Avoid
    // ambiguous prefixes/query state that might redirect requests to another API.
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function ownerDenied(env, userId) {
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  if (!ownerId) {
    return {
      state: "blocked",
      code: "INTEGRATION_OWNER_NOT_CONFIGURED",
      message: "The configured integration owner UUID is required before using the Windows companion."
    };
  }
  if (!userId || ownerId !== userId) {
    return {
      state: "blocked",
      code: "INTEGRATION_OWNER_ONLY",
      message: "The Windows companion status endpoint is restricted to the configured ULTRON owner."
    };
  }
  return null;
}

export function getDesktopCompanionReadiness(env = process.env, userId = null) {
  const ownerBlock = ownerDenied(env, userId);
  const baseUrl = safeBaseUrl(env.ULTRON_DESKTOP_AGENT_URL);
  const token = bounded(env.ULTRON_DESKTOP_AGENT_TOKEN, TOKEN_MAX_LENGTH);
  const configured = Boolean(baseUrl && token);
  return {
    provider: "windows-desktop-companion",
    configured,
    ownerAuthorized: !ownerBlock,
    state: ownerBlock?.state || (configured ? "configured_unverified" : "blocked"),
    requiredEnv: ["ULTRON_DESKTOP_AGENT_URL", "ULTRON_DESKTOP_AGENT_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
    capabilities: [],
    execution: "read_only_status_probe",
    note: configured
      ? "Bridge credentials and owner scope are configured; this does not prove a Windows device is paired or online."
      : "A public HTTPS companion endpoint, server-side token, and configured owner UUID are required. A cloud ULTRON service cannot reach a PC-local localhost endpoint."
  };
}

async function readJsonLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Desktop companion response exceeded the configured size limit."), {
      code: "DESKTOP_COMPANION_RESPONSE_TOO_LARGE"
    });
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw Object.assign(new Error("Desktop companion response cannot be safely size-limited."), {
      code: "DESKTOP_COMPANION_RESPONSE_UNBOUNDED"
    });
  }
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Desktop companion response exceeded the configured size limit."), {
          code: "DESKTOP_COMPANION_RESPONSE_TOO_LARGE"
        });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : null; }
  catch {
    throw Object.assign(new Error("Desktop companion returned malformed JSON."), {
      code: "DESKTOP_COMPANION_INVALID_RESPONSE"
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Desktop companion returned an unexpected payload."), {
      code: "DESKTOP_COMPANION_INVALID_RESPONSE"
    });
  }
  return parsed;
}

function validateStatusPayload(payload) {
  if (payload.protocolVersion !== 1 || !payload.device || typeof payload.device !== "object" ||
      Array.isArray(payload.device) || payload.device.platform !== "windows" ||
      typeof payload.device.paired !== "boolean" || typeof payload.device.online !== "boolean" ||
      !Array.isArray(payload.capabilities)) {
    return {
      state: "failed",
      reachable: true,
      code: "DESKTOP_COMPANION_PROTOCOL_MISMATCH",
      message: "The connected service did not return a supported Windows companion status payload."
    };
  }

  const capabilities = [...new Set(payload.capabilities
    .filter(item => typeof item === "string")
    .map(item => bounded(item, 60))
    .filter(item => ALLOWED_READ_ONLY_CAPABILITIES.has(item)))];

  const deviceId = bounded(payload.device.id, DEVICE_ID_MAX_LENGTH);
  const deviceName = bounded(payload.device.name, DEVICE_NAME_MAX_LENGTH);
  if (!deviceId || !deviceName) {
    return {
      state: "failed",
      reachable: true,
      code: "DESKTOP_COMPANION_PROTOCOL_MISMATCH",
      message: "The companion status is missing its device ID or display name."
    };
  }

  const paired = payload.device.paired;
  const online = payload.device.online;
  return {
    state: !online ? "offline" : !paired ? "needs_pairing" : "completed",
    reachable: true,
    provider: "windows-desktop-companion",
    protocolVersion: 1,
    device: {
      id: deviceId,
      name: deviceName,
      platform: "windows",
      paired,
      online,
      lastSeenAt: typeof payload.device.lastSeenAt === "string"
        ? bounded(payload.device.lastSeenAt, 40) || null
        : null
    },
    capabilities,
    execution: "read_only_status_probe",
    actionsExecuted: [],
    notice: "This check only reads device status. It does not run commands, read local files, capture screenshots, or control the PC."
  };
}

export async function checkDesktopCompanion({
  env = process.env,
  fetchImpl = safeFetch,
  userId
} = {}) {
  const denied = ownerDenied(env, userId);
  if (denied) return { provider: "windows-desktop-companion", ...denied, reachable: false, execution: "not_started" };

  const baseUrl = safeBaseUrl(env.ULTRON_DESKTOP_AGENT_URL);
  const token = bounded(env.ULTRON_DESKTOP_AGENT_TOKEN, TOKEN_MAX_LENGTH);
  if (!baseUrl || !token) {
    return {
      provider: "windows-desktop-companion",
      state: "blocked",
      reachable: false,
      execution: "not_started",
      code: "DESKTOP_COMPANION_NOT_CONFIGURED",
      requiredEnv: ["ULTRON_DESKTOP_AGENT_URL", "ULTRON_DESKTOP_AGENT_TOKEN"],
      message: "Configure an HTTPS Windows companion endpoint and its server-side token before checking device status."
    };
  }

  try {
    const response = await fetchImpl(baseUrl + "/v1/ultron/status", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token,
        "X-ULTRON-Protocol-Version": "1"
      },
      redirect: "error",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      try { await response.body?.cancel?.(); } catch {}
      return {
        provider: "windows-desktop-companion",
        state: "failed",
        reachable: false,
        execution: "read_only_status_probe",
        code: response.status === 401 || response.status === 403
          ? "DESKTOP_COMPANION_AUTH_FAILED"
          : response.status === 429
            ? "DESKTOP_COMPANION_RATE_LIMITED"
            : "DESKTOP_COMPANION_UPSTREAM_FAILED",
        upstreamStatus: response.status,
        message: response.status === 401 || response.status === 403
          ? "The desktop companion rejected its configured server-side credential."
          : response.status === 429
            ? "The desktop companion rate-limited the status check."
            : "The desktop companion status endpoint is unavailable."
      };
    }
    const payload = await readJsonLimited(response);
    return validateStatusPayload(payload);
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      provider: "windows-desktop-companion",
      state: "failed",
      reachable: false,
      execution: "read_only_status_probe",
      code: timedOut
        ? "DESKTOP_COMPANION_TIMEOUT"
        : bounded(error?.code, 80) || "DESKTOP_COMPANION_REQUEST_FAILED",
      message: timedOut
        ? "The desktop companion status probe timed out."
        : "The desktop companion status probe could not complete safely."
    };
  }
}
