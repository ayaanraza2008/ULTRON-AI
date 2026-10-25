const ALLOWED_APPS = Object.freeze({
  notepad: "notepad.exe",
  calculator: "calc.exe",
  file_explorer: "explorer.exe"
});
const FAILURE_CODES = new Set([
  "APP_NOT_ALLOWED",
  "ACTION_NOT_APPROVED",
  "APP_LAUNCH_FAILED",
  "ACTION_NOT_SUPPORTED",
  "SYSTEM_INFO_FAILED",
  "RESULT_INVALID"
]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Validate an action against the v1 local-device allowlist. Never accept commands or arguments. */
export function validateDesktopAction(actionType, payload) {
  if (!isRecord(payload)) return { ok: false, code: "ACTION_PAYLOAD_INVALID" };

  if (actionType === "system_info") {
    if (Object.keys(payload).length !== 0) return { ok: false, code: "ACTION_PAYLOAD_INVALID" };
    return { ok: true, actionType, payload: {} };
  }

  if (actionType === "launch_app") {
    const app = boundedString(payload.app, 40);
    if (Object.keys(payload).some(key => key !== "app") || !Object.hasOwn(ALLOWED_APPS, app)) {
      return { ok: false, code: "APP_NOT_ALLOWED" };
    }
    return { ok: true, actionType, payload: { app } };
  }

  return { ok: false, code: "ACTION_NOT_ALLOWED" };
}

function safeInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Return a deliberately small result schema; never persist raw stdout, exception text, or arbitrary objects. */
export function normalizeDesktopActionResult(actionType, requestPayload, result) {
  if (!isRecord(result)) return { ok: false, code: "RESULT_INVALID" };

  if (actionType === "system_info") {
    const platform = boundedString(result.platform, 20);
    const architecture = boundedString(result.architecture, 20);
    const nodeVersion = boundedString(result.nodeVersion, 40);
    const osRelease = boundedString(result.osRelease, 120);
    const uptimeSeconds = result.uptimeSeconds;
    const totalMemoryBytes = result.totalMemoryBytes;
    const freeMemoryBytes = result.freeMemoryBytes;
    const logicalCpuCount = result.logicalCpuCount;
    if (platform !== "win32" || !architecture || !nodeVersion || !osRelease ||
        !safeInteger(uptimeSeconds, 0, 315_576_000) ||
        !safeInteger(totalMemoryBytes, 1, Number.MAX_SAFE_INTEGER) ||
        !safeInteger(freeMemoryBytes, 0, totalMemoryBytes) ||
        !safeInteger(logicalCpuCount, 1, 256)) {
      return { ok: false, code: "RESULT_INVALID" };
    }
    return {
      ok: true,
      result: { platform, architecture, nodeVersion, osRelease, uptimeSeconds, totalMemoryBytes, freeMemoryBytes, logicalCpuCount }
    };
  }

  if (actionType === "launch_app") {
    const app = boundedString(result.app, 40);
    if (Object.keys(result).some(key => !["app", "started"].includes(key)) ||
        app !== requestPayload?.app || !Object.hasOwn(ALLOWED_APPS, app) || result.started !== true) {
      return { ok: false, code: "RESULT_INVALID" };
    }
    return { ok: true, result: { app, started: true } };
  }

  return { ok: false, code: "ACTION_NOT_ALLOWED" };
}

export function normalizeDesktopFailureCode(value) {
  return typeof value === "string" && FAILURE_CODES.has(value) ? value : "ACTION_NOT_SUPPORTED";
}

export function allowedDesktopApps() {
  return Object.keys(ALLOWED_APPS);
}

export function windowsExecutableName(app) {
  return Object.hasOwn(ALLOWED_APPS, app) ? ALLOWED_APPS[app] : null;
}
