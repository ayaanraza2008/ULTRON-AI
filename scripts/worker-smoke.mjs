import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED", "BLOCKED", "WAITING_FOR_PERMISSION"]);
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function safeCode(value, fallback = "WORKER_SMOKE_FAILED") {
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value) ? value : fallback;
}

function validSupabaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function readJsonLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Response too large"), { code: "RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Response not stream-readable"), { code: "UNSAFE_RESPONSE_BODY" });
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
    const raw = chunks.join("");
    try { return raw ? JSON.parse(raw) : null; }
    catch { throw Object.assign(new Error("Invalid JSON"), { code: "INVALID_SUPABASE_RESPONSE" }); }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function requestJson(fetchImpl, url, headers, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      headers: { ...headers, ...(options.headers || {}) },
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    throw Object.assign(new Error("Supabase request failed"), { code: error?.name === "TimeoutError" || error?.name === "AbortError" ? "SUPABASE_TIMEOUT" : "SUPABASE_UNREACHABLE" });
  }
  if (!response.ok) {
    const status = response.status;
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Supabase request rejected"), { code: status === 401 || status === 403 ? "SUPABASE_AUTH_REJECTED" : "SUPABASE_REQUEST_FAILED", status });
  }
  if (response.status === 204) return null;
  return readJsonLimited(response);
}

function report(status, fields, now) {
  return { status, ...fields, generatedAt: now() };
}

/**
 * Requires an explicit confirmation string before creating a one-off AI Employee
 * plan task. Never returns the stored task result or any credential values.
 */
export async function runWorkerSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  nowMs = Date.now,
  now = () => new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = 5_000
} = {}) {
  if (env.ULTRON_CONFIRM_WORKER_SMOKE !== "YES") {
    return report("blocked", { reason: "EXPLICIT_CONFIRMATION_REQUIRED" }, now);
  }
  const baseUrl = validSupabaseUrl(env.SUPABASE_URL);
  const serviceKey = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "";
  const userId = typeof env.ULTRON_SMOKE_USER_ID === "string" ? env.ULTRON_SMOKE_USER_ID.trim() : "";
  if (!baseUrl || !serviceKey || !UUID.test(userId)) {
    return report("blocked", { reason: "SUPABASE_URL_SERVICE_KEY_AND_VALID_SMOKE_USER_REQUIRED" }, now);
  }
  if (typeof fetchImpl !== "function") return report("blocked", { reason: "FETCH_UNAVAILABLE" }, now);

  const headers = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  const startedAt = nowMs();
  const deadlineMs = startedAt + Math.max(15_000, Math.min(180_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const taskInput = {
    taskType: "employee",
    executionMode: "employee_worker",
    role: "chief-of-staff",
    mode: "plan",
    goal: "ULTRON worker smoke check: produce a very short plan confirming the task worker can call its configured model provider. Do not perform external actions, contact anyone, publish, or change settings."
  };

  let inserted;
  try {
    inserted = await requestJson(fetchImpl, baseUrl + "/rest/v1/agent_tasks", headers, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId,
        title: "ULTRON worker smoke check",
        input: taskInput
      })
    });
  } catch (error) {
    return report("failed", { reason: safeCode(error?.code, "TASK_INSERT_FAILED") }, now);
  }
  const task = Array.isArray(inserted) ? inserted[0] : inserted;
  const taskId = typeof task?.id === "string" && UUID.test(task.id) ? task.id : "";
  if (!taskId) return report("failed", { reason: "TASK_INSERT_DID_NOT_RETURN_VALID_ID" }, now);

  const select = "id,status,attempts,error_code,created_at,started_at,finished_at";
  const taskUrl = baseUrl + "/rest/v1/agent_tasks?select=" + encodeURIComponent(select) + "&id=eq." + taskId;
  let observedState = "QUEUED";
  let attempts = 0;

  const cleanup = async () => {
    try {
      await requestJson(fetchImpl, baseUrl + "/rest/v1/agent_tasks?id=eq." + taskId, headers, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
      return "deleted";
    } catch {
      return "manual_cleanup_needed";
    }
  };

  while (nowMs() < deadlineMs) {
    let rows;
    try {
      rows = await requestJson(fetchImpl, taskUrl, headers, { method: "GET" });
    } catch (error) {
      return report("failed", {
        reason: safeCode(error?.code, "TASK_POLL_FAILED"),
        taskId,
        observedState,
        elapsedMs: Math.max(0, nowMs() - startedAt),
        cleanup: "manual_cleanup_needed"
      }, now);
    }
    const current = Array.isArray(rows) ? rows[0] : null;
    if (!current) {
      return report("failed", {
        reason: "TASK_DISAPPEARED",
        taskId,
        observedState,
        elapsedMs: Math.max(0, nowMs() - startedAt),
        cleanup: "not_applicable"
      }, now);
    }
    observedState = safeCode(current.status, "UNKNOWN_STATE");
    attempts = Number.isInteger(current.attempts) ? current.attempts : attempts;

    if (TERMINAL_STATES.has(observedState)) {
      const cleanupState = await cleanup();
      if (observedState === "COMPLETED") {
        return report(cleanupState === "deleted" ? "passed" : "passed_with_cleanup_warning", {
          taskId,
          taskState: observedState,
          attempts,
          elapsedMs: Math.max(0, nowMs() - startedAt),
          cleanup: cleanupState
        }, now);
      }
      return report("failed", {
        reason: safeCode(current.error_code, observedState === "WAITING_FOR_PERMISSION" ? "TASK_NEEDS_PERMISSION" : "TASK_TERMINAL_FAILURE"),
        taskId,
        taskState: observedState,
        attempts,
        elapsedMs: Math.max(0, nowMs() - startedAt),
        cleanup: cleanupState
      }, now);
    }
    await sleepImpl(Math.max(1, Math.min(5000, Number(pollIntervalMs) || 5000)));
  }

  // A timed-out smoke task can still be running. Cancel it with a conditional
  // state transition so the worker's own conditional completion write cannot
  // overwrite cancellation. If completion wins the race, do not delete that row.
  const cancellableState = ["QUEUED", "RUNNING"].includes(observedState) ? observedState : "";
  let cleanupState = "manual_cleanup_needed";
  if (cancellableState) {
    try {
      const cancelled = await requestJson(fetchImpl, baseUrl + "/rest/v1/agent_tasks?id=eq." + taskId + "&status=eq." + cancellableState, headers, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "CANCELLED", error_code: "SMOKE_TIMEOUT", finished_at: now(), updated_at: now() })
      });
      const updated = Array.isArray(cancelled) ? cancelled[0] : null;
      if (updated?.status === "CANCELLED") cleanupState = await cleanup();
      else cleanupState = "state_changed_manual_cleanup_needed";
    } catch {
      cleanupState = "manual_cleanup_needed";
    }
  }
  return report("timed_out", {
    reason: "WORKER_DID_NOT_COMPLETE_BEFORE_TIMEOUT",
    taskId,
    observedState,
    attempts,
    elapsedMs: Math.max(0, nowMs() - startedAt),
    cleanup: cleanupState
  }, now);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await runWorkerSmoke();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "passed") process.exitCode = result.status === "blocked" ? 2 : 1;
}