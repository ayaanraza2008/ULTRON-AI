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

  const allowedActions = new Map([
    ["launch_application", new Set(["notepad", "explorer", "calculator"])],
    ["open_known_folder", new Set(["desktop", "documents", "downloads"])]
  ]);

  // The browser may request only one of six fixed actions. Supabase RLS and the
  // SECURITY DEFINER function verify that the device belongs to this user and
  // has sent a heartbeat within the last 90 seconds.
  router.post("/desktop-companion/devices/:id/commands", requireSupabaseUser, async (req, res) => {
    const deviceRecordId = cleanString(req.params.id, 64);
    const actionType = cleanString(req.body?.actionType, 40);
    const target = cleanString(req.body?.target, 40);
    if (!UUID_RE.test(deviceRecordId) || !allowedActions.get(actionType)?.has(target)) {
      return res.status(400).json({ error: { code: "INVALID_DESKTOP_ACTION", message: "Choose an allowlisted application or standard folder." } });
    }

    try {
      const created = await supabaseRest(
        req,
        "rpc/create_desktop_companion_command",
        "POST",
        "",
        { p_device_record_id: deviceRecordId, p_action_type: actionType, p_target: target }
      );
      const command = Array.isArray(created) ? created[0] : created;
      if (!command?.command_id) {
        return res.status(409).json({ error: { code: "DEVICE_NOT_READY_OR_ACTION_PENDING", message: "The device must be online, and it can handle only one outstanding action at a time." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({
        command: {
          id: cleanString(command.command_id, 64),
          actionType,
          target,
          status: "pending",
          expiresAt: cleanString(command.command_expires_at, 40) || null
        },
        approvalRequiredOnDevice: true
      });
    } catch (error) {
      logger.warn?.("Desktop action request could not be created", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_CREATE_FAILED", "Could not request an action on this device.");
    }
  });

  router.get("/desktop-companion/devices/:id/commands", requireSupabaseUser, async (req, res) => {
    const deviceRecordId = cleanString(req.params.id, 64);
    if (!UUID_RE.test(deviceRecordId)) {
      return res.status(400).json({ error: { code: "INVALID_DEVICE_ID", message: "Provide a valid device record ID." } });
    }
    try {
      const rows = await supabaseRest(
        req,
        "desktop_companion_commands",
        "GET",
        "?select=id,device_record_id,action_type,target,status,created_at,expires_at,delivered_at,completed_at,result_code&device_record_id=eq." +
          encodeURIComponent(deviceRecordId) + "&order=created_at.desc&limit=10"
      );
      const commands = (Array.isArray(rows) ? rows : []).map(item => ({
        id: cleanString(item.id, 64),
        actionType: allowedActions.has(item.action_type) ? item.action_type : "unknown",
        target: cleanString(item.target, 40),
        status: ["pending", "delivered", "completed", "rejected", "failed", "expired"].includes(item.status) ? item.status : "unknown",
        createdAt: cleanString(item.created_at, 40) || null,
        expiresAt: cleanString(item.expires_at, 40) || null,
        completedAt: cleanString(item.completed_at, 40) || null,
        resultCode: cleanString(item.result_code, 40) || null
      }));
      res.setHeader("Cache-Control", "no-store");
      return res.json({ commands });
    } catch (error) {
      logger.warn?.("Desktop action history could not be loaded", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_HISTORY_FAILED", "Could not load this device's action history.");
    }
  });

  // Device polling is outbound-only. A paired device token can claim one fresh
  // command for its own UUID; it cannot list or control another device.
  router.post("/desktop-companion/commands/next", async (req, res) => {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const deviceId = cleanString(req.body?.deviceId, 64);
    if (!match || !DEVICE_TOKEN_RE.test(match[1]) || !UUID_RE.test(deviceId)) {
      return res.status(401).json({ error: { code: "DEVICE_AUTH_REQUIRED", message: "A valid paired-device token and identity are required." } });
    }
    try {
      const claimed = await privilegedSupabaseRpc("claim_desktop_companion_command", {
        p_token_hash: sha256(match[1]),
        p_device_id: deviceId
      });
      const command = Array.isArray(claimed) ? claimed[0] : claimed;
      const actionType = command?.action_type;
      const target = command?.target;
      if (!command?.command_id || !allowedActions.get(actionType)?.has(target)) {
        res.setHeader("Cache-Control", "no-store");
        return res.json({ command: null, pollIntervalSeconds: 5 });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        command: {
          id: cleanString(command.command_id, 64),
          actionType,
          target,
          expiresAt: cleanString(command.expires_at, 40) || null
        },
        pollIntervalSeconds: 5
      });
    } catch (error) {
      logger.warn?.("Desktop action command claim failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_CLAIM_FAILED", "Could not check for an approved desktop action request.");
    }
  });

  // A just-approved command is revalidated immediately before the local
  // Windows executor runs. Revoked devices and expired commands fail closed.
  router.post("/desktop-companion/commands/:id/authorize", async (req, res) => {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const deviceId = cleanString(req.body?.deviceId, 64);
    const commandId = cleanString(req.params.id, 64);
    if (!match || !DEVICE_TOKEN_RE.test(match[1]) || !UUID_RE.test(deviceId) ||
        !UUID_RE.test(commandId) || !req.body || Object.keys(req.body).join(",") !== "deviceId") {
      return res.status(400).json({ error: { code: "INVALID_DESKTOP_ACTION_AUTHORIZATION", message: "The local action authorization request was invalid." } });
    }
    try {
      const authorized = await privilegedSupabaseRpc("authorize_desktop_companion_command", {
        p_token_hash: sha256(match[1]),
        p_device_id: deviceId,
        p_command_id: commandId
      });
      if (authorized !== true) {
        return res.status(409).json({ error: { code: "DESKTOP_ACTION_NO_LONGER_AUTHORIZED", message: "This command expired, was revoked, or is no longer assigned to this device." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ authorized: true, commandId });
    } catch (error) {
      logger.warn?.("Desktop action authorization failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_AUTHORIZATION_FAILED", "Could not authorize the local desktop action.");
    }
  });

  router.post("/desktop-companion/commands/:id/result", async (req, res) => {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const deviceId = cleanString(req.body?.deviceId, 64);
    const commandId = cleanString(req.params.id, 64);
    const resultCode = cleanString(req.body?.resultCode, 40);
    const resultStatus = req.body?.status;
    const statusByResult = new Map([
      ["USER_APPROVED", "completed"],
      ["USER_REJECTED", "rejected"],
      ["ACTION_COMPLETED", "completed"],
      ["ACTION_FAILED", "failed"]
    ]);
    if (!match || !DEVICE_TOKEN_RE.test(match[1]) || !UUID_RE.test(deviceId) ||
        !UUID_RE.test(commandId) || !statusByResult.has(resultCode) ||
        statusByResult.get(resultCode) !== resultStatus) {
      return res.status(400).json({ error: { code: "INVALID_DESKTOP_ACTION_RESULT", message: "The desktop action result was invalid." } });
    }
    try {
      const accepted = await privilegedSupabaseRpc("complete_desktop_companion_command", {
        p_token_hash: sha256(match[1]),
        p_device_id: deviceId,
        p_command_id: commandId,
        p_status: resultStatus,
        p_result_code: resultCode
      });
      if (accepted !== true) {
        return res.status(409).json({ error: { code: "DESKTOP_ACTION_NO_LONGER_ACTIVE", message: "This action expired, was already handled, or is not assigned to this device." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ recorded: true, commandId, status: resultStatus, resultCode });
    } catch (error) {
      logger.warn?.("Desktop action result could not be recorded", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_RESULT_FAILED", "Could not record the desktop action result.");
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
