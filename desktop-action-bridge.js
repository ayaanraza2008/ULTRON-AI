import express from "express";
import crypto from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TYPES = new Set(["launch_app", "system_info"]);
const APPS = new Set(["notepad", "calculator", "explorer"]);
const ERROR_CODES = new Set(["ACTION_FAILED", "APP_LAUNCH_FAILED", "UNSAFE_URL", "ACTION_NOT_SUPPORTED", "ACTION_PAYLOAD_INVALID"]);
const ACTION_SELECT = "id,user_id,action_type,payload,status,attempts,approved_at,started_at,finished_at,lease_expires_at,result,error_code,created_at,updated_at";

function bounded(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function normalizeUuid(value) {
  const normalized = bounded(value, 50).toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function ownerForRequest(req, env, res) {
  const ownerId = normalizeUuid(env.ULTRON_INTEGRATION_OWNER_USER_ID);
  if (!ownerId) {
    apiError(res, 503, "DESKTOP_OWNER_NOT_CONFIGURED", "The owner account UUID must be configured before the desktop action bridge can be used.");
    return null;
  }
  if (normalizeUuid(req.supabaseUser?.id) !== ownerId) {
    apiError(res, 403, "DESKTOP_OWNER_ONLY", "Only the configured ULTRON owner may request or approve desktop actions.");
    return null;
  }
  return ownerId;
}

function safeBearerMatches(header, expected) {
  const match = /^Bearer ([^\s]+)$/i.exec(String(header || ""));
  if (!match || !expected) return false;
  const suppliedDigest = crypto.createHash("sha256").update(match[1]).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function bridgeTokenConfigured(env) {
  const token = String(env.ULTRON_DESKTOP_BRIDGE_TOKEN || "").trim();
  return token.length >= 32 && !/\s/.test(token);
}

function getBridgeOwner(env, res) {
  const ownerId = normalizeUuid(env.ULTRON_INTEGRATION_OWNER_USER_ID);
  if (!ownerId) {
    apiError(res, 503, "DESKTOP_OWNER_NOT_CONFIGURED", "The desktop bridge owner UUID is not configured.");
    return null;
  }
  const token = String(env.ULTRON_DESKTOP_BRIDGE_TOKEN || "").trim();
  if (!bridgeTokenConfigured(env)) {
    apiError(res, 503, "DESKTOP_BRIDGE_NOT_CONFIGURED", "Configure a high-entropy ULTRON_DESKTOP_BRIDGE_TOKEN without whitespace on the server and the paired Windows companion.");
    return null;
  }
  return { ownerId, token };
}

export function validateDesktopAction(actionType, rawPayload = {}) {
  if (!ACTION_TYPES.has(actionType)) {
    throw Object.assign(new Error("Choose one of the supported desktop actions."), { status: 400, code: "DESKTOP_ACTION_NOT_ALLOWED" });
  }
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw Object.assign(new Error("Desktop action payload must be an object."), { status: 400, code: "DESKTOP_ACTION_PAYLOAD_INVALID" });
  }
  const keys = Object.keys(rawPayload);
  if (actionType === "system_info") {
    if (keys.length) throw Object.assign(new Error("System-info action does not accept parameters."), { status: 400, code: "DESKTOP_ACTION_PAYLOAD_INVALID" });
    return {};
  }
  if (actionType === "launch_app") {
    if (keys.length !== 1 || keys[0] !== "app" || !APPS.has(rawPayload.app)) {
      throw Object.assign(new Error("Only Notepad, Calculator, and Explorer can be launched by this bridge."), { status: 400, code: "DESKTOP_ACTION_PAYLOAD_INVALID" });
    }
    return { app: rawPayload.app };
  }
  throw Object.assign(new Error("Choose one of the supported desktop actions."), { status: 400, code: "DESKTOP_ACTION_NOT_ALLOWED" });
}

function publicAction(row) {
  return {
    id: row.id,
    actionType: row.action_type,
    payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {},
    status: row.status,
    attempts: Number(row.attempts) || 0,
    requestedAt: row.created_at || null,
    approvedAt: row.approved_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    result: row.result && typeof row.result === "object" && !Array.isArray(row.result) ? row.result : null,
    errorCode: bounded(row.error_code, 80) || null
  };
}

function sanitizeDesktopResult(actionType, payload, state, rawResult) {
  if (!ACTION_TYPES.has(actionType)) {
    throw Object.assign(new Error("The Windows companion returned an unsupported action type."), { status: 400, code: "DESKTOP_ACTION_RESULT_INVALID" });
  }
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult) ||
      typeof rawResult.ok !== "boolean" || (state === "completed") !== rawResult.ok) {
    throw Object.assign(new Error("The Windows companion returned an invalid action result."), { status: 400, code: "DESKTOP_ACTION_RESULT_INVALID" });
  }
  const summary = bounded(rawResult.summary, 300);
  if (!summary) throw Object.assign(new Error("The action result must include a short summary."), { status: 400, code: "DESKTOP_ACTION_RESULT_INVALID" });

  const output = {
    ok: rawResult.ok,
    summary,
    actionType,
    platform: "windows"
  };
  if (!rawResult.ok) return output;

  if (actionType === "launch_app") {
    if (rawResult.app !== payload.app) {
      throw Object.assign(new Error("The result did not match the approved application."), { status: 400, code: "DESKTOP_ACTION_RESULT_INVALID" });
    }
    output.app = payload.app;
  } else if (actionType === "system_info") {
    const osVersion = bounded(rawResult.osVersion, 100);
    const architecture = bounded(rawResult.architecture, 20);
    const processorCount = Number(rawResult.processorCount);
    if (!osVersion || !["X64", "X86", "Arm64", "Arm"].includes(architecture) ||
        !Number.isInteger(processorCount) || processorCount < 1 || processorCount > 1024) {
      throw Object.assign(new Error("The system-info result contains invalid or unsupported fields."), { status: 400, code: "DESKTOP_ACTION_RESULT_INVALID" });
    }
    output.osVersion = osVersion;
    output.architecture = architecture;
    output.processorCount = processorCount;
  }
  return output;
}

export function createDesktopActionRouter({
  env = process.env,
  requireSupabaseUser,
  privilegedSupabaseRest,
  logger = console,
  now = () => new Date()
} = {}) {
  const router = express.Router();

  async function db(req, table, method, query = "", body) {
    if (typeof privilegedSupabaseRest !== "function") {
      throw Object.assign(new Error("The server-side desktop action store is not configured."), { status: 503, code: "DESKTOP_STORE_NOT_CONFIGURED" });
    }
    return privilegedSupabaseRest(req, table, method, query, body, "return=representation");
  }

  async function loadAction(req, ownerId, id) {
    const rows = await db(req, "desktop_actions", "GET",
      "?select=" + ACTION_SELECT + "&id=eq." + id + "&user_id=eq." + ownerId + "&limit=1");
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  function handleFailure(res, error, genericMessage) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
    const code = bounded(error?.code, 80) || "DESKTOP_ACTION_REQUEST_FAILED";
    logger.warn?.("Desktop action bridge request failed", { code, status });
    return apiError(res, status, code, status === 400 || status === 403 || status === 404 || status === 409
      ? bounded(error?.message, 220) || genericMessage
      : genericMessage);
  }

  function requireOwnerRoute(req, res, next) {
    const ownerId = ownerForRequest(req, env, res);
    if (!ownerId) return;
    req.desktopOwnerId = ownerId;
    return next();
  }

  function requireBridgeToken(req, res, next) {
    const config = getBridgeOwner(env, res);
    if (!config) return;
    if (!safeBearerMatches(req.headers.authorization, config.token)) {
      return apiError(res, 401, "DESKTOP_BRIDGE_AUTH_FAILED", "The Windows companion bridge credential is invalid.");
    }
    req.desktopOwnerId = config.ownerId;
    return next();
  }

  router.get("/desktop/actions", requireSupabaseUser, requireOwnerRoute, async (req, res) => {
    try {
      const rows = await db(req, "desktop_actions", "GET",
        "?select=" + ACTION_SELECT + "&user_id=eq." + req.desktopOwnerId + "&order=created_at.desc&limit=20");
      return res.json({
        actions: (Array.isArray(rows) ? rows : []).map(publicAction),
        bridgeConfigured: bridgeTokenConfigured(env)
      });
    } catch (error) {
      return handleFailure(res, error, "Could not load desktop action history.");
    }
  });

  router.post("/desktop/actions", requireSupabaseUser, requireOwnerRoute, async (req, res) => {
    try {
      const actionType = bounded(req.body?.actionType, 40);
      let payload;
      try { payload = validateDesktopAction(actionType, req.body?.payload ?? {}); }
      catch (error) { return apiError(res, error.status || 400, error.code || "DESKTOP_ACTION_INVALID", error.message); }
      const rows = await db(req, "desktop_actions", "POST", "?select=" + ACTION_SELECT, {
        user_id: req.desktopOwnerId,
        action_type: actionType,
        payload,
        status: "PENDING_APPROVAL",
        attempts: 0
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row?.id) return apiError(res, 502, "DESKTOP_ACTION_CREATE_FAILED", "The desktop action could not be recorded.");
      return res.status(201).json({
        action: publicAction(row),
        requiresApproval: true,
        execution: "not_executed",
        bridgeConfigured: bridgeTokenConfigured(env)
      });
    } catch (error) {
      return handleFailure(res, error, "Could not request the desktop action.");
    }
  });

  router.post("/desktop/actions/:id/approve", requireSupabaseUser, requireOwnerRoute, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return apiError(res, 400, "DESKTOP_ACTION_ID_INVALID", "The desktop action ID is invalid.");
    try {
      const existing = await loadAction(req, req.desktopOwnerId, id);
      if (!existing) return apiError(res, 404, "DESKTOP_ACTION_NOT_FOUND", "The desktop action was not found.");
      if (existing.status !== "PENDING_APPROVAL") return apiError(res, 409, "DESKTOP_ACTION_NOT_PENDING", "Only a pending desktop action can be approved.");
      validateDesktopAction(existing.action_type, existing.payload || {});
      const rows = await db(req, "desktop_actions", "PATCH",
        "?id=eq." + id + "&user_id=eq." + req.desktopOwnerId + "&status=eq.PENDING_APPROVAL",
        { status: "QUEUED", approved_at: now().toISOString(), lease_expires_at: null, error_code: null });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return apiError(res, 409, "DESKTOP_ACTION_STATE_CHANGED", "The desktop action changed before approval could be recorded.");
      return res.json({ action: publicAction(row), approved: true });
    } catch (error) {
      return handleFailure(res, error, "Could not approve the desktop action.");
    }
  });

  router.post("/desktop/actions/:id/cancel", requireSupabaseUser, requireOwnerRoute, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return apiError(res, 400, "DESKTOP_ACTION_ID_INVALID", "The desktop action ID is invalid.");
    try {
      const rows = await db(req, "desktop_actions", "PATCH",
        "?id=eq." + id + "&user_id=eq." + req.desktopOwnerId + "&status=in.(PENDING_APPROVAL,QUEUED)",
        { status: "CANCELLED", lease_expires_at: null, finished_at: now().toISOString(), error_code: null });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return apiError(res, 409, "DESKTOP_ACTION_NOT_CANCELLABLE", "Only pending or queued desktop actions can be cancelled.");
      return res.json({ action: publicAction(row), cancelled: true });
    } catch (error) {
      return handleFailure(res, error, "Could not cancel the desktop action.");
    }
  });

  router.post("/desktop/bridge/next", requireBridgeToken, async (req, res) => {
    try {
      const rows = await db(req, "rpc/ultron_claim_next_desktop_action", "POST", "", { p_user_id: req.desktopOwnerId });
      const row = Array.isArray(rows) ? rows[0] : null;
      return res.json({ action: row ? {
        id: row.id,
        actionType: row.action_type,
        payload: row.payload,
        attempts: Number(row.attempts) || 0,
        leaseExpiresAt: row.lease_expires_at || null
      } : null });
    } catch (error) {
      return handleFailure(res, error, "The desktop action queue is unavailable.");
    }
  });

  router.post("/desktop/bridge/ack", requireBridgeToken, async (req, res) => {
    const id = normalizeUuid(req.body?.actionId);
    if (!id) return apiError(res, 400, "DESKTOP_ACTION_ID_INVALID", "The desktop action ID is invalid.");
    const attempts = Number(req.body?.attempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) {
      return apiError(res, 400, "DESKTOP_ACTION_ATTEMPT_INVALID", "The bridge acknowledgement must include the valid attempt number returned by the claim endpoint.");
    }
    const state = bounded(req.body?.state, 20);
    if (state !== "completed" && state !== "failed") return apiError(res, 400, "DESKTOP_ACTION_STATE_INVALID", "The action state must be completed or failed.");
    const isSuccessful = state === "completed";
    const errorCode = bounded(req.body?.errorCode, 80) || null;
    if (!isSuccessful && errorCode && !ERROR_CODES.has(errorCode)) {
      return apiError(res, 400, "DESKTOP_ACTION_ERROR_CODE_INVALID", "The action error code is not recognized.");
    }
    if (isSuccessful && errorCode) return apiError(res, 400, "DESKTOP_ACTION_ERROR_CODE_INVALID", "Successful actions must not include an error code.");
    try {
      const existing = await loadAction(req, req.desktopOwnerId, id);
      if (!existing || existing.status !== "RUNNING") return apiError(res, 409, "DESKTOP_ACTION_NOT_RUNNING", "The desktop action is no longer running or its lease has expired.");
      if (Number(existing.attempts) !== attempts) {
        return apiError(res, 409, "DESKTOP_ACTION_STALE_ATTEMPT", "This acknowledgement belongs to an older claim attempt and was not stored.");
      }
      const leaseExpiry = Date.parse(existing.lease_expires_at || "");
      if (!Number.isFinite(leaseExpiry) || leaseExpiry <= now().getTime()) {
        return apiError(res, 409, "DESKTOP_ACTION_LEASE_EXPIRED", "The action lease expired before its acknowledgement arrived.");
      }
      let result;
      try { result = sanitizeDesktopResult(existing.action_type, existing.payload || {}, state, req.body?.result); }
      catch (error) { return apiError(res, error.status || 400, error.code || "DESKTOP_ACTION_RESULT_INVALID", error.message); }
      // The database must re-check status, owner, attempt and lease expiry in
      // the same UPDATE that persists the acknowledgement. A prior GET is not
      // sufficient: another worker may reclaim the lease between the GET and write.
      const rows = await db(req, "rpc/ultron_ack_desktop_action", "POST", "", {
        p_action_id: id,
        p_user_id: req.desktopOwnerId,
        p_attempts: attempts,
        p_status: isSuccessful ? "COMPLETED" : "FAILED",
        p_result: result,
        p_error_code: errorCode
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return apiError(res, 409, "DESKTOP_ACTION_STATE_CHANGED", "The action state or lease changed before its result was stored.");
      return res.json({ action: publicAction(row), acknowledged: true });
    } catch (error) {
      return handleFailure(res, error, "The desktop action result could not be saved.");
    }
  });

  router.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    return apiError(res, error?.status || 500, error?.code || "DESKTOP_ACTION_INTERNAL_ERROR", "The desktop action request could not be completed.");
  });

  return router;
}
