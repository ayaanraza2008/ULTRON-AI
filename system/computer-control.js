/**
 * ULTRON AI — Modular Windows Computer Control Subsystem
 *
 * Provides safe, audited, permission-gated Windows operations:
 * application launching, sandboxed file management, system telemetry,
 * clipboard interaction, and non-destructive terminal execution.
 *
 * Hardware optimized for AMD Ryzen 7 5700U with 8 GB RAM.
 */

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { ByoxShellAstValidator } from "./byox-shell-ast-validator.js";
import { constants as fsConstants } from "node:fs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Allowed launch applications
const ALLOWLISTED_APPS = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  terminal: "wt.exe",
  cmd: "cmd.exe",
  browser: "msedge.exe"
};

// Allowed non-destructive terminal commands
const ALLOWLISTED_TERMINAL_COMMANDS = new Set([
  "dir",
  "echo",
  "git status",
  "git branch",
  "git log -n 5 --oneline",
  "node --version",
  "npm --version",
  "python --version",
  "ipconfig",
  "hostname",
  "whoami"
]);

export class WindowsComputerControl {
  constructor(options = {}) {
    this.userHome = os.homedir();
    this.sandboxBase = options.sandboxBase || path.join(this.userHome, "Documents", "UltronWorkspace");
    this.emergencyStop = false;
    this.actionHistory = [];
    this._inMemoryClipboard = "";
    this.astValidator = options.astValidator || new ByoxShellAstValidator();
  }

  async initialize() {
    await fs.mkdir(this.sandboxBase, { recursive: true });
    await this.assertNoSymlinkTraversal(path.resolve(this.sandboxBase));
  }

  setEmergencyStop(halted) {
    this.emergencyStop = Boolean(halted);
  }

  isEmergencyStopped() {
    return this.emergencyStop;
  }

  recordAction(action, target, result = "success") {
    const entry = {
      id: "win-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      action,
      target: String(target).slice(0, 200),
      result
    };
    this.actionHistory.push(entry);
    if (this.actionHistory.length > 200) this.actionHistory.shift();
    return entry;
  }

  /**
   * System Telemetry: CPU, RAM, OS, and Architecture
   * Reports the operating system running this process; it is not telemetry from a paired user device.
   */
  getSystemTelemetry() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramUsagePercent = Number(((usedMem / totalMem) * 100).toFixed(1));
    const cpus = os.cpus();

    // High RAM alert for 8 GB system (if > 85% RAM used, signal throttling)
    const memoryPressure = ramUsagePercent > 85.0;

    return {
      platform: process.platform,
      architecture: process.arch,
      executionEnvironment: "server_process",
      osType: os.type(),
      osRelease: os.release(),
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model || "Unknown runtime CPU",
      cpuCores: cpus.length,
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usedPercent: ramUsagePercent,
        memoryPressureWarning: memoryPressure
      },
      uptimeSeconds: Math.floor(os.uptime()),
      loadAvg: os.loadavg(),
      sandboxDirectory: this.sandboxBase,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Application Launching (Allowlisted)
   */
  async launchApplication(appKey) {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");

    const normalized = String(appKey).toLowerCase().trim();
    const executable = ALLOWLISTED_APPS[normalized];
    if (!executable) {
      throw new Error(`Application '${appKey}' is not in the approved launch allowlist.`);
    }

    try {
      const shellCmd = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : executable;
      const shellArgs = process.platform === "win32" ? ["/d", "/c", "start", "", executable] : [];
      await execFileAsync(shellCmd, shellArgs);
      this.recordAction("LAUNCH_APP", executable, "success");
      return { success: true, app: normalized, executable, status: "launched" };
    } catch (err) {
      this.recordAction("LAUNCH_APP", executable, "failed");
      throw new Error(`Failed to launch application '${appKey}': ${err.message}`);
    }
  }

  /**
   * Sandboxed File System Operations
   * Strictly prevents path traversal outside safe designated directories.
   */
  resolveSafePath(relativePath) {
    const root = path.resolve(this.sandboxBase);
    const raw = String(relativePath || "");
    const isAbs = path.isAbsolute(raw) || /^[\\/]/.test(raw);
    const resolved = isAbs ? path.resolve(root, raw.replace(/^[\\/]+/, "")) : path.resolve(root, raw);
    // If raw was absolute outside workspace root, reject
    if (isAbs && path.isAbsolute(raw) && !path.resolve(raw).startsWith(root)) {
      throw new Error("Path traversal violation: Access outside Ultron workspace is forbidden.");
    }
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw new Error("Path traversal violation: Access outside Ultron workspace is forbidden.");
    }
    return resolved;
  }

  async assertNoSymlinkTraversal(targetPath) {
    const root = path.resolve(this.sandboxBase);
    const resolved = this.resolveSafePath(path.relative(root, path.resolve(targetPath)));
    const rootStat = await fs.lstat(root);
    if (rootStat.isSymbolicLink()) {
      const error = new Error("Symbolic-link traversal violation: the Ultron workspace root cannot be a symbolic link.");
      error.code = "PATH_SYMLINK_VIOLATION";
      throw error;
    }

    const relative = path.relative(root, resolved);
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          const error = new Error("Symbolic-link traversal violation: symbolic links are not allowed inside the Ultron workspace.");
          error.code = "PATH_SYMLINK_VIOLATION";
          throw error;
        }
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
    }
    return resolved;
  }

  async listFiles(subDir = "") {
    const targetDir = this.resolveSafePath(subDir);
    await this.assertNoSymlinkTraversal(targetDir);
    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }));
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async readFile(filePath) {
    const safePath = this.resolveSafePath(filePath);
    await this.assertNoSymlinkTraversal(safePath);
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    const handle = await fs.open(safePath, flags);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new Error("Only regular files can be read from the Ultron workspace.");
      const content = await handle.readFile("utf-8");
      this.recordAction("READ_FILE", safePath);
      return { path: filePath, content, byteLength: Buffer.byteLength(content) };
    } finally {
      await handle.close();
    }
  }

  async writeFile(filePath, content) {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");
    const safePath = this.resolveSafePath(filePath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await this.assertNoSymlinkTraversal(safePath);
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW || 0);
    const handle = await fs.open(safePath, flags, 0o600);
    try {
      await handle.writeFile(String(content), "utf-8");
    } finally {
      await handle.close();
    }
    this.recordAction("WRITE_FILE", safePath);
    return { success: true, path: filePath, byteLength: Buffer.byteLength(String(content)) };
  }

  /**
   * Check whether a command string matches destructive patterns (Source A & B safety gate).
   */
  isDestructiveCommand(cmdString) {
    const raw = String(cmdString || "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();

    // Catch encoded PowerShell invocations
    if (/(?:powershell|pwsh).*(?:-(?:enc|encodedcommand)|\[system\.convert\]::frombase64string|invoke-expression|\biex\b)/i.test(lower)) {
      return true;
    }
    // Catch process kills
    if (/\btaskkill(?:\s|\/)/i.test(lower) || /\bstop-process\b/i.test(lower)) {
      return true;
    }
    // Catch registry or service deletion
    if (/\breg\s+delete\b/i.test(lower) || /\bsc\s+delete\b/i.test(lower)) {
      return true;
    }
    // Catch database destruction
    if (/\b(?:drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?[a-z0-9_]+|delete\s+from\b)/i.test(lower)) {
      return true;
    }

    // Strip leading quotes or drive/path from executable
    const normalized = lower
      .replace(/^["']([^"']+)["']/, "$1")
      .replace(/^[a-z]:\\[^ \t\n\r"']+\\/i, "");

    const DESTRUCTIVE_PATTERNS = [
      /^(?:rm|del|erase|rd|rmdir|format)(?:\s|\/|$)/i,
      /(?:[\s;&|])(?:rm|del|erase|rd|rmdir|format)(?:\s|\/|$)/i,
      /\bshutdown(?:\s|\/|$)/i,
      /\bremove-item(?:property)?\b/i,
      /\bclear-content\b/i,
      /\bmkfs(?:\.[a-z0-9]+|\s)/i,
      /\bdd\s+if=/i
    ];

    return DESTRUCTIVE_PATTERNS.some(regex => regex.test(normalized) || regex.test(lower));
  }

  /**
   * Approved Terminal Execution
   * Executes only non-destructive, read-only system queries.
   * Destructive commands strictly require confirmation (Level 4 confirmation token).
   */
  async runApprovedCommand(cmdString, options = {}) {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");

    const normalized = String(cmdString).trim();
    if (this.isDestructiveCommand(normalized) && !options.confirmed) {
      return {
        success: false,
        requiresConfirmation: true,
        code: "DESTRUCTIVE_CONFIRMATION_REQUIRED",
        reason: "Destructive command execution requires explicit human confirmation.",
        command: normalized
      };
    }

    // Reject any command containing shell chaining characters (&, |, ;, newline, backticks, $())
    if (/[\r\n&|;`$]/.test(normalized)) {
      throw new Error("Command contains forbidden shell metacharacters or chaining operators.");
    }

    if (!ALLOWLISTED_TERMINAL_COMMANDS.has(normalized)) {
      throw new Error(`Command '${normalized}' is not in the approved command allowlist.`);
    }

    try {
      // Map allowlisted commands to explicit executable + argv arrays (no shell interpolation)
      let file;
      let args = [];
      const parts = normalized.split(/\s+/);
      const prog = parts[0].toLowerCase();

      if (prog === "node") {
        file = process.execPath;
        args = parts.slice(1);
      } else if (prog === "npm") {
        file = process.platform === "win32" ? "npm.cmd" : "npm";
        args = parts.slice(1);
      } else if (prog === "git") {
        file = "git";
        args = parts.slice(1);
      } else if (prog === "python") {
        file = process.platform === "win32" ? "python.exe" : "python";
        args = parts.slice(1);
      } else if (prog === "whoami") {
        file = "whoami";
        args = [];
      } else if (prog === "hostname") {
        file = "hostname";
        args = [];
      } else if (prog === "ipconfig") {
        file = "ipconfig";
        args = [];
      } else if (prog === "dir" || prog === "echo") {
        file = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
        args = process.platform === "win32" ? ["/d", "/c", ...parts] : ["-c", parts.join(" ")];
      } else {
        file = parts[0];
        args = parts.slice(1);
      }

      const { stdout, stderr } = await execFileAsync(file, args, { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
      this.recordAction("EXEC_COMMAND", normalized, "success");
      return { command: normalized, stdout: (stdout || "").trim(), stderr: (stderr || "").trim(), exitCode: 0, success: true };
    } catch (err) {
      this.recordAction("EXEC_COMMAND", normalized, "failed");
      return { command: normalized, error: err.message, exitCode: err.code || 1, success: false };
    }
  }

  /**
   * Comprehensive System Telemetry: CPU, RAM, OS, Battery, GPU, and Display Brightness.
   */
  async getComprehensiveTelemetry() {
    const basic = this.getSystemTelemetry();
    let battery = null;
    let gpu = null;
    let brightness = null;
    try {
      const { windowsAutomation } = await import("./windows-automation.js");
      battery = await windowsAutomation.getBatteryStatus();
      gpu = await windowsAutomation.getGpuInfo();
      brightness = await windowsAutomation.getDisplayBrightness();
    } catch {}
    return {
      ...basic,
      battery,
      gpu,
      brightness
    };
  }

  getActionHistory(limit = 50) {
    return this.actionHistory.slice(-limit);
  }
/**
   * Alias for launchApplication for standard tool calling interfaces.
   */
  async launchApprovedApp(appKey) {
    return this.launchApplication(appKey);
  }

  /**
   * Run a fixed PowerShell executable with an encoded script. The script is
   * passed as one argv value (never through cmd.exe); dynamic clipboard text
   * is separately UTF-8/base64 encoded before it is embedded in the script.
   */
  async runClipboardPowerShell(script) {
    const encodedScript = Buffer.from(String(script), "utf16le").toString("base64");
    return execFileAsync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript
    ], { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true });
  }

  /**
   * Safe Clipboard Access: Write text to the OS clipboard when supported.
   * In-memory fallback is explicitly reported as unavailable, never success.
   */
  async setClipboardText(text) {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");
    const sanitized = String(text || "");
    this._inMemoryClipboard = sanitized;
    const byteLength = Buffer.byteLength(sanitized);

    if (process.platform !== "win32") {
      this.recordAction("SET_CLIPBOARD", "system_unavailable", "not_available");
      return {
        success: false,
        available: false,
        byteLength,
        simulated: true,
        fallbackStored: true,
        errorCode: "SYSTEM_CLIPBOARD_UNAVAILABLE"
      };
    }

    try {
      const encodedText = Buffer.from(sanitized, "utf8").toString("base64");
      const script = `$ErrorActionPreference = 'Stop'; $value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}')); Set-Clipboard -Value $value`;
      await this.runClipboardPowerShell(script);
      this.recordAction("SET_CLIPBOARD", "windows_clipboard", "success");
      return { success: true, available: true, byteLength, source: "system" };
    } catch {
      this.recordAction("SET_CLIPBOARD", "windows_clipboard", "failed");
      return {
        success: false,
        available: false,
        byteLength,
        fallback: true,
        fallbackStored: true,
        source: "in_memory",
        errorCode: "CLIPBOARD_WRITE_FAILED"
      };
    }
  }

  /**
   * Safe Clipboard Access: Read from the OS clipboard; fallback reads are
   * explicitly identified and are not represented as a system clipboard read.
   */
  async getClipboardText() {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");

    if (process.platform !== "win32") {
      this.recordAction("GET_CLIPBOARD", "system_unavailable", "not_available");
      return {
        success: false,
        available: false,
        text: this._inMemoryClipboard,
        simulated: true,
        source: "in_memory",
        errorCode: "SYSTEM_CLIPBOARD_UNAVAILABLE"
      };
    }

    try {
      const { stdout } = await this.runClipboardPowerShell(
        "$ErrorActionPreference = 'Stop'; Get-Clipboard -Raw | Write-Output"
      );
      const text = String(stdout || "").replace(/\r?\n$/, "");
      this.recordAction("GET_CLIPBOARD", "windows_clipboard", "success");
      return { success: true, available: true, text, source: "system" };
    } catch {
      this.recordAction("GET_CLIPBOARD", "windows_clipboard", "failed");
      return {
        success: false,
        available: false,
        text: this._inMemoryClipboard,
        fallback: true,
        source: "in_memory",
        errorCode: "CLIPBOARD_READ_FAILED"
      };
    }
  }

  /**
   * BYOX Tokenized AST validation for composite or parameterized commands.
   */
  validateCommandAst(commandStr) {
    return this.astValidator.validateCommand(commandStr);
  }
}
