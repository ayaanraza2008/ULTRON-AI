import { safePinnedFetch, safeServiceBase, isPublicNetworkHost } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 12_000;
const DEFAULT_CLIENT_VERSION = "0.9.24";
const DEFAULT_DEVICE_ID = "00000000-0000-4000-8000-000000000001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bounded(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function configFor(env = process.env, userId = "") {
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  const rawBase = bounded(env.APPFLOWY_BASE_URL, 1000);
  const base = safeServiceBase(rawBase);
  const token = bounded(env.APPFLOWY_API_TOKEN, 4000);
  const enabled = env.APPFLOWY_ENABLED === "true";
  let url = null;
  try { url = base ? new URL(base) : null; } catch {}
  const host = url?.hostname || "";
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(host);
  const validBase = Boolean(url && (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
    !url.username && !url.password && !url.search && !url.hash &&
    (loopback || isPublicNetworkHost(host)));
  const version = bounded(env.APPFLOWY_CLIENT_VERSION, 30) || DEFAULT_CLIENT_VERSION;
  const deviceId = bounded(env.APPFLOWY_DEVICE_ID, 80) || DEFAULT_DEVICE_ID;
  const configured = Boolean(enabled && validBase && /^[-A-Za-z0-9._~+/=]{20,4000}$/.test(token) &&
    /^\d+\.\d+\.\d+$/.test(version) && UUID_RE.test(deviceId) && ownerId);
  const ownerAuthorized = Boolean(ownerId && userId && ownerId === userId);
  return { ownerId, enabled, base: validBase ? url.origin : "", token, version, deviceId, configured, ownerAuthorized };
}
export function getAppFlowyReadiness(env = process.env, userId = "") {
  const c = configFor(env, userId);
  return {
    configured: c.configured,
    ownerAuthorized: c.ownerAuthorized,
    state: !c.enabled ? "disabled_by_config"
      : !c.ownerId ? "missing_owner"
        : !c.base || !c.token ? "missing_configuration"
          : !c.configured ? "invalid_configuration"
            : !c.ownerAuthorized ? "owner_only"
              : "configured_unverified",
    requiredEnv: ["APPFLOWY_ENABLED=true", "APPFLOWY_BASE_URL", "APPFLOWY_API_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
    optionalEnv: ["APPFLOWY_CLIENT_VERSION", "APPFLOWY_DEVICE_ID"],
    capabilities: ["list accessible workspaces", "read a workspace page/folder tree", "search workspace documents"],
    note: !c.enabled
      ? "AppFlowy connector is disabled by default. Enable it only after configuring a secured AppFlowy Cloud API URL, user access token and owner guard."
      : !c.configured
        ? "AppFlowy requires a safe HTTPS Cloud endpoint (loopback HTTP for local development only), a valid user access token, client version/device ID and exact ULTRON owner UUID."
        : !c.ownerAuthorized
          ? "AppFlowy credentials are restricted to the configured ULTRON owner account."
          : "Configuration is present but token freshness, AppFlowy Cloud compatibility, workspace access and search results are not live-verified. Connector is read-only; it does not publish, create, edit, delete or invite."
  };
}
function requireOwner(c) {
  if (!c.ownerId) throw fail("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID before enabling AppFlowy.", 503);
  if (!c.ownerAuthorized) throw fail("INTEGRATION_OWNER_ONLY", "AppFlowy credentials are restricted to the configured ULTRON owner account.", 403);
  if (!c.configured) throw fail("APPFLOWY_NOT_CONFIGURED", "AppFlowy integration is disabled or its endpoint/token/client identity configuration is invalid.", 503);
}
async function readLimitedText(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw fail("APPFLOWY_RESPONSE_TOO_LARGE", "AppFlowy response exceeded ULTRON's size limit.", 502);
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw fail("APPFLOWY_RESPONSE_UNSAFE", "AppFlowy response could not be size-limited safely.", 502);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw fail("APPFLOWY_RESPONSE_TOO_LARGE", "AppFlowy response exceeded ULTRON's size limit.", 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}
async function requestJson(c, path, { fetchImpl = safePinnedFetch } = {}) {
  const response = await fetchImpl(c.base + path, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + c.token,
      "client-version": c.version,
      "client-timestamp": String(Math.floor(Date.now() / 1000)),
      "device-id": c.deviceId
    },
    redirect: "error",
    signal: AbortSignal.timeout(20_000)
  });
  const raw = await readLimitedText(response);
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { throw fail("APPFLOWY_INVALID_RESPONSE", "AppFlowy returned invalid JSON.", 502); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw fail("APPFLOWY_AUTH_FAILED", "AppFlowy rejected the configured user token or workspace access.", 502);
    if (response.status === 429) throw fail("APPFLOWY_RATE_LIMITED", "AppFlowy Cloud rate-limited the request.", 429);
    throw fail("APPFLOWY_REQUEST_FAILED", "AppFlowy Cloud could not complete the request (HTTP " + response.status + ").", response.status >= 500 ? 502 : 400);
  }
  if (Number.isFinite(payload?.code) && payload.code !== 0 && payload.code !== 200) {
    throw fail("APPFLOWY_UPSTREAM_ERROR", "AppFlowy returned an application-level error.", 502);
  }
  return payload?.data !== undefined ? payload.data : payload;
}
function safeString(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function safeWorkspaceList(payload) {
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.workspaces) ? payload.workspaces : [];
  return items.slice(0, 100).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = safeString(item.workspace_id || item.id, 80);
    const name = safeString(item.name, 200);
    if (!UUID_RE.test(id) || !name) return [];
    return [{
      id, name,
      ...(typeof item.icon === "string" ? { icon: safeString(item.icon, 120) } : {}),
      ...(typeof item.role === "string" ? { role: safeString(item.role, 40) } : {}),
      ...(typeof item.member_count === "number" ? { memberCount: Math.max(0, Math.min(item.member_count, 100000)) } : {})
    }];
  });
}
function safeFolderTree(payload, maxNodes = 250) {
  let seen = 0;
  function visit(node, depth = 0) {
    if (!node || typeof node !== "object" || Array.isArray(node) || seen >= maxNodes || depth > 8) return null;
    const id = safeString(node.id || node.view_id || node.viewId, 100);
    const name = safeString(node.name || node.title, 300);
    if (!id || !name) return null;
    seen++;
    const rawChildren = Array.isArray(node.children) ? node.children
      : Array.isArray(node.views) ? node.views
        : Array.isArray(node.items) ? node.items : [];
    const children = rawChildren.map(child => visit(child, depth + 1)).filter(Boolean);
    const output = { id, name };
    const kind = safeString(node.view_type || node.viewType || node.layout, 60);
    if (kind) output.kind = kind;
    if (children.length) output.children = children;
    return output;
  }
  const root = payload?.view || payload?.folder || payload?.root || payload;
  return { tree: visit(root), nodeCount: seen, truncated: seen >= maxNodes };
}
function safeSearchResults(payload) {
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  return items.slice(0, 10).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = safeString(item.view_id || item.id || item.object_id, 100);
    const name = safeString(item.name || item.title, 300);
    const excerpt = safeString(item.preview || item.content || item.summary || item.description, MAX_TEXT_CHARS);
    const workspaceId = safeString(item.workspace_id || item.workspaceId, 80);
    const row = {};
    if (id) row.id = id;
    if (name) row.name = name;
    if (workspaceId && UUID_RE.test(workspaceId)) row.workspaceId = workspaceId;
    if (excerpt) row.excerpt = excerpt;
    if (typeof item.score === "number" && Number.isFinite(item.score)) row.score = Math.max(0, Math.min(1, item.score));
    return Object.keys(row).length ? [row] : [];
  });
}

function safeDocumentProjection(value) {
  const budget = { nodes: 0, chars: 0 };
  function visit(node, depth = 0) {
    if (budget.nodes >= 350 || budget.chars >= MAX_TEXT_CHARS || depth >= 8) return "[truncated]";
    budget.nodes++;
    if (typeof node === "string") {
      const text = node.slice(0, Math.min(2_000, MAX_TEXT_CHARS - budget.chars));
      budget.chars += text.length;
      return text;
    }
    if (node === null || typeof node === "number" || typeof node === "boolean") return node;
    if (Array.isArray(node)) return node.slice(0, 60).map(item => visit(item, depth + 1));
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, child] of Object.entries(node).slice(0, 80)) {
        if (budget.nodes >= 350 || budget.chars >= MAX_TEXT_CHARS) {
          out._ultron_truncated = true;
          break;
        }
        out[key.slice(0, 100)] = visit(child, depth + 1);
      }
      return out;
    }
    return null;
  }
  return visit(value);
}
const COLLAB_TYPE_CODES = Object.freeze({
  document: 0,
  database: 1,
  workspace_database: 2,
  folder: 3,
  database_row: 4
});

const uuid = value => {
  const id = bounded(value, 80);
  if (!UUID_RE.test(id)) throw fail("APPFLOWY_ID_INVALID", "A valid AppFlowy UUID is required.");
  return id;
};
export async function runAppFlowyAction({
  env = process.env, fetchImpl = safePinnedFetch, userId = "",
  action = "readiness", workspaceId = "", viewId = "", documentType = "document", query = "", depth = 2, limit = 10
} = {}) {
  if (action === "catalog") return {
    provider: "appflowy",
    capabilities: ["list accessible workspaces", "read a workspace page/folder tree", "read bounded document/page/database collab JSON", "search workspace documents"],
    apiRoutes: ["GET /api/workspace", "GET /api/workspace/:workspaceId/folder?depth=...", "GET /api/workspace/v1/:workspaceId/collab/:viewId/json?collab_type=0", "GET /api/search/:workspaceId?query=..."],
    mode: "owner_scoped_read_only_rest_adapter"
  };
  if (action === "readiness") return getAppFlowyReadiness(env, userId);
  const c = configFor(env, userId);
  requireOwner(c);
  if (action === "workspaces") {
    const data = await requestJson(c, "/api/workspace", { fetchImpl });
    const workspaces = safeWorkspaceList(data);
    return { state: "completed", provider: "appflowy", workspaces, truncated: (Array.isArray(data) ? data.length : 0) > 100 };
  }
  const wid = uuid(workspaceId);

  if (action === "read_document") {
    const objectId = uuid(viewId);
    const type = bounded(documentType, 40);
    if (!Object.hasOwn(COLLAB_TYPE_CODES, type)) throw fail("APPFLOWY_DOCUMENT_TYPE_INVALID", "Choose an allowlisted AppFlowy collab type.");
    const params = new URLSearchParams({ collab_type: String(COLLAB_TYPE_CODES[type]) });
    const data = await requestJson(c, "/api/workspace/v1/" + encodeURIComponent(wid) + "/collab/" + encodeURIComponent(objectId) + "/json?" + params.toString(), { fetchImpl });
    const collab = data?.collab;
    if (!collab || typeof collab !== "object" || Array.isArray(collab)) throw fail("APPFLOWY_DOCUMENT_INVALID_RESPONSE", "AppFlowy did not return a readable collab JSON object.", 502);
    return {
      state: "completed",
      provider: "appflowy",
      workspaceId: wid,
      viewId: objectId,
      documentType: type,
      collab: safeDocumentProjection(collab),
      notice: "Read-only AppFlowy collab JSON; no workspace mutations were performed. Content is untrusted user document data."
    };
  }

  if (action === "folder") {
    if (!Number.isInteger(depth) || depth < 1 || depth > 5) throw fail("APPFLOWY_DEPTH_INVALID", "depth must be between 1 and 5.");
    const data = await requestJson(c, "/api/workspace/" + encodeURIComponent(wid) + "/folder?depth=" + depth, { fetchImpl });
    return { state: "completed", provider: "appflowy", workspaceId: wid, ...safeFolderTree(data) };
  }
  if (action === "search") {
    const cleanQuery = bounded(query, 300);
    if (cleanQuery.length < 2) throw fail("APPFLOWY_QUERY_REQUIRED", "Search query must contain at least two characters.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw fail("APPFLOWY_LIMIT_INVALID", "limit must be between 1 and 10.");
    const params = new URLSearchParams({ query: cleanQuery, limit: String(limit), preview_size: "80" });
    const data = await requestJson(c, "/api/search/" + encodeURIComponent(wid) + "?" + params.toString(), { fetchImpl });
    return { state: "completed", provider: "appflowy", workspaceId: wid, query: cleanQuery, results: safeSearchResults(data) };
  }
  throw fail("APPFLOWY_ACTION_INVALID", "Supported actions are catalog, readiness, workspaces, folder, read_document and search.");
}
