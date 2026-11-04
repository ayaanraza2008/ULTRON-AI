/**
 * ULTRON AI — Ego Lite Runtime & Detection Manager
 * Module: integrations/browser/ego-lite/ego-runtime-manager.js
 *
 * Responsibilities:
 * 1. Checks Node.js version (strictly requires >= 22.0.0).
 * 2. Scans Windows PATH and default installation paths for `ego-browser` CLI.
 * 3. Scans standard Windows installation directories for Ego Lite desktop app.
 * 4. Detects direct Chromium / Chrome installations for explicit fallback separation.
 * 5. Generates truthful, non-fabricated health and readiness diagnostics across all 4 runtimes:
 *    - Ego Lite Desktop Runtime
 *    - Ego Browser CLI
 *    - Direct Chromium / CDP Fallback
 *    - ULTRON Browser Use Bridge
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  EGO_BROWSER_STATE,
  UPSTREAM_CONFIG,
  DRIVER_TYPE
} from "./ego-constants.js";

const execAsync = promisify(exec);

export class EgoRuntimeManager {
  constructor(options = {}) {
    this.customCliPath = options.customCliPath || null;
    this.inMemoryDouble = Boolean(options.inMemoryDouble);
    this.browserUseBridge = options.browserUseBridge || null;
    this.lastHealthCheck = null;
    this.state = EGO_BROWSER_STATE.BROWSER_OFFLINE;
  }

  /**
   * Validates local Node.js runtime against Node 22+ requirement.
   */
  checkNodeVersion() {
    const rawVersion = process.version;
    const semver = rawVersion.replace(/^v/, "");
    const major = parseInt(semver.split(".")[0], 10);
    return {
      rawVersion,
      version: rawVersion,
      supported: major >= 22,
      major
    };
  }

  /**
   * Checks for npm availability.
   */
  async checkNpmVersion() {
    try {
      const { stdout } = await execAsync("npm -v", { timeout: 3000 });
      return { installed: true, available: true, version: stdout.trim() };
    } catch (err) {
      return { installed: false, available: false, error: err.message };
    }
  }

  /**
   * Scans PATH for the `ego-browser` command.
   */
  async detectEgoBrowserCli() {
    if (this.customCliPath && fs.existsSync(this.customCliPath)) {
      return { installed: true, found: true, path: this.customCliPath, driverType: DRIVER_TYPE.EGO_BROWSER_CLI };
    }

    const isWindows = process.platform === "win32";
    const lookupCmd = isWindows ? "where ego-browser" : "which ego-browser";

    try {
      const { stdout } = await execAsync(lookupCmd, { timeout: 3000 });
      const foundPath = stdout.trim().split(/\r?\n/)[0];
      if (foundPath && fs.existsSync(foundPath)) {
        return { installed: true, found: true, path: foundPath, driverType: DRIVER_TYPE.EGO_BROWSER_CLI };
      }
    } catch {
      // Not found on PATH
    }

    // Secondary check: common default install locations
    const candidatePaths = isWindows
      ? [
          path.join(process.env.APPDATA || "", "npm", "ego-browser.cmd"),
          path.join(process.env.LOCALAPPDATA || "", "Programs", "ego-browser", "bin", "ego-browser.exe"),
          path.join(process.env.PROGRAMFILES || "", "Ego Lite", "resources", "app", "bin", "ego-browser.cmd")
        ]
      : [
          "/usr/local/bin/ego-browser",
          "/opt/ego-browser/bin/ego-browser",
          path.join(os.homedir(), ".npm-global", "bin", "ego-browser")
        ];

    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        return { installed: true, found: true, path: cand, driverType: DRIVER_TYPE.EGO_BROWSER_CLI };
      }
    }

    return {
      installed: false,
      found: false,
      path: null,
      status: "INSTALLATION_REQUIRED",
      driverType: DRIVER_TYPE.EGO_BROWSER_CLI
    };
  }

  /**
   * Scans standard Windows directories for the Ego Lite desktop application.
   */
  detectEgoLiteApp() {
    const isWindows = process.platform === "win32";
    if (!isWindows) {
      return {
        installed: false,
        found: false,
        path: null,
        status: "BLOCKED / INSTALLATION_REQUIRED",
        driverType: DRIVER_TYPE.EGO_LITE_DESKTOP,
        guidance: `Ego Lite desktop application is currently supported natively on Windows and macOS. Official installer: ${UPSTREAM_CONFIG.OFFICIAL_APP_URL}`
      };
    }

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const appCandidates = [
      path.join(localAppData, "Programs", "EgoLite", "Ego Lite.exe"),
      path.join(localAppData, "EgoLite", "Ego Lite.exe"),
      path.join(localAppData, "Programs", "ego-lite", "Ego Lite.exe"),
      path.join(programFiles, "Ego Lite", "Ego Lite.exe"),
      path.join(programFilesX86, "Ego Lite", "Ego Lite.exe")
    ];

    for (const appPath of appCandidates) {
      if (fs.existsSync(appPath)) {
        return {
          installed: true,
          found: true,
          path: appPath,
          status: "AVAILABLE",
          driverType: DRIVER_TYPE.EGO_LITE_DESKTOP,
          guidance: `Ego Lite desktop application found at ${appPath}. Launch GUI once to ensure local session integration is active.`
        };
      }
    }

    return {
      installed: false,
      found: false,
      path: null,
      status: "BLOCKED / INSTALLATION_REQUIRED",
      driverType: DRIVER_TYPE.EGO_LITE_DESKTOP,
      guidance: `Ego Lite desktop browser is not installed.\n` +
        `Download official Windows installer from: ${UPSTREAM_CONFIG.OFFICIAL_APP_URL}\n` +
        `Direct link: ${UPSTREAM_CONFIG.WINDOWS_INSTALLER_URL}`
    };
  }

  /**
   * Detects host direct Chromium / Chrome installations (used as a separate direct CDP fallback).
   * Note: Executions using this driver are labeled DIRECT_CHROMIUM_CDP and NEVER labeled as Ego Lite.
   */
  detectDirectChromium() {
    const isWindows = process.platform === "win32";
    const candidates = [];

    if (process.env.CHROME_BIN) candidates.push({ path: process.env.CHROME_BIN, name: "Custom Chrome" });
    if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push({ path: process.env.PUPPETEER_EXECUTABLE_PATH, name: "Puppeteer Chromium" });

    if (isWindows) {
      const progFiles = process.env.ProgramFiles || "C:\\Program Files";
      const progFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

      candidates.push(
        { path: path.join(progFiles, "Google", "Chrome", "Application", "chrome.exe"), name: "Google Chrome" },
        { path: path.join(progFilesX86, "Google", "Chrome", "Application", "chrome.exe"), name: "Google Chrome (x86)" },
        { path: path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"), name: "Google Chrome (User)" },
        { path: path.join(progFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"), name: "Microsoft Edge" },
        { path: path.join(progFiles, "Microsoft", "Edge", "Application", "msedge.exe"), name: "Microsoft Edge" }
      );
    } else {
      candidates.push(
        { path: "/usr/bin/google-chrome", name: "Google Chrome" },
        { path: "/usr/bin/chromium-browser", name: "Chromium" },
        { path: "/usr/bin/chromium", name: "Chromium" },
        { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", name: "Google Chrome (macOS)" }
      );
    }

    for (const cand of candidates) {
      if (cand.path && fs.existsSync(cand.path)) {
        return {
          installed: true,
          found: true,
          path: cand.path,
          browserName: cand.name,
          driverType: DRIVER_TYPE.DIRECT_CHROMIUM_CDP,
          guidance: `Direct Chromium host browser found at ${cand.path}. Available as independent CDP / headless fallback.`
        };
      }
    }

    return {
      installed: false,
      found: false,
      path: null,
      browserName: null,
      driverType: DRIVER_TYPE.DIRECT_CHROMIUM_CDP,
      guidance: "No local Chromium/Chrome browser detected in standard locations."
    };
  }

  /**
   * Generates a comprehensive health and status diagnosis.
   */
  async getRuntimeHealth() {
    const nodeCheck = this.checkNodeVersion();
    const npmCheck = await this.checkNpmVersion();
    const cliCheck = await this.detectEgoBrowserCli();
    const appCheck = this.detectEgoLiteApp();
    const directChromiumCheck = this.detectDirectChromium();

    let status = "INSTALLATION_REQUIRED";
    let state = EGO_BROWSER_STATE.BROWSER_OFFLINE;
    let recommendation = "";

    const overallReady = Boolean(cliCheck.installed && appCheck.installed) || this.inMemoryDouble;

    if (this.inMemoryDouble) {
      status = "TEST_DOUBLE_ACTIVE";
      state = EGO_BROWSER_STATE.READY;
      recommendation = "In-memory test double is active for isolated integration verification.";
    } else if (cliCheck.installed && appCheck.installed) {
      status = "INSTALLED_AND_AVAILABLE";
      state = EGO_BROWSER_STATE.READY;
      recommendation = "Ego Lite browser automation harness is ready for autonomous operations.";
    } else if (cliCheck.installed) {
      status = "CLI_AVAILABLE_DESKTOP_PENDING";
      state = EGO_BROWSER_STATE.BROWSER_OFFLINE;
      recommendation = "Ego Lite CLI harness is detected, but desktop Chromium app was not found in standard paths.";
    } else if (appCheck.installed) {
      status = "ONBOARDING_OR_PATH_PENDING";
      state = EGO_BROWSER_STATE.BROWSER_OFFLINE;
      recommendation = "Ego Lite app is installed, but `ego-browser` was not found on PATH. Complete first-run GUI onboarding in Ego Lite, then open a fresh terminal.";
    } else {
      status = "INSTALLATION_REQUIRED";
      state = EGO_BROWSER_STATE.BROWSER_OFFLINE;
      recommendation = `Ego Lite desktop browser is not installed on this system.\n` +
        `1. Download official Windows installer from: ${UPSTREAM_CONFIG.OFFICIAL_APP_URL}\n` +
        `2. Direct download link: ${UPSTREAM_CONFIG.WINDOWS_INSTALLER_URL}\n` +
        `3. Install and run Ego Lite GUI onboarding.\n` +
        `4. Recheck in a new terminal window after onboarding registers ego-browser on PATH.\n` +
        `NOTE: User approval is required prior to installer download. Automatic cookie/password migration from Chrome is never performed without explicit user choice.`;
    }

    this.state = state;
    this.lastHealthCheck = {
      timestamp: new Date().toISOString(),
      overallReady,
      node: nodeCheck,
      npm: npmCheck,
      // 1. Ego Lite Desktop Runtime
      egoLiteDesktop: {
        status: appCheck.installed ? "AVAILABLE" : "BLOCKED / INSTALLATION_REQUIRED",
        installed: appCheck.installed,
        path: appCheck.path,
        driverType: DRIVER_TYPE.EGO_LITE_DESKTOP,
        guidance: appCheck.guidance
      },
      // 2. Ego Browser CLI
      egoBrowserCli: {
        status: cliCheck.installed ? "AVAILABLE" : "NOT_FOUND_ON_PATH",
        installed: cliCheck.installed,
        path: cliCheck.path,
        driverType: DRIVER_TYPE.EGO_BROWSER_CLI,
        guidance: cliCheck.installed ? "CLI is available on PATH." : "Run 'npm install -g ego-browser' or install upstream package."
      },
      // 3. Direct Chromium / CDP Fallback
      directChromiumCdp: {
        status: directChromiumCheck.installed ? "AVAILABLE_FOR_DIRECT_CDP" : "NOT_FOUND",
        installed: directChromiumCheck.installed,
        path: directChromiumCheck.path,
        browserName: directChromiumCheck.browserName,
        driverType: DRIVER_TYPE.DIRECT_CHROMIUM_CDP,
        note: "Direct CDP fallback is completely separate from Ego Lite; executions via CDP are never labeled as Ego Lite."
      },
      // 4. Existing Browser Use Bridge
      browserUseBridge: {
        status: this.browserUseBridge ? "CONFIGURED" : "AVAILABLE_VIA_BRIDGE",
        driverType: DRIVER_TYPE.BROWSER_USE,
        note: "ULTRON browser-use integration bridge"
      },
      // Legacy fields for backward compatibility
      cli: cliCheck,
      egoCli: cliCheck,
      app: appCheck,
      egoApp: appCheck,
      status,
      state,
      recommendation,
      diagnostics: [
        `Node version: ${nodeCheck.version} (Supported: ${nodeCheck.supported})`,
        `npm available: ${npmCheck.available || npmCheck.installed} (${npmCheck.version || "N/A"})`,
        `Ego CLI installed: ${cliCheck.installed} (${cliCheck.path || "Not found on PATH"})`,
        `Ego Desktop installed: ${appCheck.installed} (${appCheck.path || "Not installed - BLOCKED / INSTALLATION_REQUIRED"})`,
        `Direct Chromium available: ${directChromiumCheck.installed} (${directChromiumCheck.browserName || "None"} at ${directChromiumCheck.path || "N/A"})`,
        `Subsystem state: ${state}`
      ],
      upstreamVersion: UPSTREAM_CONFIG.UPSTREAM_VERSION
    };

    return this.lastHealthCheck;
  }
}
