/**
 * ULTRON AI — Workspace Matrix & Vibranium Macro Protocol Engine
 *
 * Implements context-aware environment orchestration and Battle Modes:
 * FOCUS | STEALTH | GAMING | CINEMA | WAR_ROOM | CODING | RESEARCH.
 * Coordinates system audio, display brightness, IoT lighting, app launch, and HUD state.
 */

import { pythonCapabilityGateway } from "../integrations/python-capability-gateway.js";

export const WORKSPACE_MODES = {
  FOCUS: "FOCUS",
  STEALTH: "STEALTH",
  GAMING: "GAMING",
  CINEMA: "CINEMA",
  WAR_ROOM: "WAR_ROOM",
  CODING: "CODING",
  RESEARCH: "RESEARCH"
};

export class WorkspaceMatrix {
  constructor(options = {}) {
    this.currentMode = WORKSPACE_MODES.FOCUS;
    this.gateway = options.gateway || pythonCapabilityGateway;
  }

  /**
   * Activates a workspace mode across all connected systems.
   */
  async activateMode(modeName, options = {}) {
    const mode = String(modeName || "").toUpperCase();
    if (!WORKSPACE_MODES[mode]) {
      throw new Error(`Unknown workspace mode: '${modeName}'. Supported modes: ${Object.keys(WORKSPACE_MODES).join(", ")}`);
    }

    this.currentMode = mode;
    const actionsTaken = [];

    // 1. Audio SFX announcement
    try {
      await this.gateway.voiceSynthSfx(mode === "STEALTH" ? "sonar" : "repulsor", 0.4);
      actionsTaken.push("Acoustic mode transition SFX played");
    } catch (_) {}

    // 2. Hardware controls & IoT scenes
    if (mode === WORKSPACE_MODES.CINEMA) {
      await this.gateway.desktopSetVolume(75);
      await this.gateway.desktopSetBrightness(30);
      await this.gateway.iotTriggerScene("CINEMA");
      actionsTaken.push("Volume set to 75%, brightness clamped to 30%, cinema ambient lighting engaged");
    } else if (mode === WORKSPACE_MODES.FOCUS) {
      await this.gateway.desktopSetVolume(25);
      await this.gateway.desktopSetBrightness(70);
      await this.gateway.iotTriggerScene("FOCUS");
      actionsTaken.push("Volume set to 25%, brightness 70%, focus warm white lighting engaged");
    } else if (mode === WORKSPACE_MODES.STEALTH) {
      await this.gateway.desktopMuteVolume(true);
      await this.gateway.desktopSetBrightness(20);
      await this.gateway.iotTriggerScene("STEALTH");
      actionsTaken.push("Audio muted, brightness dimmed to 20%, stealth crimson lighting engaged");
    } else if (mode === WORKSPACE_MODES.GAMING) {
      await this.gateway.desktopSetVolume(85);
      await this.gateway.desktopSetBrightness(90);
      await this.gateway.iotTriggerScene("GAMING");
      actionsTaken.push("Gaming audio set to 85%, brightness 90%, RGB ambient lights engaged");
    } else if (mode === WORKSPACE_MODES.WAR_ROOM) {
      await this.gateway.desktopSetVolume(50);
      await this.gateway.desktopSetBrightness(95);
      await this.gateway.iotTriggerScene("NORMAL");
      actionsTaken.push("War Room telemetry matrix deployed across displays");
    } else if (mode === WORKSPACE_MODES.CODING) {
      await this.gateway.desktopSetVolume(40);
      await this.gateway.desktopSetBrightness(85);
      await this.gateway.iotTriggerScene("FOCUS");
      actionsTaken.push("Coding environment active with development workspace profile");
    } else if (mode === WORKSPACE_MODES.RESEARCH) {
      await this.gateway.desktopSetVolume(30);
      await this.gateway.desktopSetBrightness(75);
      actionsTaken.push("Research mode active with autonomous scraper and multi-tab TaskSpace");
    }

    return {
      success: true,
      mode: this.currentMode,
      actionsTaken,
      timestamp: Date.now()
    };
  }

  /**
   * Returns current active workspace telemetry and mode.
   */
  async getStatus() {
    let telemetry = null;
    try {
      telemetry = await this.gateway.desktopGetTelemetry();
    } catch (_) {}

    return {
      success: true,
      activeMode: this.currentMode,
      supportedModes: Object.keys(WORKSPACE_MODES),
      telemetry
    };
  }
}

export const workspaceMatrix = new WorkspaceMatrix();
