/**
 * ULTRON AI — Immich Personal Media Library Connector
 * Evaluates and integrates private media asset management from immich-app/immich
 *
 * Implements an owner-scoped, read-only connector for listing albums, searching assets,
 * and inspecting photo metadata. Enforces strict private-media boundaries, least privilege,
 * and anti-SSRF network validation.
 */

import { safePinnedFetch, safeServiceBase } from "../network-safety.js";
const MAX_RESPONSE_BYTES = 256 * 1024;

function boundedLimit(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

async function readJsonLimited(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Immich response exceeded the size limit."), { code: "IMMICH_RESPONSE_TOO_LARGE" });
  }
  if (!response.body?.getReader) {
    throw Object.assign(new Error("Immich response cannot be safely size-limited."), { code: "IMMICH_RESPONSE_UNBOUNDED" });
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
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Immich response exceeded the size limit."), { code: "IMMICH_RESPONSE_TOO_LARGE" });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Immich returned invalid JSON."), { code: "IMMICH_INVALID_RESPONSE" }); }
}

export function getImmichReadiness(env = process.env) {
  const ownerUserId = String(env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim();
  const baseUrl = env.IMMICH_BASE_URL;
  const apiKey = env.IMMICH_API_KEY;

  if (!ownerUserId) {
    return {
      state: "owner_guard_required",
      configured: false,
      note: "Immich connector requires ULTRON_INTEGRATION_OWNER_USER_ID to isolate personal media access."
    };
  }

  if (!baseUrl || !apiKey) {
    return {
      state: "missing_configuration",
      configured: false,
      note: "Requires IMMICH_BASE_URL and IMMICH_API_KEY."
    };
  }

  const safeBase = safeServiceBase(baseUrl);
  if (!safeBase) {
    return {
      state: "unsafe_url_rejected",
      configured: false,
      note: "IMMICH_BASE_URL failed network safety validation. Must be an approved HTTPS origin or local loopback."
    };
  }

  return {
    state: "configured_unverified",
    configured: true,
    safeBase,
    note: "Immich connector is configured. Read-only personal media tools available."
  };
}

export class ImmichConnector {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.customFetch = options.fetch || safePinnedFetch;
  }

  /**
   * Asserts owner identity before granting media access.
   */
  assertOwnerAccess(userId) {
    const ownerUserId = String(this.env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim();
    if (!ownerUserId || userId !== ownerUserId) {
      throw new Error("ACCESS_DENIED: Immich personal media connector is restricted to the configured ULTRON owner.");
    }
  }

  /**
   * Verifies server reachability and API version.
   */
  async checkServerStatus(userId) {
    this.assertOwnerAccess(userId);
    const readiness = getImmichReadiness(this.env);
    if (!readiness.configured) {
      return { success: false, state: readiness.state, error: readiness.note };
    }

    try {
      const res = await this.customFetch(`${readiness.safeBase}/api/server/version`, {
        headers: {
          "x-api-key": this.env.IMMICH_API_KEY,
          "Accept": "application/json"
        },
        redirect: "error",
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        return { success: false, status: res.status, error: "IMMICH_SERVER_ERROR" };
      }

      const data = await readJsonLimited(res);
      return { success: true, version: data, online: true };
    } catch (err) {
      return { success: false, error: err.message, online: false };
    }
  }

  /**
   * Lists personal albums (read-only, limited to 50 items).
   */
  async listAlbums(userId, { limit = 20 } = {}) {
    this.assertOwnerAccess(userId);
    const readiness = getImmichReadiness(this.env);
    if (!readiness.configured) {
      return { success: false, state: readiness.state, albums: [] };
    }

    try {
      const res = await this.customFetch(`${readiness.safeBase}/api/albums`, {
        headers: {
          "x-api-key": this.env.IMMICH_API_KEY,
          "Accept": "application/json"
        },
        redirect: "error",
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { success: false, status: res.status, albums: [] };
      }

      const albums = await readJsonLimited(res);
      const boundedCount = boundedLimit(limit, 20, 50);
      const sanitized = (Array.isArray(albums) ? albums : []).slice(0, boundedCount).map(a => ({
        id: typeof a?.id === "string" ? a.id.slice(0, 128) : null,
        albumName: String(a?.albumName || "Untitled").slice(0, 100),
        assetCount: Number.isSafeInteger(Number(a?.assetCount)) ? Math.max(0, Number(a.assetCount)) : 0,
        createdAt: typeof a?.createdAt === "string" ? a.createdAt.slice(0, 40) : null
      }));

      return { success: true, count: sanitized.length, albums: sanitized };
    } catch (err) {
      return { success: false, error: err.code || err.message, albums: [] };
    }
  }

  /**
   * Searches assets by tag or query without downloading raw high-res binaries.
   */
  async searchAssets(userId, { query = "", limit = 10 } = {}) {
    this.assertOwnerAccess(userId);
    const readiness = getImmichReadiness(this.env);
    if (!readiness.configured) {
      return { success: false, state: readiness.state, assets: [] };
    }

    try {
      const res = await this.customFetch(`${readiness.safeBase}/api/search/metadata`, {
        method: "POST",
        headers: {
          "x-api-key": this.env.IMMICH_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ query: typeof query === "string" ? query.slice(0, 80) : "" }),
        redirect: "error",
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { success: false, status: res.status, assets: [] };
      }

      const data = await readJsonLimited(res);
      const boundedCount = boundedLimit(limit, 10, 30);
      const items = Array.isArray(data?.assets?.items) ? data.assets.items : [];
      const assets = items.slice(0, boundedCount).map(item => ({
        id: typeof item?.id === "string" ? item.id.slice(0, 128) : null,
        type: typeof item?.type === "string" ? item.type.slice(0, 24) : "UNKNOWN",
        originalFileName: typeof item?.originalFileName === "string" ? item.originalFileName.slice(0, 160) : null,
        fileCreatedAt: typeof item?.fileCreatedAt === "string" ? item.fileCreatedAt.slice(0, 40) : null,
        duration: Number.isFinite(item?.duration) ? Math.max(0, item.duration) : null,
        isFavorite: Boolean(item?.isFavorite)
      }));

      return { success: true, count: assets.length, assets };
    } catch (err) {
      return { success: false, error: err.code || err.message, assets: [] };
    }
  }
}

export const immichConnector = new ImmichConnector();
