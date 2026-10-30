import express from "express";
import { createHash, randomBytes } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAIRING_CODE_RE = /^[A-Za-z0-9_-]{32}$/;
const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_SECONDS = 30;
const ONLINE_WINDOW_MS = 90 * 1000;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cleanString(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function sendError(res, error, fallbackCode, fallbackMessage) {
  const status = Number(error?.status);
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : fallbackCode;
  const safeStatus = status >= 400 && status <= 599 ? status : 502;
  return res.status(safeStatus).json({ error: { code, message: fallbackMessage } });
}

export function createDesktopCompanionRelayRouter({
  requireSupabaseUser,
  supabaseRest,
  privilegedSupabaseRpc,
  now = () => Date.now(),
  logger = console
} = {}) {
  if (typeof requireSupabaseUser !== "function" ||
      typeof supabaseRest !== "function" ||
      typeof privilegedSupabaseRpc !== "function") {
    throw new TypeError("Desktop companion relay requires authenticated and privileged Supabase adapters.");
  }

  const router = express.Router();

  // The authenticated browser creates a high-entropy pairing code. Only its
  // hash is stored; the one-time code is returned once and expires after 5 min.
  router.post("/desktop-companion/pairings", requireSupabaseUser, async (req, res) => {
    const userId = typeof req.supabaseUser?.id === "string" ? req.supabaseUser.id : "";
    if (!UUID_RE.test(userId)) {
      return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to pair a device." } });
    }

    const pairingCode = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now() + PAIRING_TTL_MS).toISOString();
    try {
      await supabaseRest(
        req,
        "desktop_companion_pairings",
        "POST",
        "",
        { user_id: userId, code_hash: sha256(pairingCode), expires_at: expiresAt },
        "return=minimal"
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      return res.status(201).json({
        pairingCode,
        expiresAt,
        expiresInSeconds: PAIRING_TTL_MS / 1000,
        instructions: "Enter this one-time code in the Windows companion. It will not be shown again."
      });
    } catch (error) {
      logger.warn?.("Desktop companion pairing code could not be created", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_PAIRING_CREATE_FAILED", "Could not create a device pairing code.");
    }
  });

  // Device exchange is unauthenticated by design: possession of the short-lived
  // one-time code is the authorization. The database consumes it atomically.
  router.post("/desktop-companion/pair", async (req, res) => {
    const pairingCode = cleanString(req.body?.pairingCode, 64);
    const deviceId = cleanString(req.body?.deviceId, 64);
    const deviceName = cleanString(req.body?.deviceName, 120) || "Windows PC";
    if (!PAIRING_CODE_RE.test(pairingCode) || !UUID_RE.test(deviceId)) {
      return res.status(400).json({ error: { code: "INVALID_PAIRING_REQUEST", message: "Provide a valid one-time code and device identity." } });
    }

    const deviceToken = randomBytes(32).toString("base64url");
    try {
      const result = await privilegedSupabaseRpc("complete_desktop_companion_pairing", {
        p_code_hash: sha256(pairingCode),
        p_device_id: deviceId,
        p_device_name: deviceName,
        p_token_hash: sha256(deviceToken)
      });
      const paired = Array.isArray(result) ? result[0] : result;
      if (!paired?.companion_device_id || !paired?.owner_user_id) {
        return res.status(410).json({ error: { code: "PAIRING_CODE_EXPIRED_OR_USED", message: "This pairing code has expired or was already used. Generate a new code in ULTRON." } });
      }

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      return res.status(201).json({
        deviceId,
        deviceName,
        platform: "windows",
        deviceToken,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        notice: "Store this device token privately. It is shown only once and grants status heartbeat access, not PC control."
      });
    } catch (error) {
      logger.warn?.("Desktop companion pairing exchange failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_PAIRING_FAILED", "The device could not complete pairing.");
    }
  });

  // The companion initiates every heartbeat over HTTPS. No server-to-device
  // connection or command channel exists in this relay.
  router.post("/desktop-companion/heartbeat", async (req, res) => {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const deviceId = cleanString(req.body?.deviceId, 64);
    if (!match || !DEVICE_TOKEN_RE.test(match[1]) || !UUID_RE.test(deviceId)) {
      return res.status(401).json({ error: { code: "DEVICE_AUTH_REQUIRED", message: "A valid paired-device token and identity are required." } });
    }

    try {
      const accepted = await privilegedSupabaseRpc("record_desktop_companion_heartbeat", {
        p_token_hash: sha256(match[1]),
        p_device_id: deviceId
      });
      if (accepted !== true) {
        return res.status(401).json({ error: { code: "DEVICE_TOKEN_REVOKED_OR_UNKNOWN", message: "This device token is invalid or has been revoked. Pair the device again." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ status: "online", serverTime: new Date(now()).toISOString(), nextHeartbeatSeconds: HEARTBEAT_INTERVAL_SECONDS });
    } catch (error) {
      logger.warn?.("Desktop companion heartbeat could not be recorded", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_HEARTBEAT_FAILED", "The device heartbeat could not be recorded.");
    }
  });

  router.get("/desktop-companion/devices", requireSupabaseUser, async (req, res) => {
    try {
      const rows = await supabaseRest(
        req,
        "desktop_companion_devices",
        "GET",
        "?select=id,device_id,device_name,platform,created_at,last_seen_at,revoked_at&order=created_at.desc"
      );
      const currentTime = now();
      const devices = (Array.isArray(rows) ? rows : []).map(item => {
        const lastSeen = typeof item.last_seen_at === "string" ? Date.parse(item.last_seen_at) : NaN;
        const age = Number.isFinite(lastSeen) ? currentTime - lastSeen : Number.POSITIVE_INFINITY;
        return {
          id: cleanString(item.id, 64),
          deviceId: cleanString(item.device_id, 64),
          name: cleanString(item.device_name, 120),
          platform: item.platform === "windows" ? "windows" : "unknown",
          pairedAt: cleanString(item.created_at, 40) || null,
          lastSeenAt: Number.isFinite(lastSeen) ? new Date(lastSeen).toISOString() : null,
          online: item.revoked_at == null && age >= -30_000 && age <= ONLINE_WINDOW_MS,
          revoked: item.revoked_at != null
        };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ devices, heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS, onlineWindowSeconds: ONLINE_WINDOW_MS / 1000 });
    } catch (error) {
      logger.warn?.("Desktop companion device list failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_DEVICE_LIST_FAILED", "Could not load paired device status.");
    }
  });

  router.post("/desktop-companion/devices/:id/revoke", requireSupabaseUser, async (req, res) => {
    const deviceId = cleanString(req.params.id, 64);
    if (!UUID_RE.test(deviceId)) {
      return res.status(400).json({ error: { code: "INVALID_DEVICE_ID", message: "Provide a valid device record ID." } });
    }
    try {
      const revoked = await supabaseRest(
        req,
        "rpc/revoke_desktop_companion_device",
        "POST",
        "",
        { p_device_id: deviceId }
      );
      if (revoked !== true) {
        return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "The device is not active or does not belong to this account." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ revoked: true, deviceRecordId: deviceId });
    } catch (error) {
      logger.warn?.("Desktop companion revocation failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_DEVICE_REVOKE_FAILED", "Could not revoke this device.");
    }
  });

  return router;
}
