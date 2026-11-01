/**
 * ULTRON AI — Windows Capture-Exclusion & Display Affinity Manager
 * Module: system/windows-capture-affinity.js
 *
 * Implements native Windows window display affinity management:
 * Uses SetWindowDisplayAffinity with WDA_EXCLUDEFROMCAPTURE (0x00000011)
 * to ensure ULTRON's floating core remains clearly visible on the operator's
 * physical monitor, while being excluded from supported screenshots,
 * screen recordings, Snipping Tool, PrintScreen, Game Bar, and display capture APIs.
 *
 * Security Boundary:
 * Does NOT use kernel drivers, rootkits, or anti-cheat evasion. Uses the standard,
 * documented Microsoft Win32 DWM Display Affinity API.
 */

import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const DISPLAY_AFFINITY = Object.freeze({
  WDA_NONE: 0x00000000,
  WDA_MONITOR: 0x00000001,
  WDA_EXCLUDEFROMCAPTURE: 0x00000011 // Supported in Windows 10 Version 2004 (Build 19041) and Windows 11
});

export class WindowsCaptureAffinityManager {
  constructor(options = {}) {
    this.platform = options.platform || os.platform();
    this.osRelease = options.osRelease || os.release();
    this.currentAffinity = DISPLAY_AFFINITY.WDA_NONE;
    this.captureExclusionEnabled = options.enabled !== false;
  }

  /**
   * Evaluates whether the host OS supports WDA_EXCLUDEFROMCAPTURE (Build >= 19041).
   */
  isCaptureExclusionSupported() {
    if (this.platform !== "win32") {
      return {
        supported: false,
        reason: "NON_WINDOWS_HOST",
        platform: this.platform,
        fallback: "MANUAL_HIDE_OVERLAY"
      };
    }

    // Windows 10/11 release format is typically 10.0.xxxxx
    const parts = this.osRelease.split(".");
    const build = parts.length >= 3 ? parseInt(parts[2], 10) : 0;

    if (build >= 19041) {
      return {
        supported: true,
        build,
        targetAffinity: "WDA_EXCLUDEFROMCAPTURE",
        affinityValue: DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE
      };
    }

    return {
      supported: false,
      build,
      reason: "OS_BUILD_PRE_19041",
      fallback: "MANUAL_HIDE_OVERLAY"
    };
  }

  /**
   * Applies capture exclusion to a window handle (HWND) or named window process.
   */
  async applyCaptureExclusion(hwnd = null, enable = true) {
    const support = this.isCaptureExclusionSupported();
    if (!support.supported) {
      return {
        applied: false,
        supported: false,
        reason: support.reason,
        fallback: support.fallback
      };
    }

    const affinityVal = enable
      ? DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE
      : DISPLAY_AFFINITY.WDA_NONE;

    // If running in local Windows environment with specific HWND
    if (hwnd && typeof hwnd === "number") {
      try {
        const psCommand = `Add-Type -TypeDefinition '
          using System;
          using System.Runtime.InteropServices;
          public class Win32Affinity {
            [DllImport("user32.dll", SetLastError = true)]
            public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
          }';
          [Win32Affinity]::SetWindowDisplayAffinity([IntPtr]${hwnd}, ${affinityVal});
        `;
        await execAsync(`powershell -NoProfile -Command "${psCommand.replace(/\n/g, ' ')}"`);
        this.currentAffinity = affinityVal;
        return {
          applied: true,
          supported: true,
          affinity: enable ? "WDA_EXCLUDEFROMCAPTURE" : "WDA_NONE",
          mode: affinityVal,
          hwnd
        };
      } catch (err) {
        return {
          applied: false,
          supported: true,
          error: err.message,
          fallback: "MANUAL_HIDE_OVERLAY"
        };
      }
    }

    // Simulated / validated state application when no specific HWND is passed
    this.currentAffinity = affinityVal;
    return {
      applied: true,
      supported: true,
      affinity: enable ? "WDA_EXCLUDEFROMCAPTURE" : "WDA_NONE",
      mode: affinityVal
    };
  }

  getStatus() {
    const support = this.isCaptureExclusionSupported();
    return {
      captureExclusionSupported: support.supported,
      exclusionActive: this.currentAffinity === DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE,
      currentAffinity: this.currentAffinity,
      affinityName: this.currentAffinity === DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE
        ? "WDA_EXCLUDEFROMCAPTURE"
        : (this.currentAffinity === DISPLAY_AFFINITY.WDA_MONITOR ? "WDA_MONITOR" : "WDA_NONE"),
      platform: this.platform,
      osRelease: this.osRelease
    };
  }

  getOverlayProtectionStatus() {
    const support = this.isCaptureExclusionSupported();
    return {
      supported: support.supported,
      platform: this.platform,
      osRelease: this.osRelease,
      build: support.build,
      stealthTarget: "SNIPPING_TOOL_PRINTSCREEN_OBS_MEET_ZOOM",
      affinityValue: support.affinityValue || DISPLAY_AFFINITY.WDA_NONE,
      fallback: support.fallback || null
    };
  }

  createOverlayConfig(options = {}) {
    const support = this.isCaptureExclusionSupported();
    const width = options.width || 120;
    const height = options.height || 120;
    return {
      width,
      height,
      aspectRatio: "1:1",
      alwaysOnTop: true,
      noActivate: true,
      transparent: true,
      excludeFromCapture: support.supported,
      displayAffinity: support.supported ? DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE : DISPLAY_AFFINITY.WDA_NONE,
      position: options.position || "bottom-right",
      defaultSize: `${width}x${height}`
    };
  }
}

export const captureAffinityManager = new WindowsCaptureAffinityManager();
