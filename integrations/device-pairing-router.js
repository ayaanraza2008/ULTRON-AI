import express from "express";
import crypto from "node:crypto";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";
import { deviceHub as defaultDeviceHub } from "./device-hub.js";

const ALLOWED_PLATFORMS = new Set(["windows", "android", "linux", "macos", "ios"]);
const MAX_RESPONSE_BYTES = 64 * 1024;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const ANDROID_HEARTBEAT_MAX_AGE_MS = 35 * 60 * 1000;
const DESKTOP_HEARTBEAT_MAX_AGE_MS = 90 * 1000;

function isDeviceRecentlySeen(lastSeenAt, platform, now = Date.now()) {
  const lastSeen = Date.parse(lastSeenAt || "");
  if (!Number.isFinite(lastSeen)) return false;
  const ageMs = now - lastSeen;
  if (ageMs < 0) return false;
  const maxAgeMs = platform === "android"
    ? ANDROID_HEARTBEAT_MAX_AGE_MS
    : DESKTOP_HEARTBEAT_MAX_AGE_MS;
  return ageMs <= maxAgeMs;
}

function bounded(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw Object.assign(new Error("Durable device pairing requires a dedicated ULTRON_DEVICE_SIGNING_SECRET with at least 32 characters."), {
      status: 503,
      code: "DEVICE_SIGNING_SECRET_REQUIRED"
    });
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function encryptToken(token, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}

function decryptToken(value, secret) {
  if (typeof value !== "string") throw new Error("Encrypted pairing token is missing.");
  const [version, ivHex, tagHex, ciphertextHex, extra] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !ciphertextHex || extra !== undefined ||
      !/^[a-f0-9]{24}$/i.test(ivHex) || !/^[a-f0-9]{32}$/i.test(tagHex) ||
      !/^(?:[a-f0-9]{2})+$/i.test(ciphertextHex)) {
    throw new Error("Encrypted pairing token has an invalid format.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final()
  ]).toString("utf8");
}

async function readJsonLimited(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Supabase device response exceeded the safety limit."), { status: 502, code: "DEVICE_RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Supabase device response could not be safely read."), { status: 502, code: "DEVICE_RESPONSE_INVALID" });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Supabase device response exceeded the safety limit."), { status: 502, code: "DEVICE_RESPONSE_TOO_LARGE" });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error("Supabase returned invalid JSON for the device operation."), { status: 502, code: "DEVICE_RESPONSE_INVALID" }); }
}

function mapDatabaseError(response, payload) {
  const rawCode = bounded(payload?.code, 32);
  if (response.status === 404) {
    return Object.assign(new Error("Paired-device storage is not installed yet. Apply the reviewed ULTRON device-pairing migration first."), {
      status: 503, code: "DEVICE_STORAGE_NOT_READY"
    });
  }
  if (response.status === 409 || rawCode === "23505") {
    return Object.assign(new Error("A pairing request with that code already exists. Retry the request."), {
      status: 409, code: "PAIRING_CODE_COLLISION"
    });
  }
  if (rawCode === "P0001" || response.status === 400) {
    return Object.assign(new Error("The pairing code is invalid, expired, already claimed, or not approved."), {
      status: 400, code: "PAIRING_CODE_INVALID"
    });
  }
  if (response.status === 401 || response.status === 403) {
    return Object.assign(new Error("Supabase denied the server-side device operation. Check the service-role credential."), {
      status: 503, code: "DEVICE_STORAGE_FORBIDDEN"
    });
  }
  return Object.assign(new Error("Supabase could not complete the device operation."), {
    status: 502, code: "DEVICE_STORAGE_FAILED"
  });
}

function mapPairedDeviceDatabaseError(response, payload) {
  const rawCode = bounded(payload?.code, 32);
  if (response.status === 404) {
    return Object.assign(new Error("Paired-device storage is not installed yet. Apply the reviewed ULTRON device-pairing migration first."), {
      status: 503, code: "DEVICE_STORAGE_NOT_READY"
    });
  }
  if (response.status === 409 || rawCode === "23505") {
    return Object.assign(new Error("A pairing request with that code already exists. Retry the request."), {
      status: 409, code: "PAIRING_CODE_COLLISION"
    });
  }
  if (rawCode === "P0001" || response.status === 400) {
    return Object.assign(new Error("The pairing code is invalid, expired, already claimed, or not approved."), {
      status: 400, code: "PAIRING_CODE_INVALID"
    });
  }
  if (response.status === 401 || response.status === 403) {
    return Object.assign(new Error("Supabase denied the server-side device operation. Check the service-role credential."), {
      status: 503, code: "DEVICE_STORAGE_FORBIDDEN"
    });
  }
  return Object.assign(new Error("Supabase could not complete the device operation."), {
    status: 502, code: "DEVICE_STORAGE_FAILED"
  });
}

export function createDevicePairingRouter({
  env = process.env,
  fetchImpl = safePinnedFetch,
  requireSupabaseUser,
  deviceHub: deviceHubInstance = defaultDeviceHub,
  logger = console
} = {}) {
  if (typeof requireSupabaseUser !== "function") {
    throw new TypeError("createDevicePairingRouter requires authenticated Supabase user middleware.");
  }

  // This runtime is intentionally a single-owner personal AI instance.
  // Paired-device bearer tokens must obey the same owner boundary as signed-in routes.
  const configuredOwnerUserId = String(env.ULTRON_OWNER_USER_ID || env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim();
  const requireConfiguredOwner = (req, res, next) => requireSupabaseUser(req, res, () => {
    if (!configuredOwnerUserId) {
      return res.status(503).json({
        error: {
          code: "ULTRON_OWNER_NOT_CONFIGURED",
          message: "Device management is disabled until the ULTRON owner user ID is configured."
        }
      });
    }
    if (!req.supabaseUser?.id || req.supabaseUser.id !== configuredOwnerUserId) {
      return res.status(403).json({
        error: {
          code: "ULTRON_OWNER_ONLY",
          message: "Device management is restricted to the configured ULTRON owner."
        }
      });
    }
    return next();
  });

  const router = express.Router();
  const claimAttempts = new Map();

  function supabaseConfig() {
    const rawUrl = bounded(env.SUPABASE_URL, 2000);
    const serviceKey = bounded(env.SUPABASE_SERVICE_ROLE_KEY, 5000);
    if (!rawUrl || !serviceKey) {
      throw Object.assign(new Error("Supabase server-side storage is not configured."), { status: 503, code: "DEVICE_STORAGE_NOT_CONFIGURED" });
    }
    let url;
    try { url = safeServiceBase(rawUrl); } catch { url = null; }
    if (!url || !url.startsWith("https://")) {
      throw Object.assign(new Error("Supabase URL must be a valid HTTPS project URL."), { status: 503, code: "DEVICE_STORAGE_URL_INVALID" });
    }
    return { url: url.replace(/\/+$/, ""), serviceKey };
  }

  async function databaseRequest(path, { method = "GET", body, prefer = "return=representation" } = {}) {
    const config = supabaseConfig();
    let response;
    try {
      response = await fetchImpl(config.url + path, {
        method,
        headers: {
          apikey: config.serviceKey,
          ...(config.serviceKey.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + config.serviceKey }),
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json", Prefer: prefer })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(12_000)
      });
    } catch (error) {
      logger.warn?.("Device storage request failed", { name: error?.name || "Error" });
      throw Object.assign(new Error("Could not reach ULTRON's Supabase device storage."), { status: 502, code: "DEVICE_STORAGE_UNAVAILABLE" });
    }
    const payload = response.status === 204 ? null : await readJsonLimited(response);
    if (!response.ok) throw mapDatabaseError(response, payload);
    return payload;
  }

  function requireSigningSecret() {
    return encryptionKey(String(env.ULTRON_DEVICE_SIGNING_SECRET || ""));
  }

  function claimRateLimit(req, res, next) {
    const key = bounded(req.ip || req.socket?.remoteAddress || "unknown", 128);
    const now = Date.now();
    const bucket = claimAttempts.get(key);
    if (!bucket || now - bucket.startedAt >= 60_000 || now < bucket.startedAt) {
      claimAttempts.set(key, { startedAt: now, count: 1 });
    } else {
      bucket.count += 1;
      if (bucket.count > 8) {
        res.setHeader("Retry-After", "60");
        res.setHeader("Cache-Control", "no-store");
        return res.status(429).json({ error: { code: "DEVICE_PAIRING_RATE_LIMITED", message: "Too many pairing attempts. Wait one minute and try again." } });
      }
    }
    if (claimAttempts.size > 2000) {
      for (const [entry, value] of claimAttempts) {
        if (now - value.startedAt > 60_000) claimAttempts.delete(entry);
      }
      while (claimAttempts.size > 2000) claimAttempts.delete(claimAttempts.keys().next().value);
    }
    next();
  }

  async function requirePairedDevice(req, res, next) {
    const headerToken = req.headers["x-device-token"];
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === "string" && /^Bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^Bearer\s+/i, "").trim()
      : "";
    const token = typeof headerToken === "string" && headerToken.trim() ? headerToken.trim() : bearerToken;
    if (!token) {
      return res.status(401).json({ error: { code: "DEVICE_TOKEN_REQUIRED", message: "A paired-device token is required." } });
    }
    try {
      const verified = await verifyPairedDeviceToken({ token, env, fetchImpl, logger });
      if (!verified) {
        return res.status(401).json({ error: { code: "INVALID_DEVICE_TOKEN", message: "The device token is invalid, expired, or revoked." } });
      }
      if (!configuredOwnerUserId) {
        return res.status(503).json({
          error: {
            code: "ULTRON_OWNER_NOT_CONFIGURED",
            message: "Paired-device access is disabled until the ULTRON owner user ID is configured."
          }
        });
      }
      const verifiedOwnerUserId = String(verified.ownerUserId || verified.owner_user_id || "").trim();
      if (!verifiedOwnerUserId || verifiedOwnerUserId !== configuredOwnerUserId) {
        return res.status(403).json({
          error: {
            code: "ULTRON_OWNER_ONLY",
            message: "This paired device does not belong to the configured ULTRON owner."
          }
        });
      }
      const device = deviceHubInstance.importPairedDevice({ ...verified, authToken: token });
      if (!device) {
        return res.status(401).json({ error: { code: "INVALID_DEVICE_IDENTITY", message: "The paired device identity could not be loaded." } });
      }
      req.pairedDevice = device;
      return next();
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_AUTHENTICATION_FAILED", message: error.message || "Device authentication failed." } });
    }
  }

  router.get("/devices", requireConfiguredOwner, async (req, res) => {
    if (!isUuid(req.supabaseUser?.id)) {
      return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to manage your paired devices." } });
    }
    try {
      const rows = await databaseRequest(
        "/rest/v1/paired_devices?select=id,device_name,platform,status,token_prefix,last_seen_at,paired_at,revoked_at&owner_user_id=eq." +
        encodeURIComponent(req.supabaseUser.id) + "&order=paired_at.desc&limit=50"
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ devices: Array.isArray(rows) ? rows : [] });
    } catch (error) {
      res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_LIST_FAILED", message: error.message } });
    }
  });

  router.get("/devices/me", requirePairedDevice, async (req, res) => {
    try {
      const ownerId = req.pairedDevice.ownerUserId;
      const rows = await databaseRequest(
        "/rest/v1/paired_devices?select=id,device_name,platform,status,last_seen_at,paired_at,battery_percent,is_charging&owner_user_id=eq." +
        encodeURIComponent(ownerId) + "&status=eq.active&order=paired_at.desc&limit=50"
      );
      const now = Date.now();
      const devices = (Array.isArray(rows) ? rows : []).map(row => {
        return {
          id: row.id,
          name: row.device_name,
          platform: row.platform,
          status: row.status,
          pairedAt: row.paired_at,
          lastSeenAt: row.last_seen_at,
          online: isDeviceRecentlySeen(row.last_seen_at, row.platform, now),
          battery: typeof row.battery_percent === "number"
            ? { percent: row.battery_percent, isCharging: Boolean(row.is_charging) }
            : null
        };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ deviceId: req.pairedDevice.id, devices });
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_STATUS_FAILED", message: error.message } });
    }
  });

  router.post("/devices/me/heartbeat", requirePairedDevice, async (req, res) => {
    try {
      const device = req.pairedDevice;
      const patch = { last_seen_at: new Date().toISOString() };
      if (typeof req.body?.batteryPercent === "number" && Number.isFinite(req.body.batteryPercent)) {
        patch.battery_percent = Math.max(0, Math.min(100, Math.round(req.body.batteryPercent)));
      }
      if (typeof req.body?.isCharging === "boolean") {
        patch.is_charging = req.body.isCharging;
      }
      const rows = await databaseRequest(
        "/rest/v1/paired_devices?id=eq." + encodeURIComponent(device.id) +
        "&owner_user_id=eq." + encodeURIComponent(device.ownerUserId) +
        "&status=eq.active&select=id,last_seen_at,battery_percent,is_charging",
        { method: "PATCH", body: patch, prefer: "return=representation" }
      );
      if (!Array.isArray(rows) || !rows[0]?.id) {
        return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "The paired device is no longer active." } });
      }
      deviceHubInstance.heartbeat(device.id, device.authToken, {
        batteryPercent: patch.battery_percent,
        isCharging: patch.is_charging
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, deviceId: device.id, lastSeenAt: rows[0].last_seen_at });
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_HEARTBEAT_FAILED", message: error.message } });
    }
  });

  router.post("/devices/pairings", requireConfiguredOwner, async (req, res) => {
    const ownerId = req.supabaseUser?.id;
    if (!isUuid(ownerId)) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in before pairing a device." } });
    const platform = bounded(req.body?.platform, 20).toLowerCase();
    const deviceName = bounded(req.body?.deviceName || req.body?.device_name, 120);
    if (!ALLOWED_PLATFORMS.has(platform) || !deviceName) {
      return res.status(400).json({ error: { code: "INVALID_DEVICE_DETAILS", message: "Provide a device name (1–120 characters) and a supported platform." } });
    }

    try {
      requireSigningSecret();
      const code = crypto.randomInt(100000, 1000000).toString();
      const deviceId = crypto.randomUUID();
      const token = "ultron_dev_" + crypto.randomBytes(32).toString("hex");
      const now = Date.now();
      const expiresAt = new Date(now + PAIRING_TTL_MS).toISOString();
      const row = {
        code,
        device_name: deviceName,
        platform,
        approved: true,
        approved_by: ownerId,
        device_id: deviceId,
        token_hash: tokenHash(token),
        token_prefix: token.slice(0, 20),
        encrypted_token: encryptToken(token, String(env.ULTRON_DEVICE_SIGNING_SECRET)),
        created_at: new Date(now).toISOString(),
        expires_at: expiresAt
      };
      const inserted = await databaseRequest("/rest/v1/pending_device_pairings?select=code,expires_at", {
        method: "POST", body: row, prefer: "return=representation"
      });
      if (!Array.isArray(inserted) || !inserted[0]?.code) {
        return res.status(502).json({ error: { code: "PAIRING_CREATE_FAILED", message: "Supabase did not confirm the new pairing request." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({
        pairingCode: code,
        expiresAt,
        deviceName,
        platform,
        claimEndpoint: "/api/devices/pairings/claim",
        instruction: "Enter this one-time code in the installed ULTRON companion. It expires in five minutes and can be claimed only once."
      });
    } catch (error) {
      logger.warn?.("Device pairing creation failed", { code: error?.code || "DEVICE_PAIRING_FAILED" });
      return res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_PAIRING_FAILED", message: error.message } });
    }
  });

  router.post("/devices/pairings/claim", claimRateLimit, async (req, res) => {
    const code = bounded(req.body?.code || req.body?.pairingCode, 6);
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: { code: "INVALID_PAIRING_CODE", message: "Enter the six-digit pairing code shown by your ULTRON account." } });
    }
    try {
      const secret = String(env.ULTRON_DEVICE_SIGNING_SECRET || "");
      requireSigningSecret();
      const result = await databaseRequest("/rest/v1/rpc/claim_pending_device_pairing", {
        method: "POST",
        body: { p_code: code },
        prefer: "return=representation"
      });
      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.device_id || !row?.encrypted_token || !row?.token_hash) {
        return res.status(400).json({ error: { code: "PAIRING_CODE_INVALID", message: "The pairing code is invalid, expired, or already claimed." } });
      }
      let token;
      try { token = decryptToken(row.encrypted_token, secret); }
      catch {
        logger.error?.("Device pairing token could not be decrypted; revoke the returned device row before retrying.");
        return res.status(503).json({ error: { code: "DEVICE_TOKEN_DECRYPT_FAILED", message: "Pairing credentials could not be recovered. Ask the owner to rotate or remove this device and create a new pairing code." } });
      }
      if (!crypto.timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(String(row.token_hash), "hex"))) {
        return res.status(503).json({ error: { code: "DEVICE_TOKEN_INTEGRITY_FAILED", message: "Pairing credential integrity verification failed. Ask the owner to create a new pairing code." } });
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      return res.status(200).json({
        deviceId: row.device_id,
        deviceToken: token,
        deviceName: row.device_name,
        platform: row.platform,
        paired: true
      });
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_PAIRING_CLAIM_FAILED", message: error.message } });
    }
  });

  router.post("/devices/:id/rotate-token", requireConfiguredOwner, async (req, res) => {
    const ownerId = req.supabaseUser?.id;
    if (!isUuid(ownerId) || !isUuid(req.params.id)) {
      return res.status(400).json({ error: { code: "INVALID_DEVICE_ID", message: "Device ID is invalid." } });
    }
    try {
      requireSigningSecret();
      const token = "ultron_dev_" + crypto.randomBytes(32).toString("hex");
      const rows = await databaseRequest(
        "/rest/v1/paired_devices?id=eq." + encodeURIComponent(req.params.id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&select=id",
        {
          method: "PATCH",
          body: { token_hash: tokenHash(token), token_prefix: token.slice(0, 20), status: "active", revoked_at: null, last_seen_at: null },
          prefer: "return=representation"
        }
      );
      if (!Array.isArray(rows) || !rows[0]?.id) {
        return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "No device with that ID belongs to this account." } });
      }

      // Keep the in-process credential cache aligned with the database and
      // invalidate every already-authenticated transport for the old token.
      const inMemoryDevice = deviceHubInstance.pairedDevices.get(rows[0].id);
      if (inMemoryDevice && inMemoryDevice.ownerUserId === ownerId) {
        inMemoryDevice.authToken = token;
        inMemoryDevice.tokenHash = tokenHash(token);
        inMemoryDevice.tokenPrefix = token.slice(0, 20);
        inMemoryDevice.encryptedAuthToken = null;
        inMemoryDevice.status = "active";
        inMemoryDevice.revokedAt = null;
        inMemoryDevice.online = false;
        inMemoryDevice.lastSeenAt = null;
        deviceHubInstance.saveToDisk();
      }
      deviceHubInstance.emitEvent?.({
        type: "DEVICE_CREDENTIALS_ROTATED",
        deviceId: rows[0].id,
        ownerUserId: ownerId
      });

      res.setHeader("Cache-Control", "no-store");
      return res.json({ deviceId: rows[0].id, deviceToken: token, rotated: true });
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_TOKEN_ROTATION_FAILED", message: error.message } });
    }
  });

  router.delete("/devices/:id", requireConfiguredOwner, async (req, res) => {
    const ownerId = req.supabaseUser?.id;
    if (!isUuid(ownerId) || !isUuid(req.params.id)) {
      return res.status(400).json({ error: { code: "INVALID_DEVICE_ID", message: "Device ID is invalid." } });
    }
    try {
      const rows = await databaseRequest(
        "/rest/v1/paired_devices?id=eq." + encodeURIComponent(req.params.id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&select=id",
        { method: "PATCH", body: { status: "revoked", revoked_at: new Date().toISOString() }, prefer: "return=representation" }
      );
      if (!Array.isArray(rows) || !rows[0]?.id) {
        return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "No device with that ID belongs to this account." } });
      }

      // Revoke the in-memory identity and close authenticated WebSocket/SSE
      // sessions immediately; database rejection alone affects only reconnects.
      deviceHubInstance.revokeDevice(rows[0].id, ownerId);
      deviceHubInstance.emitEvent?.({
        type: "DEVICE_REVOKED",
        deviceId: rows[0].id,
        ownerUserId: ownerId
      });

      res.json({ ok: true, revoked: true, deviceId: rows[0].id });
    } catch (error) {
      res.status(error.status || 502).json({ error: { code: error.code || "DEVICE_REVOKE_FAILED", message: error.message } });
    }
  });

  return router;
}

export async function verifyPairedDeviceToken({ token, env = process.env, fetchImpl = safePinnedFetch, logger = console } = {}) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return null;
  try {
    const rawUrl = bounded(env.SUPABASE_URL, 2000);
    const serviceKey = bounded(env.SUPABASE_SERVICE_ROLE_KEY, 5000);
    if (!rawUrl || !serviceKey) return null;
    let base;
    try { base = safeServiceBase(rawUrl); } catch { return null; }
    if (!base?.startsWith("https://")) return null;
    const hash = tokenHash(token);
    const response = await fetchImpl(
      base.replace(/\/+$/, "") + "/rest/v1/paired_devices?select=id,owner_user_id,device_name,platform,status&token_hash=eq." +
      encodeURIComponent(hash) + "&status=eq.active&limit=1",
      {
        headers: {
          apikey: serviceKey,
          ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + serviceKey }),
          Accept: "application/json"
        },
        redirect: "error",
        signal: AbortSignal.timeout(8000)
      }
    );
    const rows = await readJsonLimited(response);
    if (!response.ok) throw mapPairedDeviceDatabaseError(response, rows);
    if (!Array.isArray(rows) || !rows[0]?.id) return null;
    const row = rows[0];
    return { id: row.id, ownerUserId: row.owner_user_id, name: row.device_name, platform: row.platform, status: row.status, authToken: token };
  } catch (error) {
    logger.warn?.("Paired device token verification failed", { name: error?.name || "Error" });
    if (Number(error?.status) >= 500) throw error;
    return null;
  }
}
