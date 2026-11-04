/**
 * ULTRON AI — Desktop Companion & Hardware Controls Router
 *
 * Exposes REST endpoints for:
 * - Desktop companion lifecycle, persistent orb coordinates, and window anchoring.
 * - System tray context menu events (toggle, show, hide, settings, emergency stop, quit).
 * - WMI display brightness adjustment (Source B adaptation).
 * - System media playback controls (play/pause, next, prev, stop).
 * - Window state management (minimize, maximize, restore, close).
 * - Hardware vitals with GPU and battery telemetry.
 */

import express from "express";
import { desktopCompanionManager } from "./desktop-companion-manager.js";
import { windowsAutomation } from "./windows-automation.js";

export function createCompanionRouter(options = {}) {
  const router = express.Router();
  const logger = options.logger || console;

  // Initialize companion manager on first route registration
  desktopCompanionManager.initialize().catch(err => {
    logger.error?.("[CompanionRouter] Failed to initialize desktopCompanionManager:", err);
  });

  /**
   * GET /api/companion/status
   * Returns current companion state, orb position, and registered shortcuts.
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
