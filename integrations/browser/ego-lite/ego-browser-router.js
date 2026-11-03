/**
 * ULTRON AI — Ego Lite Intelligent Browser Router
 * Module: integrations/browser/ego-lite/ego-browser-router.js
 *
 * Intelligently routes browser tasks between Ego Lite (for isolated TaskSpaces,
 * authenticated sessions, structured snapshots, site learnings) and fallback
 * mechanisms, with transparent diagnostics and zero false availability claims.
 */

import { ROUTING_TARGET, UPSTREAM_CONFIG } from "./ego-constants.js";

export class EgoBrowserRouter {
  /**
   * @param {Object} options
   * @param {import('./ego-runtime-manager.js').EgoRuntimeManager} options.runtimeManager
   * @param {Object} [options.browserUseBridge] - Existing ULTRON browser-use bridge
   */
  constructor(options = {}) {
    this.runtimeManager = options.runtimeManager || null;
    this.browserUseBridge = options.browserUseBridge || null;
  }

  setRuntimeManager(manager) {
    this.runtimeManager = manager;
  }

  setBrowserUseBridge(bridge) {
    this.browserUseBridge = bridge;
  }

  /**
   * Evaluate which browser engine should handle the task
   * @param {Object} task
   * @param {string} task.type - 'authenticated', 'taskspace', 'site_skill', 'general_navigation', 'http_scrape'
   * @param {string} [task.url]
   * @param {string} [task.description]
   * @param {boolean} [task.preferEgo=true]
   * @returns {Promise<Object>}
   */
  async resolveRoute(task = {}) {
    const { type = "general_navigation", preferEgo = true } = task;

    let runtimeHealth = null;
    if (this.runtimeManager) {
      runtimeHealth = await this.runtimeManager.getRuntimeHealth();
    }

    const egoReady = runtimeHealth?.overallReady ?? false;
    const egoCliDetected = runtimeHealth?.egoCli?.installed ?? false;
    const egoAppDetected = runtimeHealth?.egoApp?.installed ?? false;

    // 1. Task specifically requires Ego Lite features (taskspace, authenticated session, or site learnings)
    const requiresEgoFeatures =
      type === "taskspace" ||
      type === "authenticated" ||
      type === "site_skill" ||
      preferEgo;

    if (egoReady || (egoCliDetected && egoAppDetected)) {
      return {
        target: ROUTING_TARGET.EGO_LITE,
        available: true,
        reason: "Ego Lite desktop runtime and CLI detected and ready for autonomous operations.",
        runtimeHealth
      };
    }

    // 2. If Ego is preferred/required but not installed, return honest diagnostic
    if (requiresEgoFeatures) {
      return {
        target: ROUTING_TARGET.EGO_LITE,
        available: false,
        status: "INSTALLATION_REQUIRED",
        reason:
          "Ego Lite desktop browser is not installed or not running on this host.",
        installInstructions: {
          appUrl: UPSTREAM_CONFIG.OFFICIAL_APP_URL,
          windowsInstaller: UPSTREAM_CONFIG.WINDOWS_INSTALLER_URL,
          note:
            "The citrolabs/ego-lite repository contains the automation harness and skill. The desktop Chromium app must be downloaded and installed separately from https://lite.ego.app/."
        },
        fallbackAllowed: true,
        fallbackTarget: this.browserUseBridge ? ROUTING_TARGET.BROWSER_USE : ROUTING_TARGET.HTTP_SEARCH,
        runtimeHealth
      };
    }

    // 3. General tasks fallback to browser-use bridge if available
    if (this.browserUseBridge && typeof this.browserUseBridge.isAvailable === "function" && this.browserUseBridge.isAvailable()) {
      return {
        target: ROUTING_TARGET.BROWSER_USE,
        available: true,
        reason: "Routed to ULTRON browser-use bridge for generic headless navigation.",
        runtimeHealth
      };
    }

    // 4. Fallback to basic HTTP / Search
    return {
      target: ROUTING_TARGET.HTTP_SEARCH,
      available: true,
      reason: "No autonomous desktop browser installed. Routed to HTTP search/scraping fallback.",
      runtimeHealth
    };
  }

  /**
   * Get overall status of available browser engines
   */
  async getAvailableEngines() {
    let egoHealth = null;
    if (this.runtimeManager) {
      egoHealth = await this.runtimeManager.getRuntimeHealth();
    }

    return {
      engines: [
        {
          name: "Ego Lite Autonomous Browser",
          id: ROUTING_TARGET.EGO_LITE,
          installed: egoHealth?.egoApp?.installed ?? false,
          cliInstalled: egoHealth?.egoCli?.installed ?? false,
          ready: egoHealth?.overallReady ?? false,
          status: egoHealth?.status ?? "OFFLINE",
          capabilities: [
            "Autonomous TaskSpaces",
            "Multi-tab parallel navigation",
            "@N semantic snapshot references",
            "Zero-credential authenticated sessions",
            "Site-specific learnings (GitHub, Google, X-com)",
            "Safe downloads to UltronWorkspace/downloads"
          ]
        },
        {
          name: "ULTRON browser-use Bridge",
          id: ROUTING_TARGET.BROWSER_USE,
          installed: Boolean(this.browserUseBridge),
          ready: Boolean(this.browserUseBridge),
          capabilities: ["General headless browser navigation", "Basic web scraping"]
        }
      ]
    };
  }
}
