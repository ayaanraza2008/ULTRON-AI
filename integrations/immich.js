/**
 * ULTRON AI — Immich Personal Media Library Connector
 * Evaluates and integrates private media asset management from immich-app/immich
 *
 * Implements an owner-scoped, read-only connector for listing albums, searching assets,
 * and inspecting photo metadata. Enforces strict private-media boundaries, least privilege,
 * and anti-SSRF network validation.
 */

import { safeServiceBase } from "../network-safety.js";

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
    this.customFetch = options.fetch || fetch;
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
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        return { success: false, status: res.status, error: "IMMICH_SERVER_ERROR" };
      }

      const data = await res.json();
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
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { success: false, status: res.status, albums: [] };
      }

      const albums = await res.json();
      const sanitized = (Array.isArray(albums) ? albums : []).slice(0, Math.min(50, limit)).map(a => ({
        id: a.id,
        albumName: String(a.albumName || "Untitled").slice(0, 100),
        assetCount: a.assetCount || 0,
        createdAt: a.createdAt
      }));

      return { success: true, count: sanitized.length, albums: sanitized };
    } catch (err) {
      return { success: false, error: err.message, albums: [] };
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
        body: JSON.stringify({ query: String(query).slice(0, 80) }),
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { success: false, status: res.status, assets: [] };
      }

      const data = await res.json();
      const assets = (data.assets?.items || []).slice(0, Math.min(30, limit)).map(item => ({
        id: item.id,
        type: item.type,
        originalFileName: item.originalFileName,
        fileCreatedAt: item.fileCreatedAt,
        duration: item.duration || null,
        isFavorite: Boolean(item.isFavorite)
      }));

      return { success: true, count: assets.length, assets };
    } catch (err) {
      return { success: false, error: err.message, assets: [] };
    }
  }
}

export const immichConnector = new ImmichConnector();
