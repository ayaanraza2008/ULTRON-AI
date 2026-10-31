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
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
  }

  async initialize() {
    try {
      await fs.mkdir(this.sandboxBase, { recursive: true });
    } catch {}
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
   * Specifically tuned for AMD Ryzen 7 5700U / 8GB RAM monitoring.
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
      platform: "windows",
      osType: os.type(),
      osRelease: os.release(),
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model || "AMD Ryzen 7 5700U with Radeon Graphics",
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
      exec(`start ${executable}`);
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
    const safeRel = String(relativePath || "").replace(/^[\\/]+/, "");
    const resolved = path.resolve(this.sandboxBase, safeRel);
    if (!resolved.startsWith(this.sandboxBase)) {
      throw new Error("Path traversal violation: Access outside Ultron workspace is forbidden.");
    }
    return resolved;
  }

  async listFiles(subDir = "") {
    const targetDir = this.resolveSafePath(subDir);
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
    const content = await fs.readFile(safePath, "utf-8");
    this.recordAction("READ_FILE", safePath);
    return { path: filePath, content, byteLength: Buffer.byteLength(content) };
  }

  async writeFile(filePath, content) {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");
    const safePath = this.resolveSafePath(filePath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, String(content), "utf-8");
    this.recordAction("WRITE_FILE", safePath);
    return { success: true, path: filePath, byteLength: Buffer.byteLength(String(content)) };
  }

  /**
   * Approved Terminal Execution
   * Executes only non-destructive, read-only system queries.
   */
  async runApprovedCommand(cmdString) {
    if (this.emergencyStop) throw new Error("Computer control is halted under Emergency Stop.");

    const normalized = String(cmdString).trim();
    if (!ALLOWLISTED_TERMINAL_COMMANDS.has(normalized)) {
      throw new Error(`Command '${normalized}' is not in the approved command allowlist.`);
    }

    try {
      const { stdout, stderr } = await execAsync(normalized, { timeout: 10_000, maxBuffer: 64 * 1024 });
      this.recordAction("EXEC_COMMAND", normalized, "success");
      return { command: normalized, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err) {
      this.recordAction("EXEC_COMMAND", normalized, "failed");
      return { command: normalized, error: err.message, exitCode: err.code || 1 };
    }
  }

  getActionHistory(limit = 50) {
    return this.actionHistory.slice(-limit);
  }
}
