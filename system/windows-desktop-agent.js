/**
 * ULTRON AI — Windows Desktop Agent
 * Project Codename: ULTRON ETERNAL
 *
 * Implements the secure PC-side companion daemon:
 * - Device registration and continuous heartbeat with the central backend.
 * - Screen lock & unlock state synchronization with the Cyber-HUD Energy Core.
 * - Local command execution (allowlisted apps, safe scripts, tests).
 * - System storage, battery, CPU, and RAM diagnostics.
 * - Real-time progress updates sent back to telephone callers and web clients.
 * - Safe error recovery and auto-reconnect upon network interruption.
 */

import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { windowsAutomation } from "./windows-automation.js";
import { WindowsComputerControl } from "./computer-control.js";

const execAsync = promisify(exec);

export const DESKTOP_SCREEN_STATE = {
  LOCKED: "SYSTEM_LOCKED",
  UNLOCKED: "SYSTEM_UNLOCKED"
};

export class WindowsDesktopAgent {
  constructor(options = {}) {
    this.deviceId = options.deviceId || "pc-windows-" + os.hostname().toLowerCase();
    this.deviceName = options.deviceName || "Primary Windows Workstation (" + os.hostname() + ")";
    this.projectRoot = path.resolve(options.projectRoot || process.env.ULTRON_PROJECT_ROOT || process.cwd());
    this.screenState = DESKTOP_SCREEN_STATE.LOCKED;
    this.deviceHub = options.deviceHub || null;
    this.registered = false;
    this.authToken = null;
    this.activeTask = null;
    this.activeTasks = new Map();
    this.executionHistory = [];
    this.onStateChangeCallback = options.onStateChange || null;
    this.computerControl = options.computerControl || new WindowsComputerControl();
    this.workerTimer = null;
    this.heartbeatTimer = null;
    this.workerRunning = false;
  }

  /**
   * Registers this PC with the central DeviceHub.
   */
  async register(deviceHub) {
    const hub = deviceHub || this.deviceHub;
    if (!hub) {
      this.registered = true;
      this.authToken = "dtk_" + crypto.randomUUID();
      return { success: true, deviceId: this.deviceId, localOnly: true };
    }

    const pairing = hub.createPairingCode({
      name: this.deviceName,
      platform: "windows"
    });

    const verification = hub.verifyPairingCode(pairing.code);
    if (verification.success) {
      this.registered = true;
      this.deviceId = verification.deviceId;
      this.authToken = verification.authToken;
      return { success: true, deviceId: this.deviceId, registered: true };
    }

    return { success: false, error: "PAIRING_FAILED" };
  }

  /**
   * Refuses remote unlock: Windows sign-in must be completed through local authentication.
   */
  async unlockScreen() {
    return {
      success: false,
      error: "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION",
      deviceId: this.deviceId,
      screenState: this.screenState,
      message: "ULTRON cannot bypass Windows sign-in. Unlock the workstation locally, then reconnect the companion."
    };
  }

  /**
   * Locks the workstation screen via user32.dll LockWorkStation.
   */
  async lockScreen() {
    let winLock;
    try {
      winLock = await windowsAutomation.lockWorkstation();
    } catch (error) {
      return {
        success: false,
        error: "WORKSTATION_LOCK_FAILED",
        deviceId: this.deviceId,
        screenState: this.screenState,
        message: String(error?.message || "Windows did not confirm the lock request.").slice(0, 300)
      };
    }

    if (winLock?.success !== true) {
      return {
        success: false,
        error: "WORKSTATION_LOCK_FAILED",
        deviceId: this.deviceId,
        screenState: this.screenState,
        lockResult: winLock || null,
        message: "Windows did not confirm the lock request."
      };
    }

    this.screenState = DESKTOP_SCREEN_STATE.LOCKED;
    this.notifyStateChange("SYSTEM_LOCKED", {
      deviceId: this.deviceId,
      screenState: this.screenState,
      theme: "reactor_blue_locked",
      timestamp: new Date().toISOString(),
      simulated: winLock.simulated === true
    });

    return {
      success: true,
      deviceId: this.deviceId,
      screenState: this.screenState,
      simulated: winLock.simulated === true,
      lockResult: winLock,
      message: winLock.simulated === true
        ? "Lock request was simulated; no Windows workstation was locked."
        : "Windows confirmed the workstation lock request."
    };
  }

  /**
   * Queries real local storage, RAM, and system vitals.
   */
  async getSystemVitals() {
    const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024));
    const ramUsedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

    let storageAvailableGb = null;
    if (process.platform === "win32") {
      try {
        const psCmd = `powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -Property Root, Free | ConvertTo-Json"`;
        const { stdout } = await execAsync(psCmd, { timeout: 4000 });
        if (stdout && stdout.trim()) {
          const drives = JSON.parse(stdout.trim());
          const cDrive = Array.isArray(drives) ? drives.find(d => String(d.Root).startsWith("C")) : drives;
          if (cDrive && cDrive.Free) {
            storageAvailableGb = Math.round(cDrive.Free / (1024 * 1024 * 1024));
          }
        }
      } catch {}
    }

    const battery = await windowsAutomation.getBatteryStatus();

    return {
      deviceId: this.deviceId,
      hostname: os.hostname(),
      platform: process.platform,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "unknown",
      totalRamGb: totalMem,
      freeRamGb: freeMem,
      ramUsedPercent,
      storageAvailableGb,
      battery,
      screenState: this.screenState
    };
  }

  /**
   * Inspects project metadata and Git state without executing tests or claiming test health.
   */
  async checkProjectStatus() {
    const task = {
      task: "CHECK_PROJECT",
      startedAt: new Date().toISOString(),
      status: "RUNNING"
    };
    this.activeTask = task;

    let packageInfo = null;
    let packageReadError = null;
    try {
      const packageText = await fs.readFile(path.join(this.projectRoot, "package.json"), "utf8");
      packageInfo = JSON.parse(packageText);
    } catch (error) {
      packageReadError = error?.code || "PROJECT_PACKAGE_METADATA_UNAVAILABLE";
    }

    let repository = {
      detected: false,
      name: path.basename(this.projectRoot),
      branch: null,
      commitSha: null,
      workingTreeClean: null
    };
    try {
      const { stdout } = await execAsync(
        "git rev-parse --show-toplevel && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git status --porcelain",
        { cwd: this.projectRoot, timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 }
      );
      const [repositoryRoot, branch, commitSha, ...statusLines] = stdout.trimEnd().split(/\r?\n/);
      repository = {
        detected: Boolean(repositoryRoot && commitSha),
        name: repositoryRoot ? path.basename(repositoryRoot) : path.basename(this.projectRoot),
        branch: branch || null,
        commitSha: commitSha || null,
        workingTreeClean: statusLines.join("\n").trim().length === 0
      };
    } catch {
      // A companion may be installed outside a Git checkout; report metadata as unavailable.
    }

    let vitals = null;
    let vitalsError = null;
    try {
      vitals = await this.getSystemVitals();
    } catch (error) {
      vitalsError = String(error?.message || "SYSTEM_VITALS_UNAVAILABLE").slice(0, 300);
    }

    const inspected = Boolean(packageInfo || repository.detected);
    const result = {
      success: inspected,
      repo: packageInfo?.name || repository.name,
      repository,
      packageVersion: typeof packageInfo?.version === "string" ? packageInfo.version : null,
      nodeVersion: process.versions.node,
      testScriptAvailable: typeof packageInfo?.scripts?.test === "string",
      tests: {
        state: "NOT_RUN",
        reason: "This status probe reads project metadata only. It does not execute the test suite."
      },
      vitals,
      ...(packageReadError ? { packageReadError } : {}),
      ...(vitalsError ? { vitalsError } : {}),
      status: inspected ? "INSPECTION_ONLY_UNVERIFIED" : "PROJECT_METADATA_UNAVAILABLE",
      checkedAt: new Date().toISOString()
    };

    task.status = inspected ? "COMPLETED" : "FAILED";
    task.result = result;
    if (!inspected) task.error = "PROJECT_METADATA_UNAVAILABLE";
    this.executionHistory.unshift(task);
    if (this.executionHistory.length > 50) this.executionHistory.pop();

    return result;
  }

  notifyStateChange(event, payload) {
    if (typeof this.onStateChangeCallback === "function") {
      try {
        this.onStateChangeCallback({ event, ...payload });
      } catch {}
    }
  }

  /**
   * Executes an authorized remote command received from the central ULTRON brain.
   * Strictly enforces allowlists; unrestricted terminal/shell is denied.
   */
  createManagedTask(taskId, action, payload = {}) {
    const abortController = new AbortController();
    const taskRecord = {
      id: taskId,
      action,
      payload,
      abortController,
      childProcess: null,
      status: "running",
      output: [],
      startedAt: new Date().toISOString(),
      stoppedAt: null
    };
    this.activeTasks.set(taskId, taskRecord);
    this.activeTask = taskId;
    return taskRecord;
  }

  async executeCommand(action, payload = {}) {
    const cleanAction = String(action || "").toLowerCase().trim();
    const startTime = Date.now();
    const taskId = payload.taskId || "task_" + crypto.randomUUID();
    const isMetaAction = ["inspect_task", "status", "get_system_vitals", "get_task_output", "stop_task", "emergency_stop"].includes(cleanAction);
    const managedTask = isMetaAction ? null : this.createManagedTask(taskId, cleanAction, payload);

    try {
      let result = null;

      switch (cleanAction) {
        case "launch_app": {
          const app = String(payload.app || payload.appKey || payload.name || "").toLowerCase().trim();
          result = await this.computerControl.launchApplication(app);
          break;
        }

        case "close_app": {
          const app = String(payload.app || payload.appKey || payload.name || "").toLowerCase().trim();
          result = await windowsAutomation.closeApprovedApp(app);
          break;
        }

        case "lock_workstation":
        case "screen_lock": {
          result = await this.lockScreen();
          break;
        }

        case "unlock_workstation":
        case "screen_unlock": {
          result = await this.unlockScreen();
          break;
        }

        case "set_volume": {
          const volAction = payload.action || "volume_up";
          const volVal = payload.value !== undefined ? payload.value : null;
          result = await windowsAutomation.setSystemVolume(volAction, volVal);
          break;
        }

        case "screen_capture":
        case "capture_desktop_screenshot": {
          result = await windowsAutomation.captureScreen(payload.prefix || "remote_capture");
          break;
        }

        case "get_system_vitals":
        case "status": {
          result = await this.getSystemVitals();
          break;
        }

        case "sandboxed_file_list": {
          result = await this.computerControl.listFiles(payload.subDir || "");
          break;
        }

        case "sandboxed_file_read": {
          result = await this.computerControl.readFile(payload.relativePath || "");
          break;
        }

        case "open_folder": {
          result = await this.computerControl.listFiles(payload.folder || payload.subDir || "");
          break;
        }

        case "find_file": {
          const rawQuery = String(payload.query || payload.fileName || payload.name || "").trim();
          if (!rawQuery || rawQuery.length > 128) {
            result = {
              success: false,
              error: "FILE_QUERY_REQUIRED",
              message: "Provide a file name or search term of at most 128 characters."
            };
            break;
          }
          const query = rawQuery.toLowerCase();
          const listing = await this.computerControl.listFiles(payload.subDir || payload.folder || "");
          if (!Array.isArray(listing)) {
            result = {
              success: false,
              error: "FILE_LIST_UNAVAILABLE",
              message: "The ULTRON workspace did not return a valid directory listing."
            };
            break;
          }
          const matches = listing
            .filter(entry => entry && entry.isFile === true && typeof entry.name === "string")
            .filter(entry => entry.name.toLowerCase().includes(query))
            .slice(0, 100)
            .map(entry => entry.name);
          result = { success: true, query: rawQuery, matches, totalMatches: matches.length };
          break;
        }

        case "inspect_task": {
          const current = this.activeTask ? this.activeTasks.get(this.activeTask) : null;
          const running = Array.from(this.activeTasks.values()).filter(t => t.status === "running").map(t => ({ id: t.id, action: t.action, startedAt: t.startedAt }));
          result = {
            success: true,
            activeTask: current ? { id: current.id, action: current.action, status: current.status, startedAt: current.startedAt } : null,
            runningTasks: running,
            runningCount: running.length,
            history: this.executionHistory.slice(0, 10),
            isEmergencyStopped: this.computerControl.isEmergencyStopped()
          };
          break;
        }

        case "stop_task": {
          const targetId = payload.taskId || this.activeTask;
          const taskToStop = this.activeTasks.get(targetId);
          if (taskToStop && taskToStop.status === "running") {
            taskToStop.abortController.abort();
            if (taskToStop.childProcess && typeof taskToStop.childProcess.kill === "function") {
              try { taskToStop.childProcess.kill("SIGTERM"); } catch {}
            }
            taskToStop.status = "aborted";
            taskToStop.stoppedAt = new Date().toISOString();
            if (this.activeTask === targetId) this.activeTask = null;
            result = { success: true, stoppedTaskId: targetId, status: "aborted", stoppedAt: taskToStop.stoppedAt };
          } else if (taskToStop) {
            result = { success: true, stoppedTaskId: targetId, status: taskToStop.status, message: "Task was already stopped." };
          } else {
            result = { success: false, error: "TASK_NOT_FOUND", taskId: targetId, message: "No active task found matching ID." };
          }
          break;
        }

        case "get_task_output": {
          const queryId = String(payload.taskId || this.activeTask || "").trim();
          const task = queryId ? this.activeTasks.get(queryId) : null;
          const matched = queryId
            ? this.executionHistory.find(h => h.taskId === queryId || h.result?.taskId === queryId)
            : null;
          const status = task?.status || (matched ? "completed" : "not_found");
          if (status === "not_found") {
            result = { success: false, error: "TASK_NOT_FOUND", taskId: queryId || null };
          } else {
            result = {
              success: true,
              taskId: queryId,
              status,
              output: task?.output ?? matched?.result ?? null
            };
          }
          break;
        }

        case "emergency_stop": {
          this.computerControl.setEmergencyStop(true);
          await this.lockScreen();
          const abortedIds = [];
          for (const [id, t] of this.activeTasks.entries()) {
            if (t.status === "running") {
              t.abortController.abort();
              if (t.childProcess && typeof t.childProcess.kill === "function") {
                try { t.childProcess.kill("SIGKILL"); } catch {}
              }
              t.status = "emergency_stopped";
              t.stoppedAt = new Date().toISOString();
              abortedIds.push(id);
            }
          }
          this.activeTask = null;
          result = { success: true, status: "EMERGENCY_STOP_ENGAGED", abortedTasks: abortedIds, timestamp: new Date().toISOString() };
          break;
        }

        default: {
          throw new Error(`Command '${action}' is not authorized on Windows Desktop Companion.`);
        }
      }

      const operationSucceeded = Boolean(
        result !== null &&
        result !== undefined &&
        !(typeof result === "object" && result.success === false)
      );
      if (managedTask && managedTask.status === "running") {
        managedTask.status = operationSucceeded ? "completed" : "failed";
        managedTask.completedAt = new Date().toISOString();
        managedTask.output.push(result);
      }
      if (this.activeTask === taskId) {
        this.activeTask = null;
      }

      const outcome = {
        success: operationSucceeded,
        taskId,
        action: cleanAction,
        result,
        ...(operationSucceeded ? {} : { error: result?.error || "COMMAND_FAILED" }),
        executionTimeMs: Date.now() - startTime,
        executedAt: new Date().toISOString()
      };

      this.executionHistory.unshift(outcome);
      if (this.executionHistory.length > 100) this.executionHistory.pop();
      return outcome;
    } catch (err) {
      if (managedTask) {
        managedTask.status = managedTask.abortController.signal.aborted ? "aborted" : "failed";
        managedTask.completedAt = new Date().toISOString();
        managedTask.error = String(err?.message || "COMMAND_FAILED").slice(0, 500);
      }
      if (this.activeTask === taskId) this.activeTask = null;
      const errorOutcome = {
        success: false,
        taskId,
        action: cleanAction,
        error: err.message,
        executionTimeMs: Date.now() - startTime,
        failedAt: new Date().toISOString()
      };

      this.executionHistory.unshift(errorOutcome);
      if (this.executionHistory.length > 100) this.executionHistory.pop();
      return errorOutcome;
    }
  }

  /**
   * Starts autonomous command execution worker polling for remote commands.
   */
  startCommandWorker({ intervalMs = 2000, deviceHub = null } = {}) {
    if (this.workerRunning) return;
    this.workerRunning = true;
    const hub = deviceHub || this.deviceHub;

    // Heartbeat loop every 20 seconds
    const sendHeartbeat = async () => {
      if (!this.workerRunning) return;
      try {
        const vitals = await this.getSystemVitals();
        if (hub && this.registered && this.authToken) {
          hub.heartbeat(this.deviceId, this.authToken, {
            batteryPercent: vitals.battery?.percent,
            isCharging: vitals.battery?.isCharging,
            vitals
          });
        }
      } catch {}
    };

    // Command poll loop
    const pollAndExecute = async () => {
      if (!this.workerRunning) return;
      try {
        if (hub && this.registered && this.authToken) {
          const pending = hub.pollPendingCommands(this.deviceId, this.authToken);
          if (pending?.success && Array.isArray(pending.commands)) {
            for (const cmd of pending.commands) {
              const execResult = await this.executeCommand(cmd.action, cmd.payload);
              hub.completeCommand(this.deviceId, cmd.id, this.authToken, execResult);
            }
          }
        }
      } catch {}
    };

    sendHeartbeat();
    this.heartbeatTimer = setInterval(sendHeartbeat, 20_000);
    this.workerTimer = setInterval(pollAndExecute, intervalMs);
  }

  /**
   * Stops autonomous command execution worker cleanly.
   */
  stopCommandWorker() {
    this.workerRunning = false;
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const dev = this.deviceHub?.pairedDevices?.get(this.deviceId);
    if (dev) {
      dev.online = false;
      dev.lastSeenAt = new Date().toISOString();
    }
  }

}

export const windowsDesktopAgent = new WindowsDesktopAgent();
