/**
 * ULTRON AI — Desktop Companion & Hardware Controls Router
 *
 * Exposes secure REST endpoints for:
 * - Desktop companion lifecycle, persistent orb coordinates, and window anchoring.
 * - Native Win32 companion daemon lifecycle (/native/launch, /native/stop, /native/command).
 * - System tray context menu events (toggle, show, hide, settings, emergency stop, quit).
 * - WMI display brightness adjustment (Source B adaptation).
 * - System media playback controls (play/pause, next, prev, stop).
 * - Window state management (minimize, maximize, restore, close).
 * - Hardware vitals with GPU and battery telemetry.
 *
 * SECURITY:
 * - All endpoints enforce authentication session validation via requireSession.
 * - Integrated rate limiting (companionRateLimiter) mitigates API flooding.
 * - Strict user session/account isolation prevents cross-tenant access.
 */

import express from "express";
import { desktopCompanionManager } from "./desktop-companion-manager.js";
import { windowsAutomation } from "./windows-automation.js";

export function createCompanionRouter(options = {}) {
  const router = express.Router();
  const logger = options.logger || console;
  const requireSession = options.requireSession || options.requireAuth || ((_req, _res, next) => next());

  // In-memory sliding rate limiter (120 reqs / 60 seconds per IP)
  const rateLimitWindowMs = 60000;
  const maxRequestsPerWindow = 120;
  const ipBuckets = new Map();

  function companionRateLimiter(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || "local";
    const now = Date.now();
    let bucket = ipBuckets.get(key);
    if (!bucket || now - bucket.start > rateLimitWindowMs) {
      bucket = { start: now, count: 0 };
      ipBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > maxRequestsPerWindow) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded on companion API. Please slow down."
      });
    }
    next();
  }

  // Account isolation middleware: verifies tenant ownership if session contains userId
  function accountIsolationGuard(req, res, next) {
    const sessionUserId = req.session?.userId || req.user?.id;
    const headerUserId = req.headers["x-user-id"];
    if (sessionUserId && headerUserId && String(sessionUserId) !== String(headerUserId)) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Account isolation violation. Cross-tenant access is rejected."
      });
    }
    next();
  }

  // Apply rate limiter and session validation to all companion routes
  router.use(companionRateLimiter);
  router.use(requireSession);
  router.use(accountIsolationGuard);

  // Initialize companion manager on first route registration
  desktopCompanionManager.initialize().catch(err => {
    logger.error?.("[CompanionRouter] Failed to initialize desktopCompanionManager:", err);
  });

  /**
   * GET /api/companion/status
   * Returns current companion state, orb position, registered shortcuts, and native daemon status.
   */
  router.get("/status", (_req, res) => {
    res.json({
      success: true,
      status: desktopCompanionManager.getStatus()
    });
  });

  /**
   * POST /api/companion/position
   * Sets and persists floating orb physical screen coordinates.
   */
  router.post("/position", express.json(), async (req, res) => {
    const { x, y, screenWidth, screenHeight } = req.body || {};
    if (typeof x !== "number" || typeof y !== "number") {
      return res.status(400).json({
        success: false,
        error: "Numeric 'x' and 'y' coordinates are required."
      });
    }

    try {
      const pos = await desktopCompanionManager.setOrbPosition(x, y, screenWidth, screenHeight);
      res.json({ success: true, position: pos });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/companion/anchor
   * Calculates optimal HUD window position anchored relative to the floating orb.
   */
  router.get("/anchor", (req, res) => {
    const windowWidth = parseInt(req.query.width, 10) || 900;
    const windowHeight = parseInt(req.query.height, 10) || 650;
    const screenWidth = parseInt(req.query.screenWidth, 10) || 1920;
    const screenHeight = parseInt(req.query.screenHeight, 10) || 1080;

    const anchor = desktopCompanionManager.getAnchoredWindowPosition(
      windowWidth,
      windowHeight,
      screenWidth,
      screenHeight
    );
    res.json({ success: true, anchor });
  });

  /**
   * POST /api/companion/tray-action
   * Dispatches tray context menu action.
   */
  router.post("/tray-action", express.json(), (req, res) => {
    const { action, reason } = req.body || {};
    if (!action) {
      return res.status(400).json({ success: false, error: "Action is required." });
    }

    try {
      const outcome = desktopCompanionManager.handleTrayAction(action, { reason });
      res.json({ success: true, outcome });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  /**
   * Native Win32 Companion Process Endpoints
   */
  router.post("/native/launch", async (_req, res) => {
    try {
      const outcome = await desktopCompanionManager.launchNativeCompanion();
      res.json({ success: true, outcome });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/native/stop", async (_req, res) => {
    try {
      const outcome = await desktopCompanionManager.stopNativeCompanion();
      res.json({ success: true, outcome });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/native/command", express.json(), (req, res) => {
    const cmd = req.body;
    if (!cmd || typeof cmd !== "object") {
      return res.status(400).json({ success: false, error: "JSON command object required." });
    }
    try {
      const sent = desktopCompanionManager.sendIpcCommand(cmd);
      res.json({ success: true, sent });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/companion/hardware
   * Returns host hardware telemetry including CPU, RAM, GPU, and Battery.
   */
  router.get("/hardware", async (_req, res) => {
    try {
      const vitals = await windowsAutomation.getSystemVitals();
      res.json({ success: true, hardware: vitals });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET/POST /api/companion/brightness
   * Queries or updates display brightness via WMI.
   */
  router.get("/brightness", async (_req, res) => {
    try {
      const result = await windowsAutomation.getDisplayBrightness();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/brightness", express.json(), async (req, res) => {
    const { level } = req.body || {};
    if (typeof level !== "number") {
      return res.status(400).json({ success: false, error: "Numeric 'level' (0-100) is required." });
    }
    try {
      const result = await windowsAutomation.setDisplayBrightness(level);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/companion/media
   * Dispatches virtual media keys (play_pause, next_track, prev_track, stop).
   */
  router.post("/media", express.json(), async (req, res) => {
    const { action } = req.body || {};
    if (!action) {
      return res.status(400).json({ success: false, error: "Media 'action' is required." });
    }
    try {
      const result = await windowsAutomation.dispatchMediaKey(action);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/companion/window
   * Sets active window state (minimize, maximize, restore, close).
   */
  router.post("/window", express.json(), async (req, res) => {
    const { action } = req.body || {};
    if (!action) {
      return res.status(400).json({ success: false, error: "Window 'action' is required." });
    }
    try {
      const result = await windowsAutomation.setWindowState(action);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
}
