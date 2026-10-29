import { safePinnedFetch } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TEXT = 12_000;
const MAX_TOKEN_LENGTH = 512;
const BRIDGE_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
const ACTIONS = new Set([
  "gmail_list_unread",
  "gmail_search",
  "calendar_get_events",
  "drive_list_files",
  "drive_read_doc",
  "sheets_read"
]);
const WRITE_ACTIONS = new Set([
  "gmail_send", "drive_create_doc", "drive_rename_file", "drive_move_file",
  "drive_delete_file", "calendar_create_event", "sheets_write", "sheets_append"
]);

function bounded(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function ownerAllowed(env, userId) {
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  return Boolean(ownerId && userId && ownerId === userId);
}

function blocked(code, message) {
  return { state: "blocked", error: { code, message } };
}

function bridgeConfig(env = process.env) {
  const url = bounded(env.GOOGLE_WORKSPACE_BRIDGE_URL, 500);
  const token = bounded(env.GOOGLE_WORKSPACE_BRIDGE_TOKEN, MAX_TOKEN_LENGTH);
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  if (!ownerId) return { error: blocked("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID before enabling shared Google Workspace access.") };
  if (!BRIDGE_URL.test(url)) return { error: blocked("GOOGLE_WORKSPACE_URL_INVALID", "Use the exact HTTPS Google Apps Script Web App deployment URL ending in /exec.") };
  if (token.length < 32 || /[\r\n]/.test(token)) return { error: blocked("GOOGLE_WORKSPACE_TOKEN_INVALID", "GOOGLE_WORKSPACE_BRIDGE_TOKEN must be a strong random secret of at least 32 characters.") };
  return { url, token, ownerId };
}

export function isGoogleWorkspaceConfigured(env = process.env) {
  return !bridgeConfig(env).error;
}

/** Configuration-only status; configured does not mean the Google account was live-tested. */
export function getGoogleWorkspaceReadiness({ env = process.env, userId = null } = {}) {
  const config = bridgeConfig(env);
  if (config.error) {
    return {
      id: "google-workspace",
      name: "Google Workspace",
      capability: "Owner-scoped read-only Gmail, Calendar, Drive, Docs and Sheets",
      state: "blocked",
      configured: false,
      mode: "owner_scoped_read_only_apps_script_bridge",
      requiredEnv: ["GOOGLE_WORKSPACE_BRIDGE_URL", "GOOGLE_WORKSPACE_BRIDGE_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      actions: [...ACTIONS],
      writesEnabled: false,
      error: config.error.error
    };
  }
  if (userId && config.ownerId !== userId) {
    return {
      id: "google-workspace",
      name: "Google Workspace",
      capability: "Owner-scoped read-only Gmail, Calendar, Drive, Docs and Sheets",
      state: "blocked",
      configured: false,
      mode: "owner_scoped_read_only_apps_script_bridge",
      requiredEnv: ["GOOGLE_WORKSPACE_BRIDGE_URL", "GOOGLE_WORKSPACE_BRIDGE_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      actions: [...ACTIONS],
      writesEnabled: false,
      error: { code: "INTEGRATION_OWNER_ONLY", message: "This Google Workspace bridge is restricted to the configured ULTRON owner account." }
    };
  }
  return {
    id: "google-workspace",
    name: "Google Workspace",
    capability: "Owner-scoped read-only Gmail, Calendar, Drive, Docs and Sheets",
    state: "configured_unverified",
    configured: true,
    mode: "owner_scoped_read_only_apps_script_bridge",
    requiredEnv: ["GOOGLE_WORKSPACE_BRIDGE_URL", "GOOGLE_WORKSPACE_BRIDGE_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
    actions: [...ACTIONS],
    writesEnabled: false,
    note: "Bridge settings are present; a successful authenticated request against the user's Google account has not yet been verified."
  };
}

function columnNumber(value) {
  let output = 0;
  for (const char of value.toUpperCase()) output = output * 26 + char.charCodeAt(0) - 64;
  return output;
}

function validSheetRange(value) {
  const range = bounded(value, 80) || "A1:Z40";
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/i.exec(range);
  if (!match) return null;
  const col1 = columnNumber(match[1]), row1 = Number(match[2]);
  const col2 = match[3] ? columnNumber(match[3]) : col1;
  const row2 = match[4] ? Number(match[4]) : row1;
  if (col2 < col1 || row2 < row1 || col2 - col1 + 1 > 20 || row2 - row1 + 1 > 40) return null;
  return range.toUpperCase();
}

function normalizeActionParams(action, raw = {}) {
  const params = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const limit = (fallback = 10, max = 20) => {
    const n = Number(params.limit);
    return Number.isInteger(n) ? Math.max(1, Math.min(max, n)) : fallback;
  };
  switch (action) {
    case "gmail_list_unread":
      return { limit: limit(10, 20) };
    case "gmail_search": {
      const query = bounded(params.query, 300);
      if (query.length < 2 || /[\r\n]/.test(query)) return { error: blocked("GOOGLE_GMAIL_QUERY_INVALID", "Provide a Gmail search query of 2–300 characters without line breaks.") };
      return { query, limit: limit(10, 20) };
    }
    case "calendar_get_events": {
      const now = Date.now();
      const start = params.timeMin === undefined || params.timeMin === null || params.timeMin === ""
        ? now : Date.parse(params.timeMin);
      const end = params.timeMax === undefined || params.timeMax === null || params.timeMax === ""
        ? start + 24 * 60 * 60 * 1000 : Date.parse(params.timeMax);
      const maxWindow = 90 * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > maxWindow) {
        return { error: blocked("GOOGLE_CALENDAR_RANGE_INVALID", "Calendar range must be valid and no longer than 90 days.") };
      }
      return { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() };
    }
    case "drive_list_files": {
      const query = bounded(params.query, 80);
      const allowedTypes = new Set(["", "document", "spreadsheet", "presentation", "pdf", "folder"]);
      const fileType = bounded(params.fileType, 20).toLowerCase();
      if (!allowedTypes.has(fileType)) return { error: blocked("GOOGLE_DRIVE_TYPE_INVALID", "Choose document, spreadsheet, presentation, pdf, folder, or omit fileType.") };
      return { query, fileType, limit: limit(20, 20) };
    }
    case "drive_read_doc": {
      const documentId = bounded(params.documentId, 120);
      if (!/^[A-Za-z0-9_-]{10,120}$/.test(documentId)) return { error: blocked("GOOGLE_DOC_ID_INVALID", "Provide a valid Google Docs file ID.") };
      return { documentId };
    }
    case "sheets_read": {
      const spreadsheetId = bounded(params.spreadsheetId, 120);
      const sheetName = bounded(params.sheetName, 100) || "Sheet1";
      const range = validSheetRange(params.range);
      if (!/^[A-Za-z0-9_-]{10,120}$/.test(spreadsheetId)) return { error: blocked("GOOGLE_SHEET_ID_INVALID", "Provide a valid Google Sheets spreadsheet ID.") };
      if (!/^[\p{L}\p{N} _.-]{1,100}$/u.test(sheetName)) return { error: blocked("GOOGLE_SHEET_NAME_INVALID", "Provide a valid sheet name.") };
      if (!range) return { error: blocked("GOOGLE_SHEET_RANGE_INVALID", "Range must be bounded A1 notation with at most 40 rows and 20 columns.") };
      return { spreadsheetId, sheetName, range };
    }
    default:
      return { error: blocked("GOOGLE_WORKSPACE_ACTION_NOT_ALLOWED", "Only the six configured read-only Google Workspace actions are enabled.") };
  }
}

async function readJsonLimited(response) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Bridge response exceeded its size limit."), { code: "GOOGLE_WORKSPACE_RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Bridge response cannot be safely size-limited."), { code: "GOOGLE_WORKSPACE_RESPONSE_UNBOUNDED" });
  const decoder = new TextDecoder();
  let raw = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Bridge response exceeded its size limit."), { code: "GOOGLE_WORKSPACE_RESPONSE_TOO_LARGE" });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error("Bridge response was not valid JSON."), { code: "GOOGLE_WORKSPACE_RESPONSE_INVALID" }); }
}

function safeOutput(action, data) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const text = (v, n = 1000) => typeof v === "string" ? v.slice(0, n) : "";
  switch (action) {
    case "gmail_list_unread":
    case "gmail_search":
      return {
        count: Math.max(0, Math.min(100, Number(value.count) || 0)),
        ...(Number.isFinite(Number(value.totalUnread)) ? { totalUnread: Math.max(0, Number(value.totalUnread)) } : {}),
        emails: (Array.isArray(value.emails) ? value.emails : []).slice(0, 20).map(item => ({
          subject: text(item?.subject, 300),
          from: text(item?.from, 200),
          date: text(item?.date, 80),
          ...(item?.snippet ? { snippet: text(item.snippet, 500) } : {})
        }))
      };
    case "calendar_get_events":
      return {
        count: Math.max(0, Math.min(100, Number(value.count) || 0)),
        events: (Array.isArray(value.events) ? value.events : []).slice(0, 100).map(item => ({
          title: text(item?.title, 300),
          start: text(item?.start, 80),
          end: text(item?.end, 80),
          location: text(item?.location, 300)
        }))
      };
    case "drive_list_files":
      return {
        count: Math.max(0, Math.min(100, Number(value.count) || 0)),
        files: (Array.isArray(value.files) ? value.files : []).slice(0, 20).map(item => ({
          name: text(item?.name, 300),
          id: text(item?.id, 150),
          mimeType: text(item?.mimeType, 150),
          modifiedTime: text(item?.modifiedTime, 80)
        }))
      };
    case "drive_read_doc":
      return { content: text(value.content, MAX_TEXT) };
    case "sheets_read":
      return {
        values: (Array.isArray(value.values) ? value.values : []).slice(0, 40).map(row =>
          (Array.isArray(row) ? row : []).slice(0, 20).map(cell =>
            typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean"
              ? String(cell).slice(0, 500) : "")
        )
      };
    default:
      return {};
  }
}

/**
 * Invoke an allowlisted read-only Google Apps Script bridge.
 * Redirects are manually followed only to Google's ContentService response host,
 * without re-sending the shared token to that host.
 */
export async function runGoogleWorkspaceReadAction({
  env = process.env, fetchImpl = safePinnedFetch, userId, action, params = {}
} = {}) {
  if (!ownerAllowed(env, userId)) {
    return blocked("INTEGRATION_OWNER_ONLY", "Google Workspace is restricted to the configured ULTRON owner account.");
  }
  if (!ACTIONS.has(action)) {
    return blocked("GOOGLE_WORKSPACE_ACTION_NOT_ALLOWED",
      WRITE_ACTIONS.has(action)
        ? "Google Workspace write/delete actions are disabled; only read-only actions are allowed."
        : "This Google Workspace action is not supported.");
  }
  const config = bridgeConfig(env);
  if (config.error) return config.error;
  const normalized = normalizeActionParams(action, params);
  if (normalized.error) return normalized.error;

  try {
    const signal = AbortSignal.timeout(15_000);
    let response = await fetchImpl(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ bridgeToken: config.token, action, params: normalized }),
      redirect: "manual",
      signal
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return blocked("GOOGLE_WORKSPACE_REDIRECT_INVALID", "Google Workspace returned an invalid redirect.");
      let redirected;
      try { redirected = new URL(location, config.url); } catch {
        return blocked("GOOGLE_WORKSPACE_REDIRECT_INVALID", "Google Workspace returned an invalid redirect.");
      }
      if (redirected.protocol !== "https:" || redirected.hostname.toLowerCase() !== "script.googleusercontent.com" ||
          redirected.pathname !== "/macros/echo" || redirected.username || redirected.password || redirected.hash) {
        return blocked("GOOGLE_WORKSPACE_REDIRECT_BLOCKED", "Google Workspace redirect target was not an approved Google ContentService endpoint.");
      }
      try { await response.body?.cancel?.(); } catch {}
      // Do not forward the bridge token or action body to the redirect destination.
      response = await fetchImpl(redirected.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal
      });
    }
    if (!response.ok) return blocked("GOOGLE_WORKSPACE_UPSTREAM_FAILED", "Google Workspace bridge request failed; check the private bridge configuration.");
    const result = await readJsonLimited(response);
    if (result?.status !== "success") {
      return blocked("GOOGLE_WORKSPACE_BRIDGE_REJECTED", "Google Workspace bridge rejected the read request. Check the Script Properties token and deployed version.");
    }
    return {
      state: "completed",
      provider: "google-workspace",
      action,
      data: safeOutput(action, result.data)
    };
  } catch (error) {
    return blocked(error?.code || "GOOGLE_WORKSPACE_UPSTREAM_FAILED", "Google Workspace could not complete the read request. Check the private bridge and retry.");
  }
}
