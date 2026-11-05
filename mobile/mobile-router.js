/**
 * ULTRON AI — Mobile Control Subsystem REST Router
 * Module: mobile/mobile-router.js
 *
 * Exposes secure REST endpoints for discovering Android devices, dispatching
 * touch/key actions, taking screenshots, dumping UI elements, executing multi-step
 * autonomous workflows, and confirming Level 3/4 sensitive actions.
 *
 * Security:
 * - Restricted to loopback (127.0.0.1) or authenticated session/Supabase users
 * - 4-tier permission checks on every mutation
 * - Single-use token validation for Level 3/4 actions
 */

import express from "express";
import { mobileControlEngine as defaultMobileEngine } from "./mobile-control-engine.js";
import { mobileTaskAgent as defaultTaskAgent } from "../agents/mobile-task-agent.js";

export function createMobileRouter({
  requireSupabaseUser = null,
  requireSession = null,
  controlEngine = defaultMobileEngine,
  taskAgent = defaultTaskAgent,
  logger = console
} = {}) {
  const router = express.Router();
  router.use(express.json({ limit: "10mb" }));

  // Loopback is sufficient for read-only discovery, but never substitutes for an
  // authenticated owner on device control or private screen data. A caller-supplied
  // x-ultron-internal-call header is not an authentication credential.
  const getUserId = req => {
    const value = req.supabaseUser?.id || req.session?.user?.id;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  const enforceAccess = (req, res, next) => {
    const isLoopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
    if (isLoopback || getUserId(req)) return next();
    if (typeof requireSupabaseUser === "function") return requireSupabaseUser(req, res, next);
    if (typeof requireSession === "function") return requireSession(req, res, next);
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Mobile control API requires an authenticated session." }
    });
  };

  const requireOwner = (req, res, next) => {
    const acceptAuthenticatedOwner = err => {
      if (err) return next(err);
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: { code: "AUTHENTICATED_USER_REQUIRED", message: "Sign in before controlling a paired device or viewing its screen." }
        });
      }
      req.ultronMobileUserId = userId;
      return next();
    };

    if (getUserId(req)) return acceptAuthenticatedOwner();
    if (typeof requireSupabaseUser === "function") return requireSupabaseUser(req, res, acceptAuthenticatedOwner);
    if (typeof requireSession === "function") return requireSession(req, res, acceptAuthenticatedOwner);
    return acceptAuthenticatedOwner();
  };

  // Helper for registering endpoints matching both `/path` and `/mobile/path`
  const registerRoute = (method, path, ...handlers) => {
    router[method](path, ...handlers);
    if (!path.startsWith("/mobile")) {
      router[method]("/mobile" + path, ...handlers);
    }
  };

  /**
   * 1. GET /api/mobile/status
   * Returns Mobile MCP daemon status, ADB path, transport type, connected devices count.
   */
  registerRoute("get", "/status", enforceAccess, requireOwner, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const status = await controlEngine.getStatus(req.ultronMobileUserId);
      res.json({
        success: true,
        status: status.status || (status.initialized ? "ONLINE" : "STANDBY"),
        initialized: status.initialized,
        transport: status.mcpServer?.transport || status.transport || "stdio",
        adb: status.platformDiagnostics?.adb?.path || status.adb || "adb.exe",
        devicesCount: status.deviceCount !== undefined ? status.deviceCount : (status.devicesCount || 0),
        activeDevice: status.activeDevice,
        mcpClient: status.mcpServer || status.mcpClient
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Status check error:", err.message);
      res.status(500).json({ error: { code: "MOBILE_STATUS_ERROR", message: err.message } });
    }
  });

  /**
   * 2. GET /api/mobile/devices
   * Lists all connected Android devices with ID, model, connection type, capabilities.
   */
  registerRoute("get", "/devices", enforceAccess, requireOwner, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";
      const discovery = await controlEngine.discoverDevices(forceRefresh);
      res.json({
        success: true,
        count: discovery.count,
        connected: discovery.connected,
        activeDeviceId: discovery.activeDeviceId,
        devices: discovery.devices.map(device => ({
          ...device,
          authorized: controlEngine.permissionEngine.deviceAuthorizations.get(device.id)?.authorizedBy === req.ultronMobileUserId
        })),
        platformDiagnostics: discovery.platformDiagnostics
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Device discovery error:", err.message);
      res.status(500).json({ error: { code: "DEVICE_DISCOVERY_ERROR", message: err.message } });
    }
  });

  /**
   * 3. POST /api/mobile/authorize
   * Explicitly pairs an online device with the signed-in owner. Routine permissions
   * are capped at Level 2; sensitive and critical actions still require fresh approval.
   */
  registerRoute("post", "/authorize", enforceAccess, requireOwner, async (req, res) => {
    try {
      const { deviceId, maxLevel = 2 } = req.body || {};
      if (typeof deviceId !== "string" || !deviceId.trim()) {
        return res.status(400).json({ error: { code: "DEVICE_ID_REQUIRED", message: "A discovered device ID is required." } });
      }
      const result = controlEngine.authorizeDevice(deviceId.trim(), req.ultronMobileUserId, Number(maxLevel));
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(400).json({ error: { code: "DEVICE_AUTHORIZATION_FAILED", message: err.message } });
    }
  });

  /**
   * 4. POST /api/mobile/action
   * Dispatches a single action through the owner-bound permission engine.
   */
  registerRoute("post", "/action", enforceAccess, requireOwner, async (req, res) => {
    try {
      const { deviceId, action, params = {}, confirmationToken = null } = req.body || {};
      if (!action || typeof action !== "string") {
        return res.status(400).json({ error: { code: "INVALID_ACTION", message: "Action name is required." } });
      }

      const outcome = await controlEngine.executeAction(
        action,
        { ...params, device: deviceId || params.device || params.deviceId },
        { userId: req.ultronMobileUserId, confirmationToken }
      );
      if (!outcome.success) {
        const status = outcome.requiresConfirmation || outcome.code === "DEVICE_UNAUTHORIZED" ? 403 : 400;
        return res.status(status).json({
          error: {
            code: outcome.code || "ACTION_FAILED",
            message: outcome.reason || outcome.error || "The mobile action did not complete.",
            confirmationToken: outcome.confirmationToken || null,
            expiresAt: outcome.expiresAt || null,
            requiresConfirmation: Boolean(outcome.requiresConfirmation)
          }
        });
      }

      return res.json({ success: true, action, deviceId: deviceId || "active", result: outcome });
    } catch (err) {
      logger.error?.("[MobileRouter] Action error:", err.message);
      return res.status(500).json({ error: { code: "ACTION_EXECUTION_ERROR", message: err.message } });
    }
  });

  /**
   * 4. POST /api/mobile/screenshot
   * Takes a screenshot of the specified (or default) connected device.
   */
  registerRoute("post", "/screenshot", enforceAccess, requireOwner, async (req, res) => {
    try {
      const { deviceId, format = "base64" } = req.body || {};
      const screenshot = await controlEngine.captureScreen(deviceId, {}, { userId: req.ultronMobileUserId });
      const imgData = screenshot.data || screenshot.image?.data;

      if (!screenshot.success || !imgData) {
        return res.status(400).json({
          success: false,
          error: screenshot.error,
          message: screenshot.message || "Failed to capture screen."
        });
      }

      if (format === "binary" && imgData) {
        const buffer = Buffer.from(imgData, "base64");
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Length", buffer.length);
        return res.send(buffer);
      }

      res.json({
        success: true,
        format: "base64",
        mimeType: screenshot.mimeType || "image/png",
        data: imgData,
        source: screenshot.source || "mobile-mcp"
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Screenshot error:", err.message);
      res.status(500).json({ error: { code: "SCREENSHOT_ERROR", message: err.message } });
    }
  });

  /**
   * 5. POST /api/mobile/elements
   * Dumps UI hierarchy / accessibility tree of the foreground screen.
   */
  registerRoute("post", "/elements", enforceAccess, requireOwner, async (req, res) => {
    try {
      const { deviceId } = req.body || {};
      const hierarchy = await controlEngine.getHierarchy(deviceId, { userId: req.ultronMobileUserId });

      res.json({
        success: hierarchy.success,
        deviceId: deviceId || "active",
        rawXml: hierarchy.rawXml || null,
        elementsCount: hierarchy.elements?.length || 0,
        elements: hierarchy.elements || [],
        error: hierarchy.error || null
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Elements error:", err.message);
      res.status(500).json({ error: { code: "HIERARCHY_ERROR", message: err.message } });
    }
  });

  /**
   * 6. POST /api/mobile/workflow
   * Accepts a multi-step mobile workflow or natural language task.
   */
  registerRoute("post", "/workflow", enforceAccess, requireOwner, async (req, res) => {
    try {
      const { goal, plan, deviceId, confirmationToken, autonomyLevel = 2 } = req.body || {};
      if (!goal && !plan) {
        return res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Workflow requires either a natural language goal or an explicit plan." }
        });
      }

      if (goal) {
        // Run autonomous mobile task agent
        const result = await taskAgent.executeGoal(goal, {
          deviceId,
          confirmationToken,
          autonomyLevel,
          userId: req.ultronMobileUserId
        });
        return res.json(result);
      }

      // Explicit plan execution
      const execution = await controlEngine.executeWorkflow(plan, {
        deviceId,
        confirmationToken,
        userId: req.ultronMobileUserId
      });
      res.json({
        success: execution.success,
        workflowId: plan.id,
        completedSteps: execution.completedSteps,
        error: execution.error || null
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Workflow error:", err.message);
      res.status(500).json({ error: { code: "WORKFLOW_ERROR", message: err.message } });
    }
  });

  /**
   * 7. POST /api/mobile/confirm
   * Accepts single-use confirmation token for Level 3/4 sensitive actions.
   */
  registerRoute("post", "/confirm", enforceAccess, requireOwner, async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token) {
        return res.status(400).json({ error: { code: "TOKEN_REQUIRED", message: "Confirmation token is required." } });
      }

      const result = await controlEngine.confirmAction(token, req.ultronMobileUserId);
      if (!result.success) {
        return res.status(403).json({
          success: false,
          error: { code: result.code || "CONFIRMATION_FAILED", reason: result.reason || result.error || "Confirmation failed." }
        });
      }

      return res.json({
        success: true,
        confirmed: true,
        action: result.action,
        result
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Confirmation error:", err.message);
      res.status(500).json({ error: { code: "CONFIRM_ERROR", message: err.message } });
    }
  });

  return router;
}
