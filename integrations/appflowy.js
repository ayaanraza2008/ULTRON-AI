/**
 * ULTRON AI — AppFlowy Read-Only Workspace Integration
 * Module: integrations/appflowy.js
 *
 * Implements an owner-scoped, read-only adapter to an AppFlowy Cloud
 * or AppFlowy Server API instance, allowing ULTRON to securely inspect
 * workspace documents, notes, and database schemas.
 *
 * Enforces least-privilege security boundaries:
 * - Read-only operations only (no workspace deletion, writing, or permission changes).
 * - Scoped strictly to the configured ULTRON_INTEGRATION_OWNER_USER_ID.
 * - Safe service URL validation (private/metadata IPs blocked, HTTPS required for remote).
 * - Strict response payload size caps (256 KB max).
 */

import { isIP } from "node:net";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_QUERY_CHARS = 1000;
const MAX_ID_CHARS = 128;

function bounded(value, max = MAX_QUERY_CHARS) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) return null;
  try {
    const normalized = safeServiceBase(value.trim());
    if (!normalized) return null;
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    const normalizedHost = host.replace(/^\[|\]$/g, "");
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(normalizedHost);
    const localHostname = host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "metadata.google.internal" || host === "metadata.google";
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.protocol === "https:" && (loopback || localHostname)) return null;
    if (isIP(normalizedHost) !== 0 && !loopback) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function resolveSettings(env = process.env) {
  const baseUrl = normalizeBaseUrl(env.APPFLOWY_BASE_URL || env.ULTRON_APPFLOWY_BASE_URL);
  const token = bounded(env.APPFLOWY_API_TOKEN || env.ULTRON_APPFLOWY_API_TOKEN, 2000);
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  return { baseUrl, token, ownerId, configured: Boolean(baseUrl && token) };
}

function ownerAllowed(settings, userId) {
  return Boolean(settings.ownerId && userId && settings.ownerId === userId);
}

/**
 * Reports configuration and owner readiness status for AppFlowy integration.
 */
export function getAppFlowyReadiness({ env = process.env, userId = null } = {}) {
  const settings = resolveSettings(env);
  const ownerGuardConfigured = Boolean(settings.ownerId);
  const ownerAuthorized = ownerAllowed(settings, userId);

  let state = "missing_configuration";
  if (settings.configured && !ownerGuardConfigured) state = "blocked_owner_guard";
  else if (settings.configured && userId && !ownerAuthorized) state = "owner_only";
  else if (settings.configured && ownerGuardConfigured) state = "configured_unverified";

  return {
    provider: "appflowy",
    name: "AppFlowy Workspace",
    state,
    configured: settings.configured,
    ownerGuardConfigured,
    ownerAuthorized: userId ? ownerAuthorized : null,
    capabilities: [
      "read_only_workspace_listing",
      "read_only_document_read",
      "read_only_database_listing"
    ],
    note: !settings.configured
      ? "Configure APPFLOWY_BASE_URL and APPFLOWY_API_TOKEN before use."
      : !ownerGuardConfigured
        ? "Configure ULTRON_INTEGRATION_OWNER_USER_ID before enabling this shared workspace connection."
        : userId && !ownerAuthorized
          ? "This shared AppFlowy credential is restricted to ULTRON's configured owner account."
          : "Configured; live read-only workspace read has not yet been verified."
  };
}

async function readResponseTextLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("AppFlowy response exceeded the size limit."), { code: "APPFLOWY_RESPONSE_TOO_LARGE" });
  }
  if (!response.body?.getReader) {
    throw Object.assign(new Error("AppFlowy response cannot be safely size-limited."), { code: "APPFLOWY_RESPONSE_UNBOUNDED" });
  }
  const reader = response.body.getReader();
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
        throw Object.assign(new Error("AppFlowy response exceeded the size limit."), { code: "APPFLOWY_RESPONSE_TOO_LARGE" });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  return raw;
}

/**
 * Lists user's accessible AppFlowy workspaces (read-only).
 */
export async function appflowyListWorkspaces({ env = process.env, userId = null, fetchImpl = safePinnedFetch } = {}) {
  const settings = resolveSettings(env);
  if (!settings.configured) {
    throw Object.assign(new Error("AppFlowy is not configured."), { code: "APPFLOWY_CONFIG_MISSING" });
  }
  if (!settings.ownerId) {
    throw Object.assign(new Error("AppFlowy requires a configured ULTRON_INTEGRATION_OWNER_USER_ID."), { code: "APPFLOWY_OWNER_REQUIRED" });
  }
  if (!userId || !ownerAllowed(settings, userId)) {
    throw Object.assign(new Error("AppFlowy workspace access is restricted to the configured owner."), { code: "APPFLOWY_OWNER_MISMATCH" });
  }

  const endpoint = `${settings.baseUrl}/api/v1/workspace/list`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${settings.token}`,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw Object.assign(new Error(`AppFlowy server returned HTTP ${response.status}`), {
      code: "APPFLOWY_HTTP_ERROR",
      status: response.status
    });
  }

  const raw = await readResponseTextLimited(response);
  const data = JSON.parse(raw);
  return {
    success: true,
    workspaces: Array.isArray(data.workspaces) ? data.workspaces : (Array.isArray(data) ? data : [])
  };
}

/**
 * Retrieves a specific document or page content (read-only).
 */
export async function appflowyGetDocument({ documentId, env = process.env, userId = null, fetchImpl = safePinnedFetch } = {}) {
  const cleanId = bounded(documentId, MAX_ID_CHARS);
  if (!cleanId || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) {
    throw Object.assign(new Error("Invalid AppFlowy documentId format."), { code: "APPFLOWY_INVALID_ID" });
  }

  const settings = resolveSettings(env);
  if (!settings.configured) {
    throw Object.assign(new Error("AppFlowy is not configured."), { code: "APPFLOWY_CONFIG_MISSING" });
  }
  if (!settings.ownerId) {
    throw Object.assign(new Error("AppFlowy requires a configured ULTRON_INTEGRATION_OWNER_USER_ID."), { code: "APPFLOWY_OWNER_REQUIRED" });
  }
  if (!userId || !ownerAllowed(settings, userId)) {
    throw Object.assign(new Error("AppFlowy document access is restricted to the configured owner."), { code: "APPFLOWY_OWNER_MISMATCH" });
  }

  const endpoint = `${settings.baseUrl}/api/v1/document/${encodeURIComponent(cleanId)}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${settings.token}`,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw Object.assign(new Error(`AppFlowy server returned HTTP ${response.status}`), {
      code: "APPFLOWY_HTTP_ERROR",
      status: response.status
    });
  }

  const raw = await readResponseTextLimited(response);
  const data = JSON.parse(raw);
  return {
    success: true,
    documentId: cleanId,
    content: data
  };
}
