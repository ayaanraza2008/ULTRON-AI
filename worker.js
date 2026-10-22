import { setTimeout as sleep } from "node:timers/promises";

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const pollMs = Math.max(1500, Math.min(30000, Number(process.env.ULTRON_WORKER_POLL_MS) || 5000));
const tavilyKey = process.env.TAVILY_API_KEY || "";
const openVikingUrl = String(process.env.OPENVIKING_URL || "").trim().replace(/\/+$/, "");
const openVikingKey = process.env.OPENVIKING_API_KEY || "";

function validOpenVikingUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && !url.username && !url.password;
  } catch { return false; }
}

function needsOpenVikingContext(query) {
  return /(^|[^a-z])(my|mine|our|ours|previous|earlier|last time|remember|memory|memories|preference|preferences|personalize|project|repo|repository|codebase|continue|same task|prior work|what did we|how did we|skill|workflow)(?=$|[^a-z])/.test(String(query || "").toLowerCase());
}

async function recallOpenViking(query) {
  if (!validOpenVikingUrl(openVikingUrl)) return [];
  try {
    const response = await fetch(openVikingUrl + "/api/v1/search/find", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(openVikingKey ? { "X-API-Key": openVikingKey, Authorization: "Bearer " + openVikingKey } : {})
      },
      body: JSON.stringify({ query: bounded(query, 400), context_type: ["memory", "resource", "skill"], limit: 5, read_content: true }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.warn("OpenViking recall unavailable; continuing without saved context (HTTP " + response.status + ").");
      return [];
    }
    const payload = await response.json();
    const result = payload?.result || payload;
    return ["memories", "resources", "skills"].flatMap(kind =>
      (Array.isArray(result?.[kind]) ? result[kind] : []).slice(0, 5).map(item => ({
        type: bounded(item.context_type || ({ memories: "memory", resources: "resource", skills: "skill" }[kind]), 40),
        uri: bounded(item.uri, 500),
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
        abstract: bounded(item.abstract, 1200),
        overview: bounded(item.overview, 1600),
        content: bounded(item.content, 2400)
      }))
    ).slice(0, 8);
  } catch (error) {
    console.warn("OpenViking recall failed; continuing without saved context (" + bounded(error.message, 120) + ").");
    return [];
  }
}
const maxTaskAgeMs = 24 * 60 * 60 * 1000;

if (!supabaseUrl || !serviceKey) {
  console.error("Worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never use a service-role key in a browser.");
  process.exit(1);
}
if (!/^https:\/\//i.test(supabaseUrl)) {
  console.error("SUPABASE_URL must use HTTPS.");
  process.exit(1);
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function rest(path, options = {}) {
  const response = await fetch(supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
      ...(options.body ? { Prefer: "return=representation" } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) throw new Error("Supabase request failed with HTTP " + response.status);
  return body;
}

async function audit(task, action, outcome, metadata = {}) {
  await rest("audit_events", {
    method: "POST",
    body: JSON.stringify({
      user_id: task.user_id,
      action,
      target_type: "agent_task",
      target_id: task.id,
      outcome,
      metadata
    })
  });
}

function bounded(value, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function runResearch(task) {
  if (!tavilyKey) throw Object.assign(new Error("Research provider is not configured."), { code: "RESEARCH_NOT_CONFIGURED" });
  const query = bounded(task.input?.query || task.input?.description, 400);
  if (!query) throw Object.assign(new Error("Research task needs a query."), { code: "INVALID_RESEARCH_QUERY" });
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5, search_depth: "basic", include_answer: true }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Object.assign(new Error("Research provider returned HTTP " + response.status), { code: "RESEARCH_PROVIDER_FAILED" });
  const data = await response.json();
  const contextChecked = needsOpenVikingContext(query);\n  const context = contextChecked ? await recallOpenViking(query) : [];
  return {
    type: "research",
    query,
    answer: bounded(data.answer, 6000),
    context,
    contextUsed: context.length > 0,
    sources: Array.isArray(data.results) ? data.results.slice(0, 5).map(item => ({
      title: bounded(item.title, 300),
      url: bounded(item.url, 1000),
      snippet: bounded(item.content, 1200)
    })) : []
  };
}

async function execute(task) {
  const created = Date.parse(task.created_at || "");
  if (!Number.isFinite(created) || Date.now() - created > maxTaskAgeMs) {
    throw Object.assign(new Error("Task is older than the execution window."), { code: "TASK_EXPIRED" });
  }
  if (task.input?.requiresApproval && task.input?.approved !== true) {
    throw Object.assign(new Error("Task does not have explicit approval."), { code: "APPROVAL_REQUIRED" });
  }
  // This worker intentionally supports one narrowly scoped operation only.
  // It never executes shell commands, code, arbitrary URLs, or browser actions.
  if (task.input?.taskType === "research") return runResearch(task);
  throw Object.assign(new Error("Unsupported task type. This worker only executes allowlisted research tasks."), { code: "TASK_TYPE_NOT_ALLOWED" });
}

async function processOne() {
  const claimed = await rest("rpc/ultron_claim_next_task", { method: "POST", body: "{}" });
  const task = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!task?.id) return false;
  try {
    const result = await execute(task);
    await rest("agent_tasks?id=eq." + encodeURIComponent(task.id) + "&status=eq.RUNNING", {
      method: "PATCH",
      body: JSON.stringify({ status: "COMPLETED", result, finished_at: new Date().toISOString() })
    });
    await audit(task, "task.completed", "allowed", { taskType: task.input?.taskType || "unknown", sourceCount: result.sources?.length || 0 });
  } catch (error) {
    const code = bounded(error.code, 80) || "TASK_EXECUTION_FAILED";
    const retryable = ["RESEARCH_PROVIDER_FAILED", "TASK_EXECUTION_FAILED", "AbortError", "TimeoutError"].includes(code);
    const shouldRetry = retryable && Number(task.attempts || 1) < 3;
    await rest("agent_tasks?id=eq." + encodeURIComponent(task.id) + "&status=eq.RUNNING", {
      method: "PATCH",
      body: JSON.stringify({
        status: code === "TASK_TYPE_NOT_ALLOWED" || code === "APPROVAL_REQUIRED" ? "BLOCKED" : shouldRetry ? "QUEUED" : "FAILED",
        error_code: code,
        result: { message: bounded(error.message, 500), retry: shouldRetry },
        ...(shouldRetry ? { started_at: null, finished_at: null } : { finished_at: new Date().toISOString() })
      })
    });
    await audit(task, shouldRetry ? "task.retry_scheduled" : "task.failed", shouldRetry ? "retry" : "failed", { code, attempt: Number(task.attempts || 1) });
    console.error("Task outcome:", task.id, shouldRetry ? "retry scheduled" : code);
  }
  return true;
}

console.log("ULTRON safe task worker started; allowlist: research only.");
while (!stopping) {
  try {
    const didWork = await processOne();
    if (!didWork) await sleep(pollMs);
  } catch (error) {
    console.error("Worker cycle failed:", error.message);
    await sleep(pollMs);
  }
}
console.log("ULTRON task worker stopped.");
