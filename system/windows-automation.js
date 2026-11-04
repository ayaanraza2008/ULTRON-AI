/**
 * ULTRON AI — Native Windows Automation & Hardware Controller
 *
 * Implements direct PC and hardware control on Windows:
 * - Application launching and focus switching (VS Code, Chrome, Terminal, etc.)
 * - System audio control (volume up, volume down, mute, unmute via PowerShell/SAPI)
 * - Display brightness control via WMI (Source B ULTRONMAIN adaptation)
 * - Media playback controls (play/pause, next, prev, stop) (Source B adaptation)
 * - Window state management (minimize, maximize, restore, close) (Source B adaptation)
 * - GPU model and hardware telemetry via WMI (Source B adaptation)
 * - Display & session control (lock workstation, screen capture)
 * - Battery and power hardware telemetry (WMI CIM query)
 * - Active foreground window inspection
 *
 * Hardware optimized for AMD Ryzen 7 5700U on Windows.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execAsync = promisify(exec);

export const HARDWARE_STATUS = {
  SUPPORTED_AND_VERIFIED: "SUPPORTED_AND_VERIFIED",
  COMMAND_SENT_BUT_UNVERIFIED: "COMMAND_SENT_BUT_UNVERIFIED",
  UNSUPPORTED_HARDWARE: "UNSUPPORTED_HARDWARE",
  FAILED: "FAILED"
};

export class WindowsAutomation {
  constructor(options = {}) {
    this.sandboxBase = options.sandboxBase || path.join(os.homedir(), "Documents", "UltronWorkspace");
    this.emergencyStop = false;
    this.screenshotDir = path.join(this.sandboxBase, "screenshots");
    this.history = [];
  }

  async initialize() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch {}
  }

  setEmergencyStop(stopped) {
    this.emergencyStop = Boolean(stopped);
  }

  recordEvent(type, detail, status = "success") {
    const record = {
      id: "auto-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      type,
      detail: String(detail).slice(0, 200),
      status,
      timestamp: new Date().toISOString()
    };
    this.history.push(record);
    if (this.history.length > 100) this.history.shift();
    return record;
  }

  /**
   * Query Power and Battery State via WMI
   */
  async getBatteryStatus() {
    if (process.platform !== "win32") {
      return { present: false, percent: 100, isCharging: true, estimatedMinutes: null };
    }

    try {
      const psCommand = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_Battery | Select-Object -Property EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json"`;
      const { stdout } = await execAsync(psCommand, { timeout: 4000 });
      if (!stdout || stdout.trim() === "") {
        return { present: false, percent: 100, isCharging: true, estimatedMinutes: null };
      }
      const data = JSON.parse(stdout.trim());
      const percent = Number(data.EstimatedChargeRemaining) || 100;
      // BatteryStatus: 1 = Discharging, 2 = Unknown/AC, 3 = Fully Charged, 4 = Low, 5 = Critical, 6 = Charging
      const isCharging = data.BatteryStatus === 2 || data.BatteryStatus === 3 || data.BatteryStatus === 6;
      return {
        present: true,
        percent,
        isCharging,
        estimatedMinutes: data.EstimatedRunTime && data.EstimatedRunTime < 71582788 ? data.EstimatedRunTime : null
      };
    } catch {
      return { present: false, percent: 100, isCharging: true, estimatedMinutes: null };
    }
  }

  /**
   * System Audio Volume and Mute Control via PowerShell SAPI / Virtual Keys
   */
  async setSystemVolume(action, value = null) {
    if (this.emergencyStop) throw new Error("Computer automation halted under Emergency Stop.");

    const allowedActions = ["mute", "unmute", "volume_up", "volume_down", "set_level"];
    if (!allowedActions.includes(action)) {
      throw new Error(`Unsupported volume action: ${action}. Allowed: ${allowedActions.join(", ")}`);
    }

    if (process.platform !== "win32") {
      this.recordEvent("VOLUME", `${action}`, "mock_success");
      return { success: true, action, value, simulated: true };
    }

    try {
      let psScript = "";
      if (action === "mute" || action === "unmute") {
        psScript = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
      } else if (action === "volume_up") {
        psScript = `powershell -NoProfile -Command "1..5 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`;
      } else if (action === "volume_down") {
        psScript = `powershell -NoProfile -Command "1..5 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }"`;
      } else if (action === "set_level") {
        const level = Math.max(0, Math.min(100, Number(value) || 50));
        psScript = `powershell -NoProfile -Command "1..50 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }; 1..${Math.round(level / 2)} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`;
      }

      await execAsync(psScript, { timeout: 8000 });
      this.recordEvent("VOLUME", `${action} (${value ?? ""})`, "success");
      return { success: true, action, value };
    } catch (err) {
      this.recordEvent("VOLUME", `${action}`, "failed");
      throw new Error(`Failed to adjust volume: ${err.message}`);
    }
  }

  /**
   * Query Display Brightness via WMI (Source B ULTRONMAIN adaptation)
   */
  async getDisplayBrightness() {
    if (process.platform !== "win32") {
      return { supported: true, brightness: 100, simulated: true };
    }
    try {
      const psScript = `powershell -NoProfile -Command "Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentBrightness"`;
      const { stdout } = await execAsync(psScript, { timeout: 3000 });
      const val = parseInt(stdout ? stdout.trim() : "100", 10);
      if (Number.isFinite(val)) {
        return { supported: true, brightness: val };
      }
      return { supported: false, brightness: 100, note: "Display does not support WMI brightness." };
    } catch {
      return { supported: false, brightness: 100, note: "WMI brightness query unavailable." };
    }
  }

  /**
   * Set Display Brightness (0-100%) via WMI (Source B ULTRONMAIN adaptation)
   */
  async setDisplayBrightness(level) {
    if (this.emergencyStop) throw new Error("Computer automation halted under Emergency Stop.");
    const target = Math.max(0, Math.min(100, Math.round(Number(level) || 50)));

    if (process.platform !== "win32") {
      this.recordEvent("BRIGHTNESS", `level=${target}`, "mock_success");
      return { success: true, brightness: target, simulated: true };
    }

    try {
      const psScript = `powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; \$w = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods; if (-not \$w) { throw 'WmiMonitorBrightnessMethods not available' }; \$w.WmiSetBrightness(1, ${target}); 'OK'"`;
      const { stdout } = await execAsync(psScript, { timeout: 4000 });
      const ok = stdout && stdout.includes("OK");

      // Verify read-back from hardware
      const readback = await this.getDisplayBrightness();
      const verified = Boolean(ok && readback.supported && readback.brightness === target);

      let hardwareStatus;
      if (!readback.supported) {
        hardwareStatus = HARDWARE_STATUS.UNSUPPORTED_HARDWARE;
      } else if (verified) {
        hardwareStatus = HARDWARE_STATUS.SUPPORTED_AND_VERIFIED;
      } else {
        hardwareStatus = HARDWARE_STATUS.COMMAND_SENT_BUT_UNVERIFIED;
      }

      this.recordEvent("BRIGHTNESS", `level=${target}`, ok ? "success" : "unsupported");
      return {
        success: Boolean(ok),
        brightness: target,
        currentBrightness: readback.brightness,
        verified,
        supported: readback.supported,
        hardwareStatus
      };
    } catch (err) {
      this.recordEvent("BRIGHTNESS", `level=${target}`, "failed");
      const isUnsupported = /not available|WmiMonitorBrightness/i.test(err.message);
      return {
        success: false,
        brightness: target,
        verified: false,
        supported: false,
        hardwareStatus: isUnsupported ? HARDWARE_STATUS.UNSUPPORTED_HARDWARE : HARDWARE_STATUS.FAILED,
        error: err.message
      };
    }
  }

  /**
   * Dispatch Virtual Media Key Controls (Source B adaptation)
   * Actions: play_pause, next_track, prev_track, stop
   */
  async dispatchMediaKey(action) {
    if (this.emergencyStop) throw new Error("Computer automation halted under Emergency Stop.");

    const MEDIA_KEY_CODES = {
      play_pause: 179, // VK_MEDIA_PLAY_PAUSE (0xB3)
      next_track: 176, // VK_MEDIA_NEXT_TRACK (0xB0)
      prev_track: 177, // VK_MEDIA_PREV_TRACK (0xB1)
      stop: 178        // VK_MEDIA_STOP (0xB2)
    };

    const normalized = String(action || "").toLowerCase().trim();
    const vkCode = MEDIA_KEY_CODES[normalized];
    if (!vkCode) {
      throw new Error(`Unsupported media action '${action}'. Allowed: ${Object.keys(MEDIA_KEY_CODES).join(", ")}`);
    }

    if (process.platform !== "win32") {
      this.recordEvent("MEDIA_KEY", normalized, "mock_success");
      return { success: true, action: normalized, simulated: true };
    }

    try {
      const psScript = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${vkCode})"`;
      await execAsync(psScript, { timeout: 3000 });
      this.recordEvent("MEDIA_KEY", normalized, "success");
      return { success: true, action: normalized };
    } catch (err) {
      this.recordEvent("MEDIA_KEY", normalized, "failed");
      throw new Error(`Failed to dispatch media key '${action}': ${err.message}`);
    }
  }

  /**
   * Manage Window State for Active Foreground Window (Source B adaptation)
   * Actions: minimize, maximize, restore, close
   */
  async setWindowState(action) {
    if (this.emergencyStop) throw new Error("Computer automation halted under Emergency Stop.");

    const normalized = String(action || "").toLowerCase().trim();
    const SHORTCUTS = {
      minimize: "% n",    // Alt+Space, n
      maximize: "% x",    // Alt+Space, x
      restore: "% r",     // Alt+Space, r
      close: "%{F4}"      // Alt+F4
    };

    const keys = SHORTCUTS[normalized];
    if (!keys) {
      throw new Error(`Unsupported window action '${action}'. Allowed: ${Object.keys(SHORTCUTS).join(", ")}`);
    }

    if (process.platform !== "win32") {
      this.recordEvent("WINDOW_STATE", normalized, "mock_success");
      return { success: true, action: normalized, simulated: true };
    }

    try {
      const psScript = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys('${keys}')"`;
      await execAsync(psScript, { timeout: 3000 });
      this.recordEvent("WINDOW_STATE", normalized, "success");
      return { success: true, action: normalized };
    } catch (err) {
      this.recordEvent("WINDOW_STATE", normalized, "failed");
      throw new Error(`Failed to change window state to '${action}': ${err.message}`);
    }
  }

  /**
   * Query GPU Model and Hardware Information (Source B adaptation)
   */
  async getGpuInfo() {
    if (process.platform !== "win32") {
      return { name: "Virtual / Non-Windows GPU", vramBytes: 0, simulated: true };
    }
    try {
      const psScript = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_VideoController | Select-Object -Property Name, AdapterRAM, DriverVersion, VideoProcessor | ConvertTo-Json"`;
      const { stdout } = await execAsync(psScript, { timeout: 4000 });
      if (!stdout || !stdout.trim()) {
        return { name: "Integrated Graphics", vramBytes: 0 };
      }
      const raw = JSON.parse(stdout.trim());
      const data = Array.isArray(raw) ? raw[0] : raw;
      return {
        name: data.Name || "Unknown GPU",
        vramBytes: Number(data.AdapterRAM) || 0,
        driverVersion: data.DriverVersion || null,
        processor: data.VideoProcessor || null
      };
    } catch {
      return { name: "Unknown GPU", vramBytes: 0 };
    }
  }

  /**
   * Screen Capture of Primary Monitor
   * Saves PNG to sandbox directory and returns metadata + base64 data URL
   */
  async captureScreen(filenamePrefix = "ultron_capture") {
    if (this.emergencyStop) throw new Error("Screen capture halted under Emergency Stop.");

    await this.initialize();
    const timestamp = Date.now();
    const filename = `${filenamePrefix}_${timestamp}.png`;
    const outputPath = path.join(this.screenshotDir, filename);

    if (process.platform !== "win32") {
      // Mock for non-Windows tests
      const mockData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      this.recordEvent("SCREEN_CAPTURE", outputPath, "mock_success");
      return {
        success: true,
        path: outputPath,
        filename,
        dataUrl: mockData,
        capturedAt: new Date().toISOString()
      };
    }

    try {
      const psScript = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bmp.Save('${outputPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png); $gfx.Dispose(); $bmp.Dispose()"`;
      await execAsync(psScript, { timeout: 5000 });

      const imageBuffer = await fs.readFile(outputPath);
      const dataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;

      this.recordEvent("SCREEN_CAPTURE", outputPath, "success");
      return {
        success: true,
        path: outputPath,
        filename,
        sizeBytes: imageBuffer.length,
        dataUrl,
        capturedAt: new Date().toISOString()
      };
    } catch (err) {
      this.recordEvent("SCREEN_CAPTURE", outputPath, "failed");
      throw new Error(`Screen capture failed: ${err.message}`);
    }
  }

  /**
   * Lock Workstation Session
   */
  async lockWorkstation() {
    if (this.emergencyStop) throw new Error("Computer automation halted under Emergency Stop.");

    if (process.platform !== "win32") {
      this.recordEvent("LOCK_WORKSTATION", "simulated", "mock_success");
      return { success: true, locked: true, simulated: true };
    }

    try {
      await execAsync("rundll32.exe user32.dll,LockWorkStation", { timeout: 3000 });
      this.recordEvent("LOCK_WORKSTATION", "locked", "success");
      return { success: true, locked: true };
    } catch (err) {
      this.recordEvent("LOCK_WORKSTATION", "failed", "failed");
      throw new Error(`Failed to lock workstation: ${err.message}`);
    }
  }

  /**
   * Get Active Foreground Window Title
   */
  async getActiveWindowTitle() {
    if (process.platform !== "win32") {
      return { title: "Mock Desktop Window", processId: 1000 };
    }

    try {
      const psScript = `powershell -NoProfile -Command "Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinUtil {
  [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();
  [DllImport(\\"user32.dll\\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
$handle = [WinUtil]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 256
[void][WinUtil]::GetWindowText($handle, $title, 256)
$title.ToString()
"`;
      const { stdout } = await execAsync(psScript, { timeout: 3000 });
      const title = stdout ? stdout.trim() : "Desktop";
      return { title: title || "Desktop" };
    } catch {
      return { title: "Unknown" };
    }
  }

  /**
   * Gracefully terminate an approved local desktop application.
   */
  async closeApprovedApp(appName) {
    if (this.emergencyStop) throw new Error("Computer automation halted under Emergency Stop.");

    const ALLOWED_CLOSABLE = {
      notepad: "notepad",
      calculator: "CalculatorApp",
      browser: "msedge"
    };

    const targetProcess = ALLOWED_CLOSABLE[appName.toLowerCase().trim()];
    if (!targetProcess) {
      throw new Error(`App '${appName}' is not in the approved closable allowlist. Allowed: ${Object.keys(ALLOWED_CLOSABLE).join(", ")}`);
    }

    if (process.platform !== "win32") {
      this.recordEvent("CLOSE_APP", appName, "mock_success");
      return { success: true, app: appName, processName: targetProcess, simulated: true };
    }

    try {
      const psScript = `powershell -NoProfile -Command "Get-Process -Name ${targetProcess} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0"`;
      await execAsync(psScript, { timeout: 8000 });
      this.recordEvent("CLOSE_APP", appName, "success");
      return { success: true, app: appName, processName: targetProcess };
    } catch (err) {
      this.recordEvent("CLOSE_APP", appName, "failed");
      throw new Error(`Failed to terminate ${appName}: ${err.message}`);
    }
  }

  /**
   * Gathers comprehensive local PC vitals (battery, foreground window, memory load, brightness, GPU).
   */
  async getSystemVitals() {
    const battery = await this.getBatteryStatus();
    const activeWindow = await this.getActiveWindowTitle();
    const brightness = await this.getDisplayBrightness();
    const gpu = await this.getGpuInfo();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramUsagePercent = Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1));

    return {
      telemetrySource: "windows_pc",
      platform: process.platform,
      activeWindow: activeWindow.title,
      battery,
      brightness,
      gpu,
      ramUsagePercent,
      memoryHeadroomSafe: ramUsagePercent <= 85.0,
      timestamp: new Date().toISOString()
    };
  }
}

export const windowsAutomation = new WindowsAutomation();
