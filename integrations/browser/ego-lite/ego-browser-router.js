/**
 * ULTRON AI — Ego Lite Intelligent Browser Router
 * Module: integrations/browser/ego-lite/ego-browser-router.js
 *
 * Intelligently routes browser tasks across the four clearly separated tiers:
 * 1. Ego Lite Desktop Runtime (isolated TaskSpaces, authenticated sessions, UI integration)
 * 2. Ego Browser CLI (command-line harness & site learnings)
 * 3. Direct Chromium / CDP Fallback (independent local Chromium instance, NEVER labeled as Ego Lite)
 * 4. ULTRON Browser Use Bridge (headless Playwright service)
 * With transparent diagnostics and zero false availability claims.
 */

import { ROUTING_TARGET, UPSTREAM_CONFIG } from "./ego-constants.js";

export class EgoBrowserRouter {
  /**
   * @param {Object} options
   * @param {import('./ego-runtime-manager.js').EgoRuntimeManager} options.runtimeManager
   * @param {Object} [options.browserUseBridge] - Existing ULTRON browser-use bridge
   * @param {Object} [options.directChromiumDriver] - Direct Chromium / CDP fallback driver
   */
  constructor(options = {}) {
    this.runtimeManager = options.runtimeManager || null;
    this.browserUseBridge = options.browserUseBridge || null;
    this.directChromiumDriver = options.directChromiumDriver || null;
  }

  setRuntimeManager(manager) {
    this.runtimeManager = manager;
  }

  setBrowserUseBridge(bridge) {
    this.browserUseBridge = bridge;
  }

  setDirectChromiumDriver(driver) {
    this.directChromiumDriver = driver;
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
    const directChromiumAvailable = runtimeHealth?.directChromiumCdp?.installed ?? false;

    // 1. Task specifically requires Ego Lite features (taskspace, authenticated session, or site learnings)
    const requiresEgoFeatures =
      type === "taskspace" ||
      type === "authenticated" ||
      type === "site_skill" ||
      preferEgo;

    if (egoReady || (egoCliDetected && egoAppDetected)) {
      return {
        target: ROUTING_TARGET.EGO_LITE,
        engineTier: "EGO_LITE_DESKTOP",
        available: true,
        reason: "Ego Lite desktop runtime and CLI detected and ready for autonomous operations.",
        runtimeHealth
      };
    }

    // 2. If Ego is preferred/required but desktop is not installed, return honest diagnostic
    if (requiresEgoFeatures) {
      const fallbackTarget = directChromiumAvailable
        ? ROUTING_TARGET.DIRECT_CHROMIUM_CDP
        : (this.browserUseBridge ? ROUTING_TARGET.BROWSER_USE : ROUTING_TARGET.HTTP_SEARCH);

      return {
        target: ROUTING_TARGET.EGO_LITE,
        engineTier: "EGO_LITE_DESKTOP",
        available: false,
        status: "BLOCKED / INSTALLATION_REQUIRED",
        reason:
          "Ego Lite desktop browser is not installed or not running on this host.",
        installInstructions: {
          appUrl: UPSTREAM_CONFIG.OFFICIAL_APP_URL,
          windowsInstaller: UPSTREAM_CONFIG.WINDOWS_INSTALLER_URL,
          note:
            "The citrolabs/ego-lite repository contains the automation harness and skill. The desktop Chromium app must be downloaded and installed separately from https://lite.ego.app/."
        },
        fallbackAllowed: true,
        fallbackTarget,
        runtimeHealth
      };
    }

    // 3. Direct Chromium / CDP Fallback (completely separate from Ego Lite)
    if (directChromiumAvailable || this.directChromiumDriver) {
      return {
        target: ROUTING_TARGET.DIRECT_CHROMIUM_CDP,
        engineTier: "DIRECT_CHROMIUM_CDP",
        available: true,
        reason: "Routed to host Chromium / CDP driver for direct automation. Note: Execution is performed via direct CDP and is not labeled as Ego Lite.",
        runtimeHealth
      };
    }

    // 4. General tasks fallback to browser-use bridge if available
    if (this.browserUseBridge && typeof this.browserUseBridge.isAvailable === "function" && this.browserUseBridge.isAvailable()) {
      return {
        target: ROUTING_TARGET.BROWSER_USE,
        engineTier: "BROWSER_USE",
        available: true,
        reason: "Routed to ULTRON browser-use bridge for generic headless navigation.",
        runtimeHealth
      };
    }

    // 5. Fallback to basic HTTP / Search
    return {
      target: ROUTING_TARGET.HTTP_SEARCH,
      engineTier: "HTTP_SEARCH",
      available: true,
      reason: "No autonomous desktop browser installed. Routed to HTTP search/scraping fallback.",
      runtimeHealth
    };
  }

  /**
   * Get overall status of available browser engines across all four separated tiers
   */
  async getAvailableEngines() {
    let egoHealth = null;
    if (this.runtimeManager) {
      egoHealth = await this.runtimeManager.getRuntimeHealth();
    }

    return {
      engines: [
        {
          name: "Ego Lite Desktop Runtime",
          id: ROUTING_TARGET.EGO_LITE_DESKTOP,
          alias: ROUTING_TARGET.EGO_LITE,
          installed: egoHealth?.egoLiteDesktop?.installed ?? false,
          ready: egoHealth?.egoLiteDesktop?.installed ?? false,
          status: egoHealth?.egoLiteDesktop?.status ?? "BLOCKED / INSTALLATION_REQUIRED",
          guidance: egoHealth?.egoLiteDesktop?.guidance,
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
          name: "Ego Browser CLI",
          id: ROUTING_TARGET.EGO_BROWSER_CLI,
          installed: egoHealth?.egoBrowserCli?.installed ?? false,
          ready: egoHealth?.egoBrowserCli?.installed ?? false,
          status: egoHealth?.egoBrowserCli?.status ?? "NOT_FOUND_ON_PATH",
          guidance: egoHealth?.egoBrowserCli?.guidance,
          capabilities: [
            "CLI-driven session control",
            "Headless CDP command invocation",
            "Site-specific learning skill pack execution"
          ]
        },
        {
          name: "Direct Chromium / CDP Fallback",
          id: ROUTING_TARGET.DIRECT_CHROMIUM_CDP,
          installed: egoHealth?.directChromiumCdp?.installed ?? false,
          ready: egoHealth?.directChromiumCdp?.installed ?? false,
          status: egoHealth?.directChromiumCdp?.status ?? "NOT_FOUND",
          browserPath: egoHealth?.directChromiumCdp?.path,
          capabilities: [
            "Direct Chrome DevTools Protocol automation",
            "Headless DOM extraction",
            "Never labeled as Ego Lite execution"
          ]
        },
        {
          name: "ULTRON Browser Use Bridge",
          id: ROUTING_TARGET.BROWSER_USE,
          installed: Boolean(this.browserUseBridge),
          ready: Boolean(this.browserUseBridge),
          status: this.browserUseBridge ? "AVAILABLE" : "NOT_CONFIGURED",
          capabilities: ["General headless browser navigation", "Basic web scraping"]
        }
      ]
    };
  }
}
