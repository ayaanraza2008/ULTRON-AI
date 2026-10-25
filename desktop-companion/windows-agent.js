import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { safeServiceBase } from "../network-safety.js";
import { normalizeDesktopFailureCode, normalizeDesktopActionResult, validateDesktopAction, windowsExecutableName } from "./action-policy.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_POLL_MS = 5000;
const MAX_POLL_MS = 30000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function readConfig(env) {
  const rawBase = typeof env.ULTRON_DESKTOP_SERVER_URL === "string" ? env.ULTRON_DESKTOP_SERVER_URL.trim() : "";
  const token = typeof env.ULTRON_DESKTOP_POLL_TOKEN === "string" ? env.ULTRON_DESKTOP_POLL_TOKEN.trim() : "";
  const deviceId = typeof env.ULTRON_DESKTOP_DEVICE_ID === "string" ? env.ULTRON_DESKTOP_DEVICE_ID.trim() : "";
  let baseUrl = null;
  try {
    const validated = safeServiceBase(rawBase);
    const parsed = new URL(validated || "");
    if (parsed.protocol === "https:" && parsed.pathname === "/" && !parsed.search && !parsed.hash && !parsed.username && !parsed.password) {
      baseUrl = parsed.toString().replace(/\/+$/, "");
    }
  } catch {}
  if (!baseUrl || token.length < 32 || token.length > 2000 || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw Object.assign(new Error("Set a public HTTPS server URL, a private companion polling token, and a stable device ID."), {
      code: "DESKTOP_COMPANION_CONFIGURATION_INVALID"
    });
  }
  return { baseUrl, token, deviceId };
}

async function readJsonLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Response exceeded the configured size limit."), { code: "DESKTOP_COMPANION_RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Response body cannot be safely size-limited."), { code: "DESKTOP_COMPANION_RESPONSE_UNBOUNDED" });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Response exceeded the configured size limit."), { code: "DESKTOP_COMPANION_RESPONSE_TOO_LARGE" });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Server returned an invalid response."), { code: "DESKTOP_COMPANION_INVALID_RESPONSE" });
  }
}

function systemInformation({ osImpl = os, processLike = process } = {}) {
  const totalMemoryBytes = osImpl.totalmem();
  const freeMemoryBytes = osImpl.freemem();
  const cpus = osImpl.cpus();
  return {
    platform: processLike.platform,
    architecture: processLike.arch,
    nodeVersion: processLike.version,
    osRelease: osImpl.release(),
    uptimeSeconds: Math.max(0, Math.floor(osImpl.uptime())),
    totalMemoryBytes,
    freeMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, freeMemoryBytes)),
    logicalCpuCount: Array.isArray(cpus) ? cpus.length : 0
  };
}

async function startAllowlistedWindowsApp(app, {
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
  existsImpl = existsSync
} = {}) {
  if (platform !== "win32") return { status: "failed", errorCode: "ACTION_NOT_SUPPORTED" };
  const executableName = windowsExecutableName(app);
  if (!executableName) return { status: "failed", errorCode: "APP_NOT_ALLOWED" };
  const windowsRoot = typeof env.SystemRoot === "string" ? env.SystemRoot.trim()
    : typeof env.WINDIR === "string" ? env.WINDIR.trim() : "";
  if (!path.win32.isAbsolute(windowsRoot)) return { status: "failed", errorCode: "APP_LAUNCH_FAILED" };
  const systemDirectory = path.win32.resolve(windowsRoot, "System32");
  const executable = path.win32.resolve(systemDirectory, executableName);
  if (!executable.toLowerCase().startsWith((systemDirectory + path.win32.sep).toLowerCase()) ||
      !existsImpl(executable)) {
    return { status: "failed", errorCode: "APP_LAUNCH_FAILED" };
  }

  try {
    const child = spawnImpl(executable, [], {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref?.();
    return { status: "completed", result: { app, started: true } };
  } catch {
    return { status: "failed", errorCode: "APP_LAUNCH_FAILED" };
  }
}

export async function executeDesktopAction(action, options = {}) {
  if (!action || typeof action !== "object" || Array.isArray(action) ||
      typeof action.actionType !== "string" || typeof action.requiresApproval !== "boolean") {
    return { status: "failed", errorCode: "ACTION_NOT_SUPPORTED" };
  }
  const validated = validateDesktopAction(action.actionType, action.payload);
  if (!validated.ok) return { status: "failed", errorCode: normalizeDesktopFailureCode(validated.code) };
  // Enforce the risky-action policy locally instead of trusting a server-supplied
  // flag: every app launch must explicitly carry approval plus a parseable timestamp.
  const approvalRequired = validated.actionType === "launch_app" || action.requiresApproval;
  if (approvalRequired && (
    action.requiresApproval !== true ||
    typeof action.approvedAt !== "string" ||
    !action.approvedAt.trim() ||
    !Number.isFinite(Date.parse(action.approvedAt))
  )) {
    return { status: "failed", errorCode: "ACTION_NOT_APPROVED" };
  }

  if (validated.actionType === "system_info") {
    try {
      const result = systemInformation(options);
      const normalized = normalizeDesktopActionResult("system_info", {}, result);
      return normalized.ok ? { status: "completed", result: normalized.result }
        : { status: "failed", errorCode: "SYSTEM_INFO_FAILED" };
    } catch {
      return { status: "failed", errorCode: "SYSTEM_INFO_FAILED" };
    }
  }
  if (validated.actionType === "launch_app") {
    const result = await startAllowlistedWindowsApp(validated.payload.app, options);
    if (result.status !== "completed") return result;
    const normalized = normalizeDesktopActionResult("launch_app", validated.payload, result.result);
    return normalized.ok ? { status: "completed", result: normalized.result }
      : { status: "failed", errorCode: "APP_LAUNCH_FAILED" };
  }
  return { status: "failed", errorCode: "ACTION_NOT_SUPPORTED" };
}

function boundedPollMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(MAX_POLL_MS, Math.floor(parsed))) : DEFAULT_POLL_MS;
}

/**
 * The companion makes outbound HTTPS requests only. It never starts a listener,
 * accepts arbitrary commands, runs a shell, or reads user files.
 */
export async function runWindowsCompanion({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  sleepImpl = sleep,
  executeAction = executeDesktopAction,
  signal,
  maxPolls = Infinity,
  pollIntervalMs = DEFAULT_POLL_MS
} = {}) {
  const config = readConfig(env);
  if (env.ULTRON_DESKTOP_AGENT_ENABLED !== "true") {
    throw Object.assign(new Error("Set ULTRON_DESKTOP_AGENT_ENABLED=true to opt in to local companion polling."), {
      code: "DESKTOP_COMPANION_NOT_ENABLED"
    });
  }
  let polls = 0;
  while (!signal?.aborted && polls < maxPolls) {
    polls += 1;
    try {
      const pollResponse = await fetchImpl(config.baseUrl + "/api/desktop-companion/poll", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.token,
          "X-ULTRON-Protocol-Version": "1"
        },
        body: JSON.stringify({ deviceId: config.deviceId }),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
      });
      const poll = await readJsonLimited(pollResponse);
      if (!pollResponse.ok) {
        const error = Object.assign(new Error("Desktop action poll was rejected."), {
          code: typeof poll.error?.code === "string" ? poll.error.code : "DESKTOP_COMPANION_POLL_FAILED"
        });
        throw error;
      }
      if (poll.action) {
        const action = poll.action;
        let outcome;
        if (typeof action.id !== "string" || !/^[0-9a-f-]{36}$/i.test(action.id)) {
          logger.warn?.("Desktop companion received a malformed queued action identifier.");
          await sleepImpl(boundedPollMs(pollIntervalMs), undefined, { signal });
          continue;
        }
        try {
          outcome = await executeAction(action, { env });
        } catch {
          outcome = { status: "failed", errorCode: "ACTION_NOT_SUPPORTED" };
        }
        const status = outcome?.status === "completed" ? "completed" : "failed";
        const completionBody = status === "completed"
          ? { deviceId: config.deviceId, status, result: outcome.result }
          : { deviceId: config.deviceId, status, errorCode: normalizeDesktopFailureCode(outcome?.errorCode) };
        const completionResponse = await fetchImpl(config.baseUrl + "/api/desktop-companion/actions/" + encodeURIComponent(action.id) + "/complete", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer " + config.token,
            "X-ULTRON-Protocol-Version": "1"
          },
          body: JSON.stringify(completionBody),
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
        });
        const completed = await readJsonLimited(completionResponse);
        if (!completionResponse.ok) throw Object.assign(new Error("Desktop action completion was rejected."), {
          code: typeof completed.error?.code === "string" ? completed.error.code : "DESKTOP_COMPANION_COMPLETION_FAILED"
        });
        const persistedStatus = completed.action?.status;
        if (!["COMPLETED", "FAILED"].includes(persistedStatus)) {
          throw Object.assign(new Error("Desktop action completion response was invalid."), { code: "DESKTOP_COMPANION_COMPLETION_INVALID" });
        }
        logger.info?.("ULTRON desktop action finished.", { actionId: action.id, status: persistedStatus.toLowerCase() });
      }
    } catch (error) {
      if (signal?.aborted) break;
      logger.warn?.("ULTRON desktop companion poll failed.", {
        code: typeof error?.code === "string" ? error.code.slice(0, 80) : "DESKTOP_COMPANION_REQUEST_FAILED"
      });
    }
    if (!signal?.aborted && polls < maxPolls) {
      try { await sleepImpl(boundedPollMs(pollIntervalMs), undefined, { signal }); }
      catch (error) { if (signal?.aborted || error?.name === "AbortError") break; throw error; }
    }
  }
  return { state: signal?.aborted ? "stopped" : "stopped_after_poll_limit", polls };
}

export function validateDesktopCompanionClientConfig(env = process.env) {
  try { return { configured: true, deviceId: readConfig(env).deviceId }; }
  catch (error) { return { configured: false, code: error.code || "DESKTOP_COMPANION_CONFIGURATION_INVALID" }; }
}
