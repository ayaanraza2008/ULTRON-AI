/**
 * ULTRON AI — Ego Lite Runtime & Detection Manager
 * Module: integrations/browser/ego-lite/ego-runtime-manager.js
 *
 * Responsibilities:
 * 1. Checks Node.js version (strictly requires >= 22.0.0).
 * 2. Scans Windows PATH and default installation paths for `ego-browser` CLI.
 * 3. Scans standard Windows installation directories for Ego Lite desktop app.
 * 4. Generates truthful, non-fabricated health and readiness diagnostics.
 * 5. Provides official download links and instructions (https://lite.ego.app/).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  EGO_BROWSER_STATE,
  UPSTREAM_CONFIG
} from "./ego-constants.js";

const execAsync = promisify(exec);

export class EgoRuntimeManager {
  constructor(options = {}) {
    this.customCliPath = options.customCliPath || null;
    this.inMemoryDouble = Boolean(options.inMemoryDouble);
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
      return { installed: true, found: true, path: this.customCliPath };
    }

    const isWindows = process.platform === "win32";
    const lookupCmd = isWindows ? "where ego-browser" : "which ego-browser";

    try {
      const { stdout } = await execAsync(lookupCmd, { timeout: 3000 });
      const foundPath = stdout.trim().split(/\r?\n/)[0];
      if (foundPath && fs.existsSync(foundPath)) {
        return { installed: true, found: true, path: foundPath };
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
        return { installed: true, found: true, path: cand };
      }
    }

    return { installed: false, found: false, path: null };
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
        guidance: "Ego Lite desktop application is currently supported natively on Windows and macOS."
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
          guidance: `Ego Lite desktop application found at ${appPath}. Launch GUI once to ensure local session integration is active.`
        };
      }
    }

    return {
      installed: false,
      found: false,
      path: null,
      guidance: `Ego Lite desktop browser is not installed.\n` +
        `Download official Windows installer from: ${UPSTREAM_CONFIG.OFFICIAL_APP_URL}\n` +
        `Direct link: ${UPSTREAM_CONFIG.WINDOWS_INSTALLER_URL}`
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
        `Ego Desktop installed: ${appCheck.installed} (${appCheck.path || "Not installed"})`,
        `Subsystem state: ${state}`
      ],
      upstreamVersion: UPSTREAM_CONFIG.UPSTREAM_VERSION
    };

    return this.lastHealthCheck;
  }
}
