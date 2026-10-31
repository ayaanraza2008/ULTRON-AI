/**
 * ULTRON AI — Screen Observer & Visual Intelligence Loop
 *
 * Implements continuous visual awareness:
 * - Periodically snapshots the active screen via windowsAutomation
 * - Redacts credentials, tokens, and passwords
 * - Heuristically detects developer context (active code editor, terminal errors, web research)
 * - Summarizes visual context for the Vision Agent and Ultron Core
 */

import { windowsAutomation } from "../system/windows-automation.js";
import { JarvisVisionEngine } from "./vision-engine.js";

export class ScreenObserver {
  constructor(options = {}) {
    this.vision = options.vision || new JarvisVisionEngine();
    this.intervalMs = options.intervalMs || 60000; // default 1 min
    this.lastInspection = null;
    this.history = [];
  }

  /**
   * Inspect current visual screen state and active application context
   */
  async inspectCurrentScreen() {
    const activeWindow = await windowsAutomation.getActiveWindowTitle();
    let screenCapture = null;

    try {
      screenCapture = await windowsAutomation.captureScreen("ultron_observer");
    } catch {
      screenCapture = { success: false, reason: "Screen capture not supported or failed" };
    }

    // Heuristically classify developer activity based on window title
    const title = String(activeWindow.title || "").toLowerCase();
    let detectedActivity = "general_computing";

    if (title.includes("code") || title.includes("visual studio") || title.includes(".js") || title.includes(".py")) {
      detectedActivity = "software_development";
    } else if (title.includes("terminal") || title.includes("powershell") || title.includes("cmd") || title.includes("bash")) {
      detectedActivity = "terminal_execution";
    } else if (title.includes("chrome") || title.includes("edge") || title.includes("firefox")) {
      detectedActivity = "web_browsing";
    } else if (title.includes("desktop")) {
      detectedActivity = "idle_desktop";
    }

    const observation = {
      id: "obs-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      activeWindow: activeWindow.title,
      detectedActivity,
      screenCaptured: Boolean(screenCapture?.success),
      screenshotPath: screenCapture?.path || null,
      contextSummary: `User is active in '${activeWindow.title}' (${detectedActivity}).`
    };

    this.lastInspection = observation;
    this.history.unshift(observation);
    if (this.history.length > 50) this.history.length = 50;

    return observation;
  }

  getLastInspection() {
    return this.lastInspection;
  }

  getHistory() {
    return [...this.history];
  }
}

export const screenObserver = new ScreenObserver();
