/**
 * ULTRON AI — Native Windows Automation & Hardware Controller
 *
 * Implements direct PC and hardware control on Windows:
 * - Application launching and focus switching (VS Code, Chrome, Terminal, etc.)
 * - System audio control (volume up, volume down, mute, unmute via PowerShell/SAPI)
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
      return { success: true, action, simulated: true };
    }

    try {
      let psScript = "";
      if (action === "mute" || action === "unmute") {
        // AppActivate and send volume mute key (VK 173 = 0xAD)
        psScript = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
      } else if (action === "volume_up") {
        psScript = `powershell -NoProfile -Command "1..5 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`;
      } else if (action === "volume_down") {
        psScript = `powershell -NoProfile -Command "1..5 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }"`;
      } else if (action === "set_level") {
        const level = Math.max(0, Math.min(100, Number(value) || 50));
        psScript = `powershell -NoProfile -Command "1..50 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }; 1..${Math.round(level / 2)} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`;
      }

      await execAsync(psScript, { timeout: 3000 });
      this.recordEvent("VOLUME", `${action} (${value ?? ""})`, "success");
      return { success: true, action, value };
    } catch (err) {
      this.recordEvent("VOLUME", `${action}`, "failed");
      throw new Error(`Failed to adjust volume: ${err.message}`);
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
}

export const windowsAutomation = new WindowsAutomation();
