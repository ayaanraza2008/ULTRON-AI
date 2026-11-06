/**
 * ULTRON AI — Remote Task Orchestrator
 * Project Codename: ULTRON ETERNAL
 *
 * Coordinates end-to-end task execution originating from telephone calls or mobile commands:
 * - Authenticates caller & verifies role permissions.
 * - Resolves target devices (Windows PC, Android Phone, or Broadcast).
 * - Enforces idempotency tokens to prevent duplicate task execution from network retries.
 * - Gathers real device diagnostics & results.
 * - Streams progress updates and synthesizes final voice report.
 * - Records full audit event history in Supabase / memory.
 */

import crypto from "node:crypto";

export class RemoteTaskOrchestrator {
  constructor(options = {}) {
    this.multiDeviceManager = options.multiDeviceManager || null;
    this.windowsDesktopAgent = options.windowsDesktopAgent || null;
    this.telephonyGateway = options.telephonyGateway || null;
    this.taskQueue = new Map();
    this.processedIdempotencyKeys = new Set();
    this.taskHistory = [];
    this.maxHistory = 100;
  }

  /**
   * Dispatches and tracks an end-to-end remote task initiated via voice/telephony.
   */
  async executeRemoteTask({
    callerId,
    isOwner,
    action,
    payload = {},
    idempotencyKey = null,
    onProgress = null
  }) {
    if (!isOwner) {
      return {
        success: false,
        error: "CALLER_UNAUTHORIZED",
        reason: "Caller is not authorized to dispatch remote tasks."
      };
    }

    // Idempotency check: prevent duplicate execution from carrier re-transmissions
    const idKey = idempotencyKey || `${callerId}_${action}_${JSON.stringify(payload)}`;
    if (this.processedIdempotencyKeys.has(idKey)) {
      return {
        success: true,
        duplicateSuppressed: true,
        message: "Duplicate task received within active window. Execution suppressed."
      };
    }
    this.processedIdempotencyKeys.add(idKey);
    const timer = setTimeout(() => this.processedIdempotencyKeys.delete(idKey), 30000);
    if (typeof timer.unref === "function") timer.unref();

    const taskId = "rem-task-" + crypto.randomUUID();
    const taskRecord = {
      id: taskId,
      callerId,
      action,
      payload,
      startedAt: new Date().toISOString(),
      status: "RUNNING",
      progressSteps: [],
      result: null
    };
    this.taskQueue.set(taskId, taskRecord);

    const reportStep = (stepDescription) => {
      const step = { description: stepDescription, timestamp: new Date().toISOString() };
      taskRecord.progressSteps.push(step);
      if (typeof onProgress === "function") {
        try { onProgress(step); } catch {}
      }
    };

    try {
      reportStep(`Step 1: Authenticated caller ${callerId}. Target action: ${action}`);

      let executionResult = null;
      switch (action) {
        case "UNLOCK_PC_SCREEN": {
          reportStep("Step 2: Connecting to primary Windows PC...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.unlockScreen();
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
          }
          if (executionResult && executionResult.success !== false) {
            reportStep("Step 3: Workstation screen unlocked. Energy Core activated.");
          } else {
            reportStep("Step 3: Failed to unlock workstation: " + (executionResult?.message || executionResult?.error));
          }
          break;
        }

        case "LOCK_PC_SCREEN": {
          reportStep("Step 2: Securing primary Windows PC...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.lockScreen();
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
          }
          if (executionResult && executionResult.success !== false && executionResult.simulated === true) {
            reportStep("Step 3: Lock request simulated; no real Windows workstation was locked.");
          } else if (executionResult && executionResult.success !== false) {
            reportStep("Step 3: Windows agent confirmed the workstation lock request.");
          } else {
            reportStep("Step 3: Failed to lock workstation: " + (executionResult?.message || executionResult?.error));
          }
          break;
        }

        case "UNLOCK_MOBILE_DEVICES": {
          reportStep("Step 2: Connecting to paired Android mobile devices...");
          if (this.multiDeviceManager) {
            executionResult = await this.multiDeviceManager.unlockMobileDevices();
          } else {
            executionResult = { success: false, error: "MULTI_DEVICE_MANAGER_UNAVAILABLE", message: "Multi-device manager is not configured." };
          }
          if (executionResult && executionResult.success !== false) {
            reportStep(`Step 3: Unlocked ${executionResult.unlockedCount || 0} mobile devices.`);
          } else {
            reportStep("Step 3: Failed to unlock mobile devices: " + (executionResult?.message || executionResult?.error));
          }
          break;
        }

        case "PLAY_MEDIA_ALL_DEVICES": {
          reportStep("Step 2: Dispatching media playback to all connected devices...");
          if (this.multiDeviceManager) {
            executionResult = await this.multiDeviceManager.playMediaAcrossDevices(payload);
          } else {
            executionResult = { success: false, error: "MULTI_DEVICE_MANAGER_UNAVAILABLE", message: "Multi-device manager is not configured." };
          }
          if (executionResult && executionResult.success !== false) {
            reportStep("Step 3: Favorite song launched across all devices.");
          } else {
            reportStep("Step 3: Failed to launch media: " + (executionResult?.message || executionResult?.error));
          }
          break;
        }

        case "CHECK_STORAGE_AND_RUNNABILITY": {
          reportStep("Step 2: Querying Windows PC storage and hardware headroom...");
          if (this.windowsDesktopAgent) {
            const vitals = await this.windowsDesktopAgent.getSystemVitals();
            const storageAvailableGb = Number(vitals?.storageAvailableGb);
            const storageCheckAvailable = Number.isFinite(storageAvailableGb) && storageAvailableGb >= 0;
            const canRun = storageCheckAvailable ? storageAvailableGb > 10 : null;
            executionResult = {
              success: true,
              storageAvailableGb: storageCheckAvailable ? storageAvailableGb : null,
              ramUsedPercent: vitals?.ramUsedPercent,
              storageCheckAvailable,
              canRun,
              verdict: canRun === true
                ? `Free storage (${storageAvailableGb} GB) exceeds the 10 GB threshold; other run prerequisites remain unverified.`
                : canRun === false
                  ? `Free storage (${storageAvailableGb} GB) is below the 10 GB threshold.`
                  : "Free storage could not be measured; PC runnability remains unverified."
            };
            reportStep(canRun === true
              ? "Step 3: Storage exceeds the configured minimum; other prerequisites remain unverified."
              : canRun === false
                ? "Step 3: Storage is below the configured minimum; the PC is not reported as runnable."
                : "Step 3: Free storage could not be measured; PC runnability remains unverified.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: Storage check failed: Windows companion unavailable.");
          }
          break;
        }

        case "CHECK_PROJECT_TESTS": {
          reportStep("Step 2: Inspecting repository metadata; this operation does not run the test suite.");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.checkProjectStatus();
            reportStep(executionResult?.success === false
              ? "Step 3: Project inspection failed: " + (executionResult?.error || executionResult?.message || "metadata unavailable")
              : "Step 3: Repository metadata inspected. Automated tests were NOT_RUN; no test-health verdict is asserted.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: Project test inspection failed: Windows companion unavailable.");
          }
          break;
        }

        case "LAUNCH_PC_APP": {
          reportStep("Step 2: Launching application on Windows PC...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.executeCommand("launch_app", payload);
            reportStep(executionResult?.success === false
              ? "Step 3: Application launch failed: " + (executionResult?.message || executionResult?.error || "unknown error")
              : "Step 3: Application launch confirmed by the Windows agent.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: App launch failed: Windows companion unavailable.");
          }
          break;
        }

        case "OPEN_PC_FOLDER": {
          reportStep("Step 2: Accessing PC directory...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.executeCommand("open_folder", payload);
            reportStep(executionResult?.success === false
              ? "Step 3: Directory query failed: " + (executionResult?.message || executionResult?.error || "unknown error")
              : "Step 3: Directory query completed on the Windows agent.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: Directory query failed: Windows companion unavailable.");
          }
          break;
        }

        case "FIND_PC_FILE": {
          reportStep("Step 2: Searching PC filesystem for file...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.executeCommand("find_file", payload);
            reportStep(executionResult?.success === false
              ? "Step 3: File search failed: " + (executionResult?.message || executionResult?.error || "unknown error")
              : "Step 3: File search completed on the Windows agent.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: File search failed: Windows companion unavailable.");
          }
          break;
        }

        case "GET_PC_VITALS": {
          reportStep("Step 2: Gathering PC hardware vitals...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.getSystemVitals();
            reportStep("Step 3: PC hardware vitals collected.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: Vitals query failed: Windows companion unavailable.");
          }
          break;
        }

        case "INSPECT_RUNNING_TASK": {
          reportStep("Step 2: Inspecting active task on Windows PC...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.executeCommand("inspect_task", payload);
            reportStep(executionResult?.success === false
              ? "Step 3: Task inspection failed: " + (executionResult?.message || executionResult?.error || "unknown error")
              : "Step 3: Task inspection completed on the Windows agent.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered." };
            reportStep("Step 3: Task inspection failed: Windows companion unavailable.");
          }
          break;
        }

        case "EMERGENCY_STOP": {
          reportStep("Step 2: Transmitting EMERGENCY STOP directive to Windows PC and fleet...");
          if (this.windowsDesktopAgent) {
            executionResult = await this.windowsDesktopAgent.executeCommand("emergency_stop", payload);
            reportStep(executionResult?.success === false
              ? "Step 3: Emergency stop command failed: " + (executionResult?.message || executionResult?.error || "unknown error")
              : "Step 3: Emergency stop command acknowledged by the Windows agent.");
          } else {
            executionResult = { success: false, error: "WINDOWS_AGENT_UNAVAILABLE", message: "Windows desktop companion is not connected or registered. Emergency stop could not be delivered to PC." };
            reportStep("Step 3: Emergency stop failed: Windows companion unavailable.");
          }
          break;
        }

        default: {
          executionResult = { success: false, error: "UNKNOWN_ACTION", message: `Action '${action}' is not supported.` };
          reportStep(`Step 2: Action '${action}' rejected as unsupported.`);
          break;
        }
      }

      const isSuccess = Boolean(executionResult && executionResult.success !== false);
      taskRecord.status = isSuccess ? "COMPLETED" : "FAILED";
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.result = executionResult;
      if (!isSuccess) {
        taskRecord.error = executionResult?.error || "TASK_FAILED";
      }

      this.taskHistory.unshift(taskRecord);
      if (this.taskHistory.length > this.maxHistory) this.taskHistory.pop();
      this.taskQueue.delete(taskId);

      return {
        success: isSuccess,
        taskId,
        action,
        progressSteps: taskRecord.progressSteps,
        result: executionResult,
        ...(isSuccess ? {} : { error: executionResult?.error || "TASK_FAILED", message: executionResult?.message || "Task failed" })
      };
    } catch (err) {
      taskRecord.status = "FAILED";
      taskRecord.error = err.message;
      this.taskQueue.delete(taskId);
      return { success: false, taskId, error: err.message };
    }
  }

  getTaskHistory(limit = 20) {
    return this.taskHistory.slice(0, limit);
  }
}

export const remoteTaskOrchestrator = new RemoteTaskOrchestrator();
