/**
 * Paperclip read-only roster/governance connector.
 * This adapter never creates, wakes, pauses, terminates, hires, or changes agents.
 * Shared credentials are available only to ULTRON's explicitly configured owner UUID.
 */
const MAX_RESPONSE_BYTES = 1_000_000;

function bounded(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeBase(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase());
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.pathname !== "/" && url.pathname.replace(/\/+$/, "") !== "/api") return null;
    return url.toString().replace(/\/+$/, "");
  } catch { return null; }
}

function blocked(code, message) {
  return { state: "blocked", error: { code, message } };
}

function ownerAllowed(env, userId) {
  return Boolean(
    typeof env.ULTRON_INTEGRATION_OWNER_USER_ID === "string" &&
    env.ULTRON_INTEGRATION_OWNER_USER_ID.trim() &&
    userId &&
    env.ULTRON_INTEGRATION_OWNER_USER_ID.trim() === userId
  );
}

function validCompanyId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

async function readJsonLimited(response) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Paperclip response exceeded its size limit."), { code: "PAPERCLIP_RESPONSE_TOO_LARGE", status: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Paperclip response cannot be size-limited."), { code: "PAPERCLIP_RESPONSE_UNBOUNDED", status: 502 });
  const decoder = new TextDecoder();
  let raw = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Paperclip response exceeded its size limit."), { code: "PAPERCLIP_RESPONSE_TOO_LARGE", status: 502 });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Paperclip returned invalid JSON."), { code: "PAPERCLIP_INVALID_JSON", status: 502 }); }
}

async function getJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(12000)
  });
  const body = await readJsonLimited(response);
  if (!response.ok) {
    throw Object.assign(new Error("Paperclip returned HTTP " + response.status + "."), {
      code: response.status === 429 ? "PAPERCLIP_RATE_LIMITED" : "PAPERCLIP_REQUEST_FAILED",
      status: response.status === 429 ? 429 : response.status >= 500 ? 502 : 400
    });
  }
  return body;
}

function firstArray(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?._embedded?.elements)) return value._embedded.elements;
  return [];
}

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textOrUndefined(value, max = 180) {
  const result = bounded(value, max);
  return result || undefined;
}

function sanitizeAgent(item) {
  return {
    id: textOrUndefined(item?.id, 120),
    name: textOrUndefined(item?.name, 160),
    role: textOrUndefined(item?.role, 100),
    title: textOrUndefined(item?.title, 160),
    status: textOrUndefined(item?.status, 50),
    reportsTo: textOrUndefined(item?.reportsTo ?? item?.reports_to, 120),
    budgetMonthlyCents: numberOrUndefined(item?.budgetMonthlyCents ?? item?.budget_monthly_cents),
    spentMonthlyCents: numberOrUndefined(item?.spentMonthlyCents ?? item?.spent_monthly_cents)
  };
}

function scalarSummary(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const key of allowedKeys) {
    const item = value[key];
    if (typeof item === "number" && Number.isFinite(item)) output[key] = item;
    else if (typeof item === "boolean") output[key] = item;
    else if (typeof item === "string" && item.length <= 120) output[key] = item;
  }
  return output;
}

async function attempt(fetchImpl, url, token) {
  try { return { ok: true, data: await getJson(fetchImpl, url, token) }; }
  catch (error) {
    return { ok: false, error: {
      code: bounded(error?.code, 80) || "PAPERCLIP_REQUEST_FAILED",
      message: error?.status ? bounded(error.message, 240) : "The configured Paperclip service could not be reached."
    } };
  }
}

export function getPaperclipReadiness(env = process.env) {
  const base = safeBase(env.PAPERCLIP_BASE_URL);
  const token = bounded(env.PAPERCLIP_API_TOKEN, 3000);
  const companyId = bounded(env.PAPERCLIP_COMPANY_ID, 120);
  const ownerGuardConfigured = Boolean(
    typeof env.ULTRON_INTEGRATION_OWNER_USER_ID === "string" &&
    env.ULTRON_INTEGRATION_OWNER_USER_ID.trim()
  );
  const configured = Boolean(base && token && validCompanyId(companyId) && ownerGuardConfigured);
  return {
    state: configured ? "configured_unverified" : "separate_service_required",
    configured,
    baseConfigured: Boolean(base),
    apiTokenConfigured: Boolean(token),
    companyIdConfigured: validCompanyId(companyId),
    ownerGuardConfigured,
    source: "https://github.com/paperclipai/paperclip",
    features: ["read-only agent roster", "company dashboard summary", "monthly costs/budget summary"],
    limitations: ["Requires a separately hosted Paperclip server and scoped bearer API token.", "The connector never creates, wakes, hires, assigns, pauses, terminates, or changes agent budgets."]
  };
}

export async function getPaperclipAgentDashboard({ env = process.env, fetchImpl = globalThis.fetch, userId } = {}) {
  if (!ownerAllowed(env, userId)) {
    return blocked("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID to the owner's exact Supabase auth UUID before exposing shared Paperclip credentials.");
  }
  const base = safeBase(env.PAPERCLIP_BASE_URL);
  const token = bounded(env.PAPERCLIP_API_TOKEN, 3000);
  const companyId = bounded(env.PAPERCLIP_COMPANY_ID, 120);
  if (!base || !token || !validCompanyId(companyId)) {
    return blocked("PAPERCLIP_NOT_CONFIGURED", "Set a safe HTTPS PAPERCLIP_BASE_URL, PAPERCLIP_API_TOKEN, and a valid PAPERCLIP_COMPANY_ID. No upstream request was made.");
  }
  const api = base.endsWith("/api") ? base : base + "/api";
  const encodedCompany = encodeURIComponent(companyId);
  const results = await Promise.all([
    attempt(fetchImpl, api + "/companies/" + encodedCompany + "/agents", token),
    attempt(fetchImpl, api + "/companies/" + encodedCompany + "/dashboard", token),
    attempt(fetchImpl, api + "/companies/" + encodedCompany + "/costs/summary", token)
  ]);
  const [agentResult, dashboardResult, costResult] = results;
  const agents = agentResult.ok
    ? firstArray(agentResult.data, ["agents", "items"]).slice(0, 50).map(sanitizeAgent).filter(agent => agent.id || agent.name)
    : [];
  const dashboardRaw = dashboardResult.ok && dashboardResult.data && typeof dashboardResult.data === "object"
    ? (dashboardResult.data.dashboard && typeof dashboardResult.data.dashboard === "object" ? dashboardResult.data.dashboard : dashboardResult.data)
    : {};
  const costRaw = costResult.ok && costResult.data && typeof costResult.data === "object"
    ? (costResult.data.summary && typeof costResult.data.summary === "object" ? costResult.data.summary : costResult.data)
    : {};
  const dashboard = {
    agents: scalarSummary(dashboardRaw?.agents, ["active", "running", "paused", "error"]),
    tasks: scalarSummary(dashboardRaw?.tasks, ["open", "inProgress", "blocked", "done"]),
    costs: scalarSummary(dashboardRaw?.costs, ["monthSpendCents", "monthBudgetCents", "monthUtilizationPercent"]),
    budgets: scalarSummary(dashboardRaw?.budgets, ["activeIncidents", "pendingApprovals", "pausedAgents", "pausedProjects"]),
    pendingApprovals: numberOrUndefined(dashboardRaw?.pendingApprovals),
    activeAgents: numberOrUndefined(dashboardRaw?.activeAgents),
    openIssues: numberOrUndefined(dashboardRaw?.openIssues),
    blockedIssues: numberOrUndefined(dashboardRaw?.blockedIssues)
  };
  const costs = scalarSummary(costRaw, [
    "eventCount", "unpricedEventCount", "unknownBillingEventCount", "estimatedEventCount",
    "pendingRunCount", "pricingComplete", "spendCents", "spendCentsExact",
    "budgetCents", "utilizationPercent", "currency", "period", "updatedAt"
  ]);
  const successes = results.filter(result => result.ok).length;
  const state = successes === 3 ? "completed" : successes > 0 ? "partial" : "failed";
  return {
    state, provider: "paperclip", companyId,
    agentCount: agents.length, agents,
    dashboard, costs,
    sourceStatus: {
      agents: agentResult.ok ? "completed" : "failed",
      dashboard: dashboardResult.ok ? "completed" : "failed",
      costs: costResult.ok ? "completed" : "failed"
    },
    errors: results.filter(result => !result.ok).map((result, index) => ({
      source: ["agents", "dashboard", "costs"][results.indexOf(result)],
      ...result.error
    })),
    mode: "read_only",
    actionsNotExposed: ["create_agent", "hire_agent", "assign_task", "pause_agent", "resume_agent", "terminate_agent", "change_budget", "create_issue", "start_routine"],
    notice: "Read-only Paperclip status only. No agent was started, modified, or assigned work."
  };
}
