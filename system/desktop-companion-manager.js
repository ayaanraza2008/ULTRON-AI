/**
 * ULTRON AI — Unified Desktop Companion Lifecycle & State Bridge
 *
 * Implements persistent desktop companion orchestration (adapted from JARVIS-ULTIMATE):
 * - Floating ULTRON orb coordinate persistence & multi-monitor boundary clamping.
 * - Window anchoring: calculates optimal HUD placement anchored relative to the orb.
 * - System tray context menu state machine (Show/Hide, Settings, Emergency Stop, Quit).
 * - Global shortcut registration metadata (Ctrl+Shift+U primary, Ctrl+Shift+J alias).
 * - Close interception: prevents accidental backend shutdown by minimizing to tray.
 * - Emergency stop circuit breaker and health telemetry.
 */

import EventEmitter from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const COMPANION_STATES = Object.freeze({
  STANDBY: "STANDBY",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
  EXECUTING: "EXECUTING",
  MINIMIZED_TO_TRAY: "MINIMIZED_TO_TRAY",
  ERROR: "ERROR",
  HALTED: "HALTED"
});

export const TRAY_ACTIONS = Object.freeze({
  TOGGLE: "toggle",
  SHOW: "show",
  HIDE: "hide",
  SETTINGS: "settings",
  EMERGENCY_STOP: "emergency_stop",
  RESET_EMERGENCY_STOP: "reset_emergency_stop",
  QUIT: "quit"
});

export class DesktopCompanionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.configDir = options.configDir || path.join(os.homedir(), ".ultron");
    this.configFile = path.join(this.configDir, "companion_config.json");
    this.state = COMPANION_STATES.STANDBY;
    this.isWindowVisible = true;
    this.emergencyHalted = false;
    this.orbSize = options.orbSize || 120; // 1:1 aspect ratio default
    this.orbPosition = { x: 100, y: 100 };
    this.registeredShortcuts = [
      { combo: "Ctrl+Shift+U", action: "toggle_hud", role: "primary" },
      { combo: "Ctrl+Shift+J", action: "toggle_hud", role: "jarvis_compat_alias" }
    ];
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      await this.loadConfig();
    } catch {
      this.orbPosition = this.getDefaultPosition();
    }
    this.isInitialized = true;
    this.emit("initialized", { state: this.state, orbPosition: this.orbPosition });
  }

  getDefaultPosition(screenWidth = 1920, screenHeight = 1080) {
    return {
      x: Math.max(20, screenWidth - this.orbSize - 32),
      y: Math.max(20, screenHeight - this.orbSize - 48)
    };
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configFile, "utf8");
      const parsed = JSON.parse(data);
      if (parsed.orbPosition && typeof parsed.orbPosition.x === "number" && typeof parsed.orbPosition.y === "number") {
        this.orbPosition = this.clampToDisplay(parsed.orbPosition.x, parsed.orbPosition.y);
      } else {
        this.orbPosition = this.getDefaultPosition();
      }
      if (parsed.orbSize && Number.isFinite(parsed.orbSize)) {
        this.orbSize = Math.max(68, Math.min(240, parsed.orbSize));
      }
    } catch {
      this.orbPosition = this.getDefaultPosition();
    }
  }

  async saveConfig() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      const payload = {
        orbPosition: this.orbPosition,
        orbSize: this.orbSize,
        lastUpdated: new Date().toISOString()
      };
      await fs.writeFile(this.configFile, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      this.emit("error", { operation: "saveConfig", message: err.message });
    }
  }

  /**
   * Clamps orb coordinates within multi-monitor bounding area.
   */
  clampToDisplay(x, y, screenWidth = 1920, screenHeight = 1080) {
    const clampedX = Math.max(10, Math.min(screenWidth - this.orbSize - 10, Math.round(Number(x) || 0)));
    const clampedY = Math.max(10, Math.min(screenHeight - this.orbSize - 10, Math.round(Number(y) || 0)));
    return { x: clampedX, y: clampedY };
  }

  /**
   * Update and persist floating orb physical position.
   */
  async setOrbPosition(x, y, screenWidth = 1920, screenHeight = 1080) {
    const clamped = this.clampToDisplay(x, y, screenWidth, screenHeight);
    this.orbPosition = clamped;
    await this.saveConfig();
    this.emit("orb_moved", { position: this.orbPosition });
    return this.orbPosition;
  }

  getOrbPosition() {
    return { ...this.orbPosition };
  }

  /**
   * Calculates anchor position for main chat HUD window relative to orb position
   * (Adapted from JARVIS-ULTIMATE commands.rs toggle_main_window logic).
   */
  getAnchoredWindowPosition(windowWidth = 900, windowHeight = 650, screenWidth = 1920, screenHeight = 1080) {
    let targetX = this.orbPosition.x - Math.round(windowWidth / 2);
    let targetY = this.orbPosition.y - windowHeight - 20;

    // If not enough room above orb, position below or to the side
    if (targetY < 20) {
      targetY = this.orbPosition.y + this.orbSize + 20;
    }

    // Keep within horizontal screen bounds
    targetX = Math.max(20, Math.min(screenWidth - windowWidth - 20, targetX));
    targetY = Math.max(20, Math.min(screenHeight - windowHeight - 20, targetY));

    return {
      x: targetX,
      y: targetY,
      width: windowWidth,
      height: windowHeight,
      anchoredToOrb: true
    };
  }

  /**
   * Handle System Tray Context Menu Actions
   */
  handleTrayAction(action, context = {}) {
    switch (action) {
      case TRAY_ACTIONS.TOGGLE:
        this.isWindowVisible = !this.isWindowVisible;
        this.state = this.isWindowVisible ? COMPANION_STATES.STANDBY : COMPANION_STATES.MINIMIZED_TO_TRAY;
        this.emit("visibility_changed", { visible: this.isWindowVisible, state: this.state });
        return { success: true, action, visible: this.isWindowVisible };

      case TRAY_ACTIONS.SHOW:
        this.isWindowVisible = true;
        this.state = COMPANION_STATES.STANDBY;
        this.emit("visibility_changed", { visible: true, state: this.state });
        return { success: true, action, visible: true };

      case TRAY_ACTIONS.HIDE:
        this.isWindowVisible = false;
        this.state = COMPANION_STATES.MINIMIZED_TO_TRAY;
        this.emit("visibility_changed", { visible: false, state: this.state });
        return { success: true, action, visible: false };

      case TRAY_ACTIONS.SETTINGS:
        this.isWindowVisible = true;
        this.emit("navigate_settings", { view: "settings" });
        return { success: true, action, navigated: "settings" };

      case TRAY_ACTIONS.EMERGENCY_STOP:
        this.emergencyHalted = true;
        this.state = COMPANION_STATES.HALTED;
        this.emit("emergency_stop", { reason: context.reason || "Operator tray halt", timestamp: Date.now() });
        return { success: true, action, halted: true };

      case TRAY_ACTIONS.RESET_EMERGENCY_STOP:
        this.emergencyHalted = false;
        this.state = COMPANION_STATES.STANDBY;
        this.emit("emergency_stop_reset", { timestamp: Date.now() });
        return { success: true, action, halted: false };

      case TRAY_ACTIONS.QUIT:
        this.emit("shutdown_requested", { reason: "Tray quit invoked", timestamp: Date.now() });
        return { success: true, action, shuttingDown: true };

      default:
        throw new Error(`Unknown tray action: '${action}'. Allowed: ${Object.values(TRAY_ACTIONS).join(", ")}`);
    }
  }

  /**
   * Window close interception handler:
   * Returns true to prevent app termination and instead hide to system tray.
   */
  handleWindowCloseRequest() {
    this.isWindowVisible = false;
    this.state = COMPANION_STATES.MINIMIZED_TO_TRAY;
    this.emit("minimized_to_tray", { timestamp: Date.now() });
    return { preventDefault: true, action: "minimized_to_tray" };
  }

  /**
   * Global shortcut trigger simulation/handling
   */
  handleGlobalShortcut(shortcutString) {
    const normalized = String(shortcutString || "").replace(/\s+/g, "").toUpperCase();
    const matched = this.registeredShortcuts.find(
      s => s.combo.replace(/\s+/g, "").toUpperCase() === normalized
    );
    if (!matched) {
      return { triggered: false, reason: "Unrecognized shortcut" };
    }
    return this.handleTrayAction(TRAY_ACTIONS.TOGGLE);
  }

  /**
   * Companion health & telemetry snapshot
   */
  getStatus() {
    return {
      service: "desktop-companion-manager",
      state: this.state,
      isWindowVisible: this.isWindowVisible,
      emergencyHalted: this.emergencyHalted,
      orbSize: this.orbSize,
      orbPosition: this.orbPosition,
      registeredShortcuts: this.registeredShortcuts,
      timestamp: new Date().toISOString()
    };
  }
}

export const desktopCompanionManager = new DesktopCompanionManager();
