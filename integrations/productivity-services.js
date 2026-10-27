/**
 * Read-only connectors for supported self-hosted productivity service APIs.
 * Credentials are global deployment secrets, so calls are restricted to the
 * explicitly configured ULTRON_INTEGRATION_OWNER_USER_ID account. Never accept
 * upstream URLs, tokens, or arbitrary paths from model/user input.
 */
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 1_500_000;

function bounded(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeBase(value) {
  return safeServiceBase(value);
}

function ownerAllowed(env, userId) {
  const expected = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  return Boolean(expected && userId && expected === userId);
}

function blocked(code, message) {
  return { state: "blocked", error: { code, message } };
}

function providerConfig(env, userId, { baseKey, tokenKey, extraKeys = [] }) {
  if (!ownerAllowed(env, userId)) {
    return { error: blocked("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID to the owner account UUID before exposing shared third-party credentials.") };
  }
  const base = safeBase(env[baseKey]);
  const token = bounded(env[tokenKey], 3000);
  if (!base || !token || extraKeys.some(key => !bounded(env[key], 200))) {
    return { error: blocked("INTEGRATION_NOT_CONFIGURED", "Required service configuration is missing or invalid: " + [baseKey, tokenKey, ...extraKeys].join(", ") + ".") };
  }
  return { base, token };
}

async function readJsonLimited(response) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Connected service response exceeded its size limit."), { code: "INTEGRATION_RESPONSE_TOO_LARGE", status: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Connected service response cannot be safely size-limited."), { code: "INTEGRATION_RESPONSE_UNBOUNDED", status: 502 });
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
        throw Object.assign(new Error("Connected service response exceeded its size limit."), { code: "INTEGRATION_RESPONSE_TOO_LARGE", status: 502 });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Connected service returned invalid JSON."), { code: "INTEGRATION_INVALID_JSON", status: 502 }); }
}

async function getJson(fetchImpl, url, headers, timeoutMs = 12000) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await readJsonLimited(response);
  if (!response.ok) {
    throw Object.assign(new Error("Connected service returned HTTP " + response.status + "."), {
      code: response.status === 429 ? "INTEGRATION_RATE_LIMITED" : "INTEGRATION_REQUEST_FAILED",
      status: response.status === 429 ? 429 : response.status >= 500 ? 502 : 400
    });
  }
  return data;
}

function normalizeError(error, provider) {
  return {
    state: "failed",
    provider,
    error: {
      code: bounded(error?.code, 80) || "INTEGRATION_FAILED",
      message: error?.status ? bounded(error.message, 240) : "The connected service could not complete the request."
    }
  };
}

function numericId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? String(n) : null;
}

export async function listChatwootConversations({
  env = process.env, fetchImpl = safePinnedFetch, userId, status = "open", limit = 10
} = {}) {
  const config = providerConfig(env, userId, { baseKey: "CHATWOOT_BASE_URL", tokenKey: "CHATWOOT_API_TOKEN", extraKeys: ["CHATWOOT_ACCOUNT_ID"] });
  if (config.error) return config.error;
  const accountId = numericId(env.CHATWOOT_ACCOUNT_ID);
  if (!accountId) return blocked("CHATWOOT_ACCOUNT_ID_INVALID", "CHATWOOT_ACCOUNT_ID must be a positive integer.");
  const allowedStatuses = new Set(["open", "pending", "resolved", "all"]);
  const safeStatus = allowedStatuses.has(status) ? status : "open";
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 20)) : 10;
  const query = new URLSearchParams({ status: safeStatus, page: "1" });
  try {
    const data = await getJson(fetchImpl, config.base + "/api/v1/accounts/" + accountId + "/conversations?" + query.toString(), {
      Authorization: "Bearer " + config.token
    });
    const raw = Array.isArray(data?.data?.payload) ? data.data.payload : Array.isArray(data?.payload) ? data.payload : Array.isArray(data?.data) ? data.data : [];
    const conversations = raw.slice(0, safeLimit).map(item => ({
      id: numericId(item?.id),
      status: bounded(item?.status, 30),
      priority: bounded(item?.priority, 30) || null,
      unreadCount: Number.isFinite(item?.unread_count) ? Math.max(0, item.unread_count) : undefined,
      lastActivityAt: Number.isFinite(item?.last_activity_at) ? item.last_activity_at : undefined,
      inbox: bounded(item?.meta?.inbox?.name, 120) || undefined,
      contactName: bounded(item?.meta?.sender?.name, 120) || undefined,
      labels: Array.isArray(item?.labels) ? item.labels.slice(0, 20).map(x => bounded(x, 60)).filter(Boolean) : []
    })).filter(item => item.id);
    return { state: "completed", provider: "chatwoot", status: safeStatus, count: conversations.length, conversations };
  } catch (error) { return normalizeError(error, "chatwoot"); }
}

export async function listOpenProjectProjects({
  env = process.env, fetchImpl = safePinnedFetch, userId, limit = 20
} = {}) {
  const config = providerConfig(env, userId, { baseKey: "OPENPROJECT_BASE_URL", tokenKey: "OPENPROJECT_API_TOKEN" });
  if (config.error) return config.error;
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 30)) : 20;
  const query = new URLSearchParams({ pageSize: String(safeLimit) });
  const auth = "Basic " + Buffer.from("apikey:" + config.token, "utf8").toString("base64");
  try {
    const data = await getJson(fetchImpl, config.base + "/api/v3/projects?" + query.toString(), { Authorization: auth });
    const raw = Array.isArray(data?._embedded?.elements) ? data._embedded.elements : [];
    const projects = raw.slice(0, safeLimit).map(item => ({
      id: numericId(item?.id),
      identifier: bounded(item?.identifier, 80),
      name: bounded(item?.name, 180),
      status: bounded(item?.status, 60) || undefined,
      createdAt: bounded(item?.createdAt, 60) || undefined,
      url: bounded(item?._links?.self?.href, 500) || undefined
    })).filter(item => item.id && item.name);
    return { state: "completed", provider: "openproject", count: projects.length, projects };
  } catch (error) { return normalizeError(error, "openproject"); }
}

export async function listOpenProjectWorkPackages({
  env = process.env, fetchImpl = safePinnedFetch, userId, projectId, limit = 20
} = {}) {
  const config = providerConfig(env, userId, { baseKey: "OPENPROJECT_BASE_URL", tokenKey: "OPENPROJECT_API_TOKEN" });
  if (config.error) return config.error;
  const project = projectId === undefined || projectId === null ? null : numericId(projectId);
  if (projectId !== undefined && projectId !== null && !project) return blocked("OPENPROJECT_PROJECT_ID_INVALID", "projectId must be a positive integer.");
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 30)) : 20;
  const filters = project ? JSON.stringify([{ project: { operator: "=", values: [project] } }]) : "";
  const query = new URLSearchParams({ pageSize: String(safeLimit) });
  if (filters) query.set("filters", filters);
  const auth = "Basic " + Buffer.from("apikey:" + config.token, "utf8").toString("base64");
  try {
    const data = await getJson(fetchImpl, config.base + "/api/v3/work_packages?" + query.toString(), { Authorization: auth });
    const raw = Array.isArray(data?._embedded?.elements) ? data._embedded.elements : [];
    const items = raw.slice(0, safeLimit).map(item => ({
      id: numericId(item?.id),
      subject: bounded(item?.subject, 300),
      status: bounded(item?._links?.status?.title, 80) || undefined,
      type: bounded(item?._links?.type?.title, 80) || undefined,
      assignee: bounded(item?._links?.assignee?.title, 120) || undefined,
      project: bounded(item?._links?.project?.title, 180) || undefined,
      dueDate: bounded(item?.dueDate, 20) || undefined,
      url: bounded(item?._links?.self?.href, 500) || undefined
    })).filter(item => item.id && item.subject);
    return { state: "completed", provider: "openproject", count: items.length, workPackages: items };
  } catch (error) { return normalizeError(error, "openproject"); }
}

export async function listCalDiyEventTypes({
  env = process.env, fetchImpl = safePinnedFetch, userId, limit = 20
} = {}) {
  const config = providerConfig(env, userId, { baseKey: "CALDIY_BASE_URL", tokenKey: "CALDIY_API_TOKEN" });
  if (config.error) return config.error;
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 30)) : 20;
  const query = new URLSearchParams({ take: String(safeLimit) });
  try {
    const data = await getJson(fetchImpl, config.base + "/v2/event-types?" + query.toString(), {
      Authorization: "Bearer " + config.token,
      "cal-api-version": bounded(env.CALDIY_API_VERSION, 40) || "2026-02-25"
    });
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.eventTypeGroups) ? data.data.eventTypeGroups.flatMap(group => group.eventTypes || []) : [];
    const eventTypes = raw.slice(0, safeLimit).map(item => ({
      id: numericId(item?.id),
      title: bounded(item?.title, 160),
      slug: bounded(item?.slug, 100) || undefined,
      lengthInMinutes: Number.isFinite(item?.lengthInMinutes) ? item.lengthInMinutes : undefined,
      hidden: typeof item?.hidden === "boolean" ? item.hidden : undefined
    })).filter(item => item.id && item.title);
    return { state: "completed", provider: "caldiy", count: eventTypes.length, eventTypes };
  } catch (error) { return normalizeError(error, "caldiy"); }
}

export async function listCalDiySlots({
  env = process.env, fetchImpl = safePinnedFetch, userId, eventTypeId, start, end, timeZone
} = {}) {
  const config = providerConfig(env, userId, { baseKey: "CALDIY_BASE_URL", tokenKey: "CALDIY_API_TOKEN" });
  if (config.error) return config.error;
  const eventId = numericId(eventTypeId);
  if (!eventId) return blocked("CALDIY_EVENT_TYPE_ID_INVALID", "eventTypeId must be a positive integer.");
  const parseDate = value => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const startDate = parseDate(start), endDate = parseDate(end);
  if (!startDate || !endDate || Date.parse(endDate) <= Date.parse(startDate) || Date.parse(endDate) - Date.parse(startDate) > 14 * 24 * 60 * 60 * 1000) {
    return blocked("CALDIY_DATE_RANGE_INVALID", "Provide valid ISO date-times in ascending order, with a maximum 14-day window.");
  }
  const query = new URLSearchParams({ eventTypeId: eventId, start: startDate, end: endDate });
  if (typeof timeZone === "string" && /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone.slice(0, 80))) query.set("timeZone", timeZone.slice(0, 80));
  try {
    const data = await getJson(fetchImpl, config.base + "/v2/slots?" + query.toString(), {
      Authorization: "Bearer " + config.token,
      "cal-api-version": bounded(env.CALDIY_API_VERSION, 40) || "2026-02-25"
    });
    const source = data?.data?.slots && typeof data.data.slots === "object" ? data.data.slots : data?.data;
    const slots = [];
    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [day, entries] of Object.entries(source).slice(0, 14)) {
        if (!Array.isArray(entries)) continue;
        for (const item of entries.slice(0, 50)) {
          const time = bounded(item?.time || item?.start, 40);
          if (time && Number.isFinite(Date.parse(time))) slots.push({ time: new Date(time).toISOString(), date: day });
          if (slots.length >= 100) break;
        }
        if (slots.length >= 100) break;
      }
    } else if (Array.isArray(source)) {
      for (const item of source.slice(0, 100)) {
        const time = bounded(item?.time || item?.start, 40);
        if (time && Number.isFinite(Date.parse(time))) slots.push({ time: new Date(time).toISOString() });
      }
    }
    return { state: "completed", provider: "caldiy", eventTypeId: eventId, count: slots.length, slots, notice: "Availability only. No booking was created or changed." };
  } catch (error) { return normalizeError(error, "caldiy"); }
}
