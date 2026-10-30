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
        notice: "Store this device token privately. It is shown only once and grants heartbeat plus narrowly fixed shortcuts that always require local typed approval; it does not grant general PC control."
      });
    } catch (error) {
      logger.warn?.("Desktop companion pairing exchange failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_PAIRING_FAILED", "The device could not complete pairing.");
    }
  });

  // The companion initiates every heartbeat over HTTPS. The cloud never opens
  // a connection to the PC; fixed action requests are retrieved by outbound poll.
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

  // Queue only a fixed, low-impact action for a recently online owned PC.
  // The Windows client shows the exact action and requires a fresh local typed approval.
  const allowedTargets = {
    launch_application: new Set(["notepad", "explorer", "calculator"]),
    open_known_folder: new Set(["desktop", "documents", "downloads"])
  };
  router.post("/desktop-companion/devices/:id/actions", requireSupabaseUser, async (req, res) => {
    const recordId = cleanString(req.params.id, 64);
    const actionName = req.body?.action;
    const actionTarget = req.body?.target;
    const keys = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? Object.keys(req.body).sort().join(",") : "";
    const userId = typeof req.supabaseUser?.id === "string" ? req.supabaseUser.id : "";
    if (!UUID_RE.test(recordId) || !UUID_RE.test(userId) ||
        keys !== "action,target" ||
        !Object.hasOwn(allowedTargets, actionName) ||
        !allowedTargets[actionName].has(actionTarget)) {
      return res.status(400).json({ error: { code: "INVALID_DESKTOP_ACTION", message: "Choose one fixed application or standard folder action." } });
    }
    try {
      const rows = await supabaseRest(
        req,
        "desktop_companion_devices",
        "GET",
        "?select=id,device_id,device_name,platform,last_seen_at,revoked_at&id=eq." + encodeURIComponent(recordId) + "&limit=1"
      );
      const device = Array.isArray(rows) ? rows[0] : null;
      if (!device || device.revoked_at != null || device.platform !== "windows") {
        return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "The active Windows device was not found for this account." } });
      }
      const lastSeen = typeof device.last_seen_at === "string" ? Date.parse(device.last_seen_at) : NaN;
      const age = now() - lastSeen;
      if (!Number.isFinite(lastSeen) || age < -30_000 || age > ONLINE_WINDOW_MS) {
        return res.status(409).json({ error: { code: "DEVICE_OFFLINE", message: "The Windows companion must be online before it can receive a local action request." } });
      }

      const expiresAt = new Date(now() + 120_000).toISOString();
      const inserted = await supabaseRest(
        req,
        "desktop_companion_actions",
        "POST",
        "?select=id,status,expires_at",
        {
          user_id: userId,
          device_record_id: recordId,
          device_id: device.device_id,
          action_name: actionName,
          action_target: actionTarget,
          expires_at: expiresAt
        },
        "return=representation"
      );
      const action = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!action?.id) {
        throw Object.assign(new Error("The local action request was not stored."), { code: "DESKTOP_ACTION_INSERT_FAILED", status: 502 });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({
        actionId: cleanString(action.id, 64),
        status: "pending",
        action: actionName,
        target: actionTarget,
        expiresAt: action.expires_at || expiresAt,
        requiresLocalApproval: true,
        notice: "Queued only. The Windows companion must display this exact request and receive local interactive approval before doing anything."
      });
    } catch (error) {
      logger.warn?.("Desktop companion local action could not be queued", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_QUEUE_FAILED", "Could not queue the local desktop action.");
    }
  });

  // A paired Windows client can claim at most one pending request. The SQL RPC
  // atomically claims it and returns only the fixed action enum and target.
  router.post("/desktop-companion/actions/next", async (req, res) => {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const deviceId = cleanString(req.body?.deviceId, 64);
    if (!match || !UUID_RE.test(deviceId) ||
        Object.keys(req.body || {}).sort().join(",") !== "deviceId") {
      return res.status(401).json({ error: { code: "DEVICE_AUTH_REQUIRED", message: "A valid paired-device token and identity are required." } });
    }
    try {
      const result = await privilegedSupabaseRpc("claim_desktop_companion_action", {
        p_token_hash: sha256(match[1]),
        p_device_id: deviceId
      });
      const action = Array.isArray(result) ? result[0] : result;
      if (!action?.action_id) {
        res.setHeader("Cache-Control", "no-store");
        return res.json({ action: null });
      }
      const name = action.action_name;
      const target = action.action_target;
      if (!UUID_RE.test(String(action.action_id)) ||
          !Object.hasOwn(allowedTargets, name) || !allowedTargets[name].has(target) ||
          typeof action.expires_at !== "string" || !Number.isFinite(Date.parse(action.expires_at))) {
        logger.warn?.("Desktop companion claimed action failed protocol validation");
        return res.status(502).json({ error: { code: "DESKTOP_ACTION_PROTOCOL_MISMATCH", message: "The queued action was not in the supported fixed-action format." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        action: {
          id: action.action_id,
          name,
          target,
          expiresAt: action.expires_at,
          requiresLocalApproval: true
        }
      });
    } catch (error) {
      logger.warn?.("Desktop companion action claim failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_CLAIM_FAILED", "Could not retrieve a local action request.");
    }
  });

  router.post("/desktop-companion/actions/:id/complete", async (req, res) => {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const actionId = cleanString(req.params.id, 64);
    const deviceId = cleanString(req.body?.deviceId, 64);
    const status = req.body?.status;
    const resultCode = req.body?.resultCode;
    const keys = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? Object.keys(req.body).sort().join(",") : "";
    const allowedResults = new Set(["ACTION_COMPLETED", "USER_DENIED", "LOCAL_APPROVAL_REQUIRED", "ACTION_EXPIRED", "ACTION_FAILED"]);
    const validPair = status === "completed" && resultCode === "ACTION_COMPLETED" ||
      status === "denied" && ["USER_DENIED", "LOCAL_APPROVAL_REQUIRED"].includes(resultCode) ||
      status === "failed" && resultCode === "ACTION_FAILED" ||
      status === "expired" && resultCode === "ACTION_EXPIRED";
    if (!match || !UUID_RE.test(actionId) || !UUID_RE.test(deviceId) ||
        keys !== "deviceId,resultCode,status" || !allowedResults.has(resultCode) || !validPair) {
      return res.status(400).json({ error: { code: "INVALID_DESKTOP_ACTION_RESULT", message: "Provide a valid action ID, device identity, and supported outcome." } });
    }
    try {
      const accepted = await privilegedSupabaseRpc("complete_desktop_companion_action", {
        p_token_hash: sha256(match[1]),
        p_device_id: deviceId,
        p_action_id: actionId,
        p_status: status,
        p_result_code: resultCode
      });
      if (accepted !== true) {
        return res.status(409).json({ error: { code: "DESKTOP_ACTION_STALE_OR_UNAUTHORIZED", message: "The action is stale, already resolved, or not owned by this device." } });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ accepted: true, actionId, status });
    } catch (error) {
      logger.warn?.("Desktop companion action completion failed", { code: error?.code || "DATABASE_ERROR" });
      return sendError(res, error, "DESKTOP_ACTION_COMPLETE_FAILED", "Could not record the local action outcome.");
    }
  });

  return router;
}
