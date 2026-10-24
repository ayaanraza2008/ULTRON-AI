import { createHash } from "node:crypto";

const MAX_QUERY = 1200;
const MAX_MEMORY_TEXT = 2400;

function bounded(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function scopedProject(env, userId) {
  const base = bounded(env?.ULTRON_AGENTMEMORY_PROJECT || "ultron-ai", 80).replace(/[^a-zA-Z0-9._-]/g, "-") || "ultron-ai";
  const user = bounded(userId, 500);
  // Preserve existing project names for already-safe IDs (including Supabase UUIDs)
  // so existing users do not lose access to their memories. Hash unsafe IDs instead
  // of replacing punctuation, which could make distinct identities collide.
  const userKey = user
    ? (/^[a-zA-Z0-9._-]{1,80}$/.test(user)
      ? user
      : "sha256-" + createHash("sha256").update(user, "utf8").digest("hex").slice(0, 40))
    : "";
  return userKey ? base + "-user-" + userKey : base;
}

function baseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function agentMemoryReadiness(env = process.env) {
  const url = baseUrl(env.AGENTMEMORY_URL || env.ULTRON_AGENTMEMORY_URL);
  const token = bounded(env.AGENTMEMORY_SECRET || env.ULTRON_AGENTMEMORY_SECRET, 1000);
  return {
    configured: Boolean(url && token),
    urlConfigured: Boolean(url),
    secretConfigured: Boolean(token),
    automaticRecall: Boolean(url && token),
    automaticCapture: Boolean(url && token && env.ULTRON_AGENTMEMORY_CAPTURE !== "false"),
    upstream: "rohitg00/agentmemory",
    note: "Configuration readiness only; live connectivity is not implied."
  };
}

export function shouldRecallAgentMemory(task) {
  const text = bounded(task, MAX_QUERY).toLowerCase();
  return /\b(remember|previous|earlier|last time|as before|continue|context|decision|we chose|we decided|my preference|project|repository|repo|codebase|bug|debug|implement|integrat|architecture|design|plan|ongoing|history|recall|memory)\b/.test(text);
}

export function shouldCaptureAgentMemory(task) {
  const text = bounded(task, MAX_QUERY);
  if (text.length < 25 || /(?:api[_ -]?key|password|secret|bearer\s+|private key|-----begin)/i.test(text)) return false;
  return /\b(remember this|save this|we decided|decision:|project uses|the project uses|my preference is|from now on|going forward|important project context|implementation decision|architecture decision)\b/i.test(text);
}

async function requestMemory(path, body, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const base = baseUrl(env.AGENTMEMORY_URL || env.ULTRON_AGENTMEMORY_URL);
  const token = bounded(env.AGENTMEMORY_SECRET || env.ULTRON_AGENTMEMORY_SECRET, 1000);
  if (!base || !token) return { state: "not_configured" };
  const response = await fetchImpl(base + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  const raw = await response.text();
  if (raw.length > 200000) throw Object.assign(new Error("AgentMemory response exceeded the limit."), { code: "AGENTMEMORY_RESPONSE_TOO_LARGE" });
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { text: raw.slice(0, 4000) }; }
  if (!response.ok) throw Object.assign(new Error("AgentMemory returned HTTP " + response.status), { code: "AGENTMEMORY_REQUEST_FAILED", status: response.status });
  return data;
}

function safeMemoryText(value) {
  if (typeof value === "string") return value.slice(0, 900);
  if (!value || typeof value !== "object") return "";
  const text = [value.title, value.text, value.content, value.observation, value.summary, value.snippet]
    .filter(item => typeof item === "string").join(": ");
  return text.slice(0, 900);
}

export async function recallAgentMemory(task, options = {}) {
  const query = bounded(task, MAX_QUERY);
  if (!query || !shouldRecallAgentMemory(query)) return { state: "skipped", memories: [] };
  const project = scopedProject(options.env, options.userId);
  const data = await requestMemory("/agentmemory/smart-search", { query, project, limit: 5 }, options);
  const candidates = Array.isArray(data.results) ? data.results
    : Array.isArray(data.memories) ? data.memories
    : Array.isArray(data.items) ? data.items
    : Array.isArray(data.matches) ? data.matches : [];
  const memories = candidates.map(safeMemoryText).filter(Boolean).slice(0, 5);
  const direct = safeMemoryText(data.context || data.answer || data.text);
  if (!memories.length && direct) memories.push(direct);
  return { state: "completed", memories };
}

export async function captureAgentMemory(task, options = {}) {
  const text = bounded(task, MAX_MEMORY_TEXT);
  if (!text || !shouldCaptureAgentMemory(text)) return { state: "skipped" };
  const env = options.env || process.env;
  if (env.ULTRON_AGENTMEMORY_CAPTURE === "false") return { state: "disabled" };
  const project = scopedProject(env, options.userId);
  await requestMemory("/agentmemory/remember", {
    content: text,
    type: "decision",
    concepts: ["ultron-agent", "durable-context"],
    project,
    agentId: "ultron-ai"
  }, options);
  return { state: "captured" };
}
