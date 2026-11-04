/**
 * ULTRON AI — Android Debug Bridge (ADB) Native Integration Bridge
 *
 * Provides direct, audited, robust communication with Android devices
 * (USB physical, wireless TCP/IP, and local emulators) via the platform-tools ADB binary.
 *
 * Designed to work seamlessly with both Windows (native adb.exe) and Linux/macOS environments.
 */

import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class AdbBridge {
  constructor(options = {}) {
    this.customAdbPath = options.adbPath || process.env.ADB_PATH || null;
    this.timeoutMs = options.timeoutMs || 15000;
    this._cachedAdbPath = null;
    this._cachedVersion = null;
  }

  /**
   * Resolve the absolute path to the adb binary across Windows, macOS, and Linux.
   */
  resolveAdbPath() {
    if (this.customAdbPath && fs.existsSync(this.customAdbPath)) {
      return this.customAdbPath;
    }
    if (this._cachedAdbPath && fs.existsSync(this._cachedAdbPath)) {
      return this._cachedAdbPath;
    }

    const isWindows = process.platform === "win32";
    const exeName = isWindows ? "adb.exe" : "adb";

    const candidatePaths = [];

    // 1. Explicit environment variables
    if (process.env.ANDROID_HOME) {
      candidatePaths.push(path.join(process.env.ANDROID_HOME, "platform-tools", exeName));
    }
    if (process.env.ANDROID_SDK_ROOT) {
      candidatePaths.push(path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", exeName));
    }

    // 2. Windows standard installation locations
    if (isWindows) {
      if (process.env.LOCALAPPDATA) {
        candidatePaths.push(path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", exeName));
      }
      if (process.env.PROGRAMFILES) {
        candidatePaths.push(path.join(process.env.PROGRAMFILES, "Android", "android-sdk", "platform-tools", exeName));
      }
      if (process.env["PROGRAMFILES(X86)"]) {
        candidatePaths.push(path.join(process.env["PROGRAMFILES(X86)"], "Android", "android-sdk", "platform-tools", exeName));
      }
      // Common standalone tools path
      candidatePaths.push(`C:\\platform-tools\\${exeName}`);
    }

    // 3. macOS standard locations
    if (process.platform === "darwin" && process.env.HOME) {
      candidatePaths.push(path.join(process.env.HOME, "Library", "Android", "sdk", "platform-tools", exeName));
    }

    // 4. Linux standard locations
    if (process.platform === "linux" && process.env.HOME) {
      candidatePaths.push(path.join(process.env.HOME, "Android", "Sdk", "platform-tools", exeName));
      candidatePaths.push(`/usr/bin/${exeName}`);
      candidatePaths.push(`/usr/local/bin/${exeName}`);
    }

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        this._cachedAdbPath = cand;
        return cand;
      }
    }

    // Fall back to PATH search
    this._cachedAdbPath = exeName;
    return exeName;
  }

  /**
   * Check ADB availability, version, and server readiness.
   */
  async checkAvailability() {
    const adbPath = this.resolveAdbPath();
    try {
      const { stdout } = await execFileAsync(adbPath, ["version"], { timeout: 5000 });
      const versionMatch = stdout.match(/Android Debug Bridge version ([0-9.]+)/i);
      const revisionMatch = stdout.match(/Version ([^\r\n]+)/i);
      const version = versionMatch ? versionMatch[1] : "unknown";
      const revision = revisionMatch ? revisionMatch[1].trim() : version;

      this._cachedVersion = version;
      return {
        available: true,
        path: adbPath,
        version,
        revision,
        rawOutput: stdout.trim()
      };
    } catch (err) {
      return {
        available: false,
        path: adbPath,
        version: null,
        error: `ADB not available or failed to execute: ${err.message}`
      };
    }
  }

  /**
   * Execute an adb command safely with discrete arguments (no shell injection).
   */
  async exec(args, options = {}) {
    const adbPath = this.resolveAdbPath();
    const timeout = options.timeoutMs || this.timeoutMs;
    const maxBuffer = options.maxBuffer || 16 * 1024 * 1024; // 16MB for screenshots

    try {
      const res = await execFileAsync(adbPath, args, {
        timeout,
        maxBuffer,
        encoding: options.encoding || "utf8",
        windowsHide: true
      });
      return {
        success: true,
        stdout: typeof res.stdout === "string" ? res.stdout.trim() : res.stdout,
        stderr: typeof res.stderr === "string" ? res.stderr.trim() : res.stderr
      };
    } catch (err) {
      return {
        success: false,
        stdout: err.stdout ? (typeof err.stdout === "string" ? err.stdout.trim() : err.stdout) : "",
        stderr: err.stderr ? (typeof err.stderr === "string" ? err.stderr.trim() : err.stderr) : "",
        error: err.message,
        code: err.code
      };
    }
  }

  /**
   * Execute an adb command targeting a specific device: `adb -s <deviceId> <...args>`.
   */
  async execDevice(deviceId, args, options = {}) {
    if (!deviceId || typeof deviceId !== "string") {
      throw new Error("Device ID is required for targeted ADB operations.");
    }
    return this.exec(["-s", deviceId, ...args], options);
  }

  /**
   * Discover all connected devices and parse `adb devices -l` output into structured records.
   */
  /**
   * Sanitizes arguments against shell injection and control characters.
   */
  sanitizeArg(value, fieldName = "argument") {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[\x00-\x1F;&|`$<>^]/.test(str)) {
      throw new Error(`INVALID_ARGUMENT: ${fieldName} contains forbidden control or shell characters.`);
    }
    return str;
  }

  /**
   * Parse `adb devices -l` output into structured device records.
   */
  parseDeviceList(stdout) {
    if (!stdout || typeof stdout !== "string") return [];
    const lines = stdout.split("\n");
    const devices = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("List of devices") || line.startsWith("* daemon")) {
        continue;
      }

      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const id = parts[0];
        const rawState = parts[1];
        const state = rawState === "device" ? "online" : rawState;

        let product = "unknown";
        let model = "unknown";
        let device = "unknown";
        let transportId = null;

        for (let i = 2; i < parts.length; i++) {
          const token = parts[i];
          if (token.startsWith("product:")) product = token.slice("product:".length);
          if (token.startsWith("model:")) model = token.slice("model:".length);
          if (token.startsWith("device:")) device = token.slice("device:".length);
          if (token.startsWith("transport_id:")) transportId = token.slice("transport_id:".length);
        }

        let connectionType = "usb";
        if (id.includes(":") || id.startsWith("tcpip:")) {
          connectionType = "wifi";
        } else if (id.startsWith("emulator-")) {
          connectionType = "emulator";
        }

        devices.push({
          id,
          name: model !== "unknown" ? model.replace(/_/g, " ") : id,
          state,
          rawState,
          platform: "android",
          type: connectionType === "emulator" ? "emulator" : "real",
          connectionType,
          model,
          product,
          device,
          transportId,
          ready: state === "online"
        });
      }
    }
    return devices;
  }

  /**
   * Parses dumpsys window/activity output for foreground package & activity.
   */
  parseForegroundActivity(stdout) {
    if (!stdout || typeof stdout !== "string") return { package: null, activity: null };
    const focusMatch = stdout.match(/mCurrentFocus=Window\{[^\s]+ [^\s]+ ([^\/\}\s]+)\/([^/\}\s]+)\}/i) ||
                       stdout.match(/mFocusedApp=.*ActivityRecord\{[^\s]+ [^\s]+ ([^\/\}\s]+)\/([^/\}\s]+)/i) ||
                       stdout.match(/([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.]+)/);
    if (focusMatch) {
      return { package: focusMatch[1].trim(), activity: focusMatch[2].trim() };
    }
    return { package: null, activity: null };
  }

  /**
   * Discover all connected devices and parse `adb devices -l` output into structured records.
   */
  async listDevices() {
    const res = await this.exec(["devices", "-l"]);
    if (!res.success) {
      return {
        success: false,
        devices: [],
        error: res.error || "Failed to query ADB devices"
      };
    }

    const devices = this.parseDeviceList(res.stdout);
    return {
      success: true,
      devices,
      count: devices.length,
      connected: devices.some(d => d.ready)
    };
  }

  /**
   * Get detailed device telemetry and properties.
   */
  async getDeviceDetails(deviceId) {
    const [sizeRes, releaseRes, modelRes, batteryRes] = await Promise.all([
      this.execDevice(deviceId, ["shell", "wm", "size"]),
      this.execDevice(deviceId, ["shell", "getprop", "ro.build.version.release"]),
      this.execDevice(deviceId, ["shell", "getprop", "ro.product.model"]),
      this.execDevice(deviceId, ["shell", "dumpsys", "battery"])
    ]);

    let width = 1080;
    let height = 2400;
    if (sizeRes.success && sizeRes.stdout) {
      const match = sizeRes.stdout.match(/Physical size:\s*([0-9]+)x([0-9]+)/i);
      if (match) {
        width = parseInt(match[1], 10);
        height = parseInt(match[2], 10);
      }
    }

    let batteryLevel = null;
    let batteryCharging = false;
    if (batteryRes.success && batteryRes.stdout) {
      const levelMatch = batteryRes.stdout.match(/level:\s*([0-9]+)/i);
      if (levelMatch) batteryLevel = parseInt(levelMatch[1], 10);
      const statusMatch = batteryRes.stdout.match(/status:\s*([0-9]+)/i);
      if (statusMatch && (statusMatch[1] === "2" || statusMatch[1] === "5")) {
        batteryCharging = true;
      }
    }

    return {
      deviceId,
      platform: "android",
      model: modelRes.success ? modelRes.stdout.replace(/_/g, " ") : "Android Device",
      androidVersion: releaseRes.success ? releaseRes.stdout : "unknown",
      screenSize: { width, height },
      battery: { level: batteryLevel, charging: batteryCharging }
    };
  }

  /**
   * Determine currently focused foreground package and activity.
   */
  async getForegroundApp(deviceId) {
    const res = await this.execDevice(deviceId, ["shell", "dumpsys", "window"]);
    if (res.success && res.stdout) {
      const parsed = this.parseForegroundActivity(res.stdout);
      if (parsed && parsed.package) {
        return { packageName: parsed.package, activity: parsed.activity };
      }
    }

    // Fallback to activity command
    const actRes = await this.execDevice(deviceId, ["shell", "dumpsys", "activity", "activities"]);
    if (actRes.success && actRes.stdout) {
      const parsed = this.parseForegroundActivity(actRes.stdout);
      if (parsed && parsed.package) {
        return { packageName: parsed.package, activity: parsed.activity };
      }
    }

    return { packageName: "unknown", activity: "unknown" };
  }

  /**
   * Capture a PNG screenshot buffer from the device.
   */
  async takeScreenshot(deviceId) {
    const res = await this.execDevice(deviceId, ["exec-out", "screencap", "-p"], {
      encoding: "buffer",
      timeoutMs: 10000
    });

    if (res.success && Buffer.isBuffer(res.stdout) && res.stdout.length > 0) {
      return res.stdout;
    }

    // Fallback via /data/local/tmp
    await this.execDevice(deviceId, ["shell", "screencap", "-p", "/data/local/tmp/ultron_snap.png"]);
    const pullRes = await this.execDevice(deviceId, ["exec-out", "cat", "/data/local/tmp/ultron_snap.png"], {
      encoding: "buffer"
    });
    if (pullRes.success && Buffer.isBuffer(pullRes.stdout) && pullRes.stdout.length > 0) {
      return pullRes.stdout;
    }

    throw new Error(`Failed to capture screenshot from device ${deviceId}: ${res.error || "empty buffer"}`);
  }

  /**
   * Dump UI hierarchy XML from device via UIAutomator.
   */
  async dumpHierarchy(deviceId) {
    const dumpPath = "/data/local/tmp/window_dump.xml";
    await this.execDevice(deviceId, ["shell", "uiautomator", "dump", dumpPath]);
    const res = await this.execDevice(deviceId, ["exec-out", "cat", dumpPath]);
    if (res.success && res.stdout) {
      return res.stdout;
    }
    throw new Error(`Failed to dump UI hierarchy from device ${deviceId}: ${res.error}`);
  }

  /**
   * Input: Tap coordinates.
   */
  async tap(deviceId, x, y) {
    return this.execDevice(deviceId, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
  }

  /**
   * Input: Swipe from (x1, y1) to (x2, y2) over durationMs.
   */
  async swipe(deviceId, x1, y1, x2, y2, durationMs = 300) {
    return this.execDevice(deviceId, [
      "shell",
      "input",
      "swipe",
      String(Math.round(x1)),
      String(Math.round(y1)),
      String(Math.round(x2)),
      String(Math.round(y2)),
      String(Math.round(durationMs))
    ]);
  }

  /**
   * Input: Type text (with shell character escaping).
   */
  async typeText(deviceId, text) {
    if (!text) return { success: true };
    // ADB input text requires special characters to be escaped or spaces replaced with %s
    const escaped = String(text)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\s/g, "%s");
    return this.execDevice(deviceId, ["shell", "input", "text", escaped]);
  }

  /**
   * Input: Key events (BACK, HOME, ENTER, etc.)
   */
  async pressKey(deviceId, keycode) {
    return this.execDevice(deviceId, ["shell", "input", "keyevent", String(keycode)]);
  }

  /**
   * Launch application package.
   */
  async launchApp(deviceId, packageName) {
    // monkey launch is resilient even without known MainActivity
    return this.execDevice(deviceId, ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
  }

  /**
   * Force stop application.
   */
  async terminateApp(deviceId, packageName) {
    return this.execDevice(deviceId, ["shell", "am", "force-stop", packageName]);
  }

  /**
   * Clear application data.
   */
  async clearAppData(deviceId, packageName) {
    return this.execDevice(deviceId, ["shell", "pm", "clear", packageName]);
  }

  /**
   * Open web URL in default device browser.
   */
  async openUrl(deviceId, url) {
    return this.execDevice(deviceId, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
  }

  /**
   * Wireless ADB: Connect to IP and port.
   */
  async connectWireless(ip, port = 5555) {
    const target = `${ip}:${port}`;
    return this.exec(["connect", target]);
  }

  /**
   * Wireless ADB: Disconnect from target.
   */
  async disconnectWireless(ip, port = 5555) {
    const target = `${ip}:${port}`;
    return this.exec(["disconnect", target]);
  }
}

export const adbBridge = new AdbBridge();
