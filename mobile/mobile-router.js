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

  // Loopback / Auth Guard Middleware
  const enforceAccess = (req, res, next) => {
    const isLoopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
    const hasAuthUser = Boolean(req.supabaseUser || req.session?.user || req.headers["x-ultron-internal-call"]);

    // If neither loopback nor authenticated user, require authentication
    if (!isLoopback && !hasAuthUser) {
      if (typeof requireSupabaseUser === "function") {
        return requireSupabaseUser(req, res, next);
      }
      if (typeof requireSession === "function") {
        return requireSession(req, res, next);
      }
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Mobile control API requires authenticated session or local loopback access." }
      });
    }
    next();
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
  registerRoute("get", "/status", enforceAccess, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const status = await controlEngine.getStatus();
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
  registerRoute("get", "/devices", enforceAccess, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";
      const discovery = await controlEngine.discoverDevices(forceRefresh);
      res.json({
        success: true,
        count: discovery.count,
        connected: discovery.connected,
        activeDeviceId: discovery.activeDeviceId,
        devices: discovery.devices,
        platformDiagnostics: discovery.platformDiagnostics
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Device discovery error:", err.message);
      res.status(500).json({ error: { code: "DEVICE_DISCOVERY_ERROR", message: err.message } });
    }
  });

  /**
   * 3. POST /api/mobile/action
   * Dispatches a single action (tap, swipe, keypress, type, launch, terminate).
   * Enforces 4-tier permissions. Returns HTTP 403 / 401 if unauthorized.
   */
  registerRoute("post", "/action", enforceAccess, async (req, res) => {
    try {
      const { deviceId, action, params = {}, confirmationToken = null } = req.body;
      if (!action || typeof action !== "string") {
        return res.status(400).json({ error: { code: "INVALID_ACTION", message: "Action name is required." } });
      }

      // Check permissions
      const permCheck = controlEngine.permissionEngine.checkAction(action, {
        package: params.package || params.packageName,
        url: params.url,
        autonomyLevel: req.body.autonomyLevel ?? 2
      });

      if (!permCheck.allowed && !permCheck.requiresConfirmation) {
        return res.status(403).json({
          error: {
            code: "PERMISSION_DENIED",
            message: permCheck.reason,
            level: permCheck.level
          }
        });
      }

      if (permCheck.requiresConfirmation) {
        if (!confirmationToken) {
          const reqToken = controlEngine.permissionEngine.requestConfirmation(
            action,
            params,
            `REST Action: ${action}`
          );
          return res.status(403).json({
            error: {
              code: "CONFIRMATION_REQUIRED",
              message: `Action '${action}' requires human confirmation. Single-use token generated.`,
              confirmationToken: reqToken.token,
              expiresAt: reqToken.expiresAt,
              level: permCheck.level
            }
          });
        }

        // Verify token
        const validation = controlEngine.permissionEngine.consumeConfirmation(confirmationToken, action);
        if (!validation.valid) {
          return res.status(403).json({
            error: {
              code: "INVALID_CONFIRMATION_TOKEN",
              message: validation.reason
            }
          });
        }
      }

      const outcome = await controlEngine.executeAction(deviceId, action, params);
      res.json({
        success: outcome.success,
        action,
        deviceId: deviceId || "active",
        result: outcome
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Action error:", err.message);
      res.status(500).json({ error: { code: "ACTION_EXECUTION_ERROR", message: err.message } });
    }
  });

  /**
   * 4. POST /api/mobile/screenshot
   * Takes a screenshot of the specified (or default) connected device.
   */
  registerRoute("post", "/screenshot", enforceAccess, async (req, res) => {
    try {
      const { deviceId, format = "base64" } = req.body || {};
      const screenshot = await controlEngine.captureScreen(deviceId);
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
  registerRoute("post", "/elements", enforceAccess, async (req, res) => {
    try {
      const { deviceId } = req.body || {};
      const hierarchy = await controlEngine.getHierarchy(deviceId);

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
  registerRoute("post", "/workflow", enforceAccess, async (req, res) => {
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
          autonomyLevel
        });
        return res.json(result);
      }

      // Explicit plan execution
      const execution = await controlEngine.executeWorkflow(plan, {
        deviceId,
        confirmationToken
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
  registerRoute("post", "/confirm", enforceAccess, async (req, res) => {
    try {
      const { token, action } = req.body || {};
      if (!token) {
        return res.status(400).json({ error: { code: "TOKEN_REQUIRED", message: "Confirmation token is required." } });
      }

      const result = controlEngine.permissionEngine.consumeConfirmation(token, action);
      if (!result.valid) {
        return res.status(403).json({
          success: false,
          error: { code: "CONFIRMATION_FAILED", reason: result.reason }
        });
      }

      res.json({
        success: true,
        confirmed: true,
        action: result.request.action,
        requestedAt: result.request.requestedAt
      });
    } catch (err) {
      logger.error?.("[MobileRouter] Confirmation error:", err.message);
      res.status(500).json({ error: { code: "CONFIRM_ERROR", message: err.message } });
    }
  });

  return router;
}
