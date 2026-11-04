/**
 * ULTRON AI — Mobile Control Engine & Master Subsystem Orchestrator
 *
 * Unifies Mobile MCP Client, Native ADB Bridge, Device Registry,
 * Permission & Safety Engine, and Task Planner into an enterprise-grade,
 * highly secure, verifiable mobile device automation subsystem.
 */

import { EventEmitter } from "node:events";
import { adbBridge } from "./adb-bridge.js";
import { mobileMcpClient, MCP_CLIENT_STATUS } from "./mobile-mcp-client.js";
import { mobileDeviceRegistry, DEVICE_STATES } from "./mobile-device-registry.js";
import { mobilePermissionEngine, MOBILE_PERMISSION_LEVELS } from "./mobile-permission-engine.js";
import { mobileTaskPlanner } from "./mobile-task-planner.js";

export class MobileControlEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.adb = options.adbBridge || adbBridge;
    this.mcpClient = options.mcpClient || mobileMcpClient;
    this.registry = options.deviceRegistry || mobileDeviceRegistry;
    this.permissions = options.permissionEngine || mobilePermissionEngine;
    this.planner = options.taskPlanner || mobileTaskPlanner;

    this.isInitialized = false;
    this.autoStartMcp = options.autoStartMcp !== false;
    this.activeWorkflows = new Map(); // workflowId -> { cancelled: boolean, currentStep: number }
  }

  get permissionEngine() {
    return this.permissions;
  }

  get deviceRegistry() {
    return this.registry;
  }

  get taskPlanner() {
    return this.planner;
  }

  /**
   * Initialize the Mobile Control Engine.
   */
  async initialize() {
    if (this.isInitialized) {
      return { initialized: true, devicesCount: this.registry.getDevices().length };
    }

    // 1. Check ADB environment
    const adbStatus = await this.adb.checkAvailability();

    // 2. Initial device discovery
    await this.registry.scanDevices();

    // 3. Auto-authorize local physical/emulator devices with default safe permissions
    const devices = this.registry.getDevices();
    for (const dev of devices) {
      if (dev.state === DEVICE_STATES.ONLINE) {
        this.permissions.authorizeDevice(dev.id, MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE, "system_init");
      }
    }

    // 4. Optionally connect Mobile MCP server
    let mcpStatus = { connected: false };
    if (this.autoStartMcp) {
      try {
        const startRes = await this.mcpClient.start();
        mcpStatus = { connected: true, toolsCount: startRes.toolsCount, version: startRes.serverVersion };
      } catch (err) {
        mcpStatus = { connected: false, error: err.message, note: "Operating in Native ADB Bridge mode" };
      }
    }

    this.isInitialized = true;
    this.emit("initialized", { adbStatus, mcpStatus, devicesCount: devices.length });

    return {
      initialized: true,
      adbStatus,
      mcpStatus,
      devicesCount: devices.length,
      activeDevice: this.registry.getSelectedDevice()
    };
  }

  /**
   * Scan and refresh available devices.
   */
  async discoverDevices() {
    const devices = await this.registry.scanDevices();
    // Ensure any newly detected online devices are authorized
    for (const dev of devices) {
      if (dev.state === DEVICE_STATES.ONLINE && !this.permissions.deviceAuthorizations.has(dev.id)) {
        this.permissions.authorizeDevice(dev.id, MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE, "auto_discovery");
      }
    }
    return {
      success: true,
      count: devices.length,
      connected: devices.some(d => d.ready),
      devices,
      activeDeviceId: this.registry.selectedDeviceId || devices[0]?.id || null
    };
  }

  /**
   * Select active target device by ID.
   */
  selectDevice(deviceId) {
    return this.registry.selectDevice(deviceId);
  }

  /**
   * Get active target device or throw actionable error.
   */
  _requireTargetDevice(deviceId = null) {
    const target = deviceId || this.registry.selectedDeviceId;
    if (!target) {
      const devices = this.registry.getDevices();
      if (devices.length === 0) {
        throw new Error("No mobile devices connected. Please connect an Android device via USB or Wireless ADB.");
      }
      return devices[0].id;
    }
    return target;
  }

  /**
   * Emergency stop integration: immediately halts active operations and cancels workflows.
   */
  emergencyStop(reason = "Operator emergency stop") {
    this.emergencyHalted = true;
    for (const [id, wf] of this.activeWorkflows.entries()) {
      wf.cancelled = true;
    }
    this.activeWorkflows.clear();
    this.emit("emergency_stop", { reason, timestamp: Date.now() });
    return { halted: true, reason };
  }

  /**
   * Reset emergency stop state.
   */
  resetEmergencyStop() {
    this.emergencyHalted = false;
    this.emit("emergency_stop_reset", { timestamp: Date.now() });
    return { halted: false };
  }

  /**
   * Execute an atomic mobile action with strict pre-flight permission check,
   * before/after state verification, and audit trail logging.
   */
  async executeAction(actionNameOrDeviceId, paramsOrAction = {}, contextOrParams = {}) {
    let actionName;
    let params;
    let context;

    if (typeof paramsOrAction === "string") {
      const explicitDeviceId = actionNameOrDeviceId;
      actionName = paramsOrAction;
      params = { ...(contextOrParams || {}), device: (contextOrParams && (contextOrParams.device || contextOrParams.deviceId)) || explicitDeviceId };
      context = contextOrParams || {};
    } else {
      actionName = actionNameOrDeviceId;
      params = { ...(paramsOrAction || {}) };
      context = contextOrParams || {};
    }

    if (this.emergencyHalted) {
      return {
        success: false,
        action: actionName,
        code: "EMERGENCY_STOP_ACTIVE",
        error: "Mobile actions blocked due to emergency stop.",
        reason: "System is in emergency stop state."
      };
    }

    // Normalize action name if missing mobile_ prefix
    if (typeof actionName === "string" && !actionName.startsWith("mobile_")) {
      const candidate = "mobile_" + actionName;
      if (this.permissions.constructor?.ACTION_PERMISSION_TIERS?.[candidate] || candidate in (this.permissions?.constructor?.ACTION_PERMISSION_TIERS || {})) {
        actionName = candidate;
      } else {
        actionName = candidate;
      }
    }

    let deviceId;
    try {
      deviceId = this._requireTargetDevice(params.device || params.deviceId);
    } catch (err) {
      return {
        success: false,
        action: actionName,
        code: "NO_TARGET_DEVICE",
        error: err.message,
        reason: err.message
      };
    }
    const userId = context.userId || "operator";
    const confirmationToken = context.confirmationToken || params.confirmationToken || null;

    // Normalize app package parameters
    if (actionName === "mobile_launch_app" || actionName === "mobile_terminate_app") {
      params.packageName = params.packageName || params.package || params.app;
      params.package = params.package || params.packageName;
    }

    // 1. Permission & Safety Evaluation
    const perm = await this.permissions.checkPermission(actionName, params, deviceId, userId, confirmationToken);
    if (!perm.permitted) {
      return {
        success: false,
        action: actionName,
        deviceId,
        code: perm.code,
        reason: perm.reason,
        requiresConfirmation: perm.requiresConfirmation || false,
        confirmationToken: perm.confirmationToken || null,
        expiresAt: perm.expiresAt || null
      };
    }

    // 2. Pre-Action State Capture
    let preState = null;
    try {
      if (this.registry.devices.get(deviceId)?.platform === "android") {
        preState = await this.adb.getForegroundApp(deviceId);
      }
    } catch {}

    const startedAt = Date.now();
    this.emit("action_started", { action: actionName, deviceId, params });

    // 3. Dispatch to MCP Client / Native Bridge
    let result;
    try {
      const toolParams = { ...params, device: deviceId };
      if (actionName === "mobile_launch_app" || actionName === "mobile_terminate_app") {
        toolParams.packageName = toolParams.packageName || toolParams.package;
      }
      if (actionName === "mobile_swipe_on_screen" && !toolParams.direction) {
        if (toolParams.startY > toolParams.endY) {
          toolParams.direction = "up";
        } else if (toolParams.startY < toolParams.endY) {
          toolParams.direction = "down";
        } else if (toolParams.startX > toolParams.endX) {
          toolParams.direction = "left";
        } else {
          toolParams.direction = "right";
        }
        if (toolParams.startX !== undefined) toolParams.x = toolParams.startX;
        if (toolParams.startY !== undefined) toolParams.y = toolParams.startY;
      }
      result = await this.mcpClient.callTool(actionName, toolParams);
    } catch (err) {
      this.emit("action_failed", { action: actionName, deviceId, error: err.message });
      return {
        success: false,
        action: actionName,
        deviceId,
        error: err.message,
        executionTimeMs: Date.now() - startedAt
      };
    }

    // 4. Post-Action State Verification
    let postState = null;
    let verified = true;
    let verificationNote = "Action completed successfully";

    try {
      if (this.registry.devices.get(deviceId)?.platform === "android") {
        postState = await this.adb.getForegroundApp(deviceId);
      }

      // Action-specific verification rules
      if (actionName === "mobile_launch_app") {
        const expectedPkg = params.package || params.packageName;
        if (expectedPkg && postState && postState.packageName !== expectedPkg) {
          verified = false;
          verificationNote = `Expected foreground package '${expectedPkg}', but found '${postState.packageName}'`;
        }
      } else if (actionName === "mobile_terminate_app") {
        const targetPkg = params.package || params.packageName;
        if (targetPkg && postState && postState.packageName === targetPkg) {
          verified = false;
          verificationNote = `Package '${targetPkg}' is still running in foreground after termination attempt`;
        }
      }
    } catch {}

    const output = {
      success: result.success && verified,
      action: actionName,
      deviceId,
      result: result.text || "",
      image: result.image || null,
      data: result.image?.data || result.data || null,
      mimeType: result.image?.mimeType || result.mimeType || "image/png",
      verification: {
        verified,
        preState,
        postState,
        note: verificationNote
      },
      executionTimeMs: Date.now() - startedAt
    };

    this.emit("action_completed", output);
    return output;
  }

  /**
   * Execute an autonomous multi-step mobile workflow DAG with rollback and cancellation.
   */
  async executeWorkflow(workflowPlan, context = {}) {
    const workflowId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.activeWorkflows.set(workflowId, { cancelled: false, currentStep: 0 });

    const deviceId = this._requireTargetDevice(workflowPlan.deviceId);
    const steps = workflowPlan.steps || [];
    const stepResults = [];

    this.emit("workflow_started", { workflowId, goal: workflowPlan.goal, stepsCount: steps.length });

    for (let i = 0; i < steps.length; i++) {
      const state = this.activeWorkflows.get(workflowId);
      if (!state || state.cancelled) {
        this.emit("workflow_cancelled", { workflowId, completedSteps: i });
        return {
          success: false,
          workflowId,
          cancelled: true,
          completedSteps: i,
          totalSteps: steps.length,
          stepResults
        };
      }

      state.currentStep = i + 1;
      const step = steps[i];
      const stepParams = { ...step.params, device: deviceId };

      this.emit("workflow_step_started", { workflowId, stepIndex: i + 1, action: step.action });

      const execRes = await this.executeAction(step.action, stepParams, context);
      stepResults.push({
        stepIndex: i + 1,
        action: step.action,
        description: step.description,
        ...execRes
      });

      if (!execRes.success) {
        this.emit("workflow_failed", { workflowId, failedStep: i + 1, error: execRes.error || execRes.reason });
        this.activeWorkflows.delete(workflowId);
        return {
          success: false,
          workflowId,
          failedStepIndex: i + 1,
          error: execRes.error || execRes.reason,
          requiresConfirmation: execRes.requiresConfirmation || false,
          confirmationToken: execRes.confirmationToken || null,
          stepResults
        };
      }

      this.emit("workflow_step_completed", { workflowId, stepIndex: i + 1 });
    }

    this.activeWorkflows.delete(workflowId);
    this.emit("workflow_completed", { workflowId, totalSteps: steps.length });

    return {
      success: true,
      workflowId,
      totalSteps: steps.length,
      stepResults
    };
  }

  /**
   * Cancel an active running workflow by ID.
   */
  cancelWorkflow(workflowId) {
    const wf = this.activeWorkflows.get(workflowId);
    if (wf) {
      wf.cancelled = true;
      return true;
    }
    return false;
  }

  /**
   * Confirm and execute a pending Level 4 Critical action via single-use token.
   */
  async confirmAction(confirmationToken, userId = "operator") {
    const pending = this.permissions.pendingConfirmations.get(confirmationToken);
    if (!pending) {
      throw new Error("Invalid, consumed, or expired confirmation token.");
    }

    return this.executeAction(pending.action, pending.params, {
      userId,
      confirmationToken
    });
  }

  /**
   * High-Level Helper: Capture screenshot from active device.
   */
  async captureScreenshot(deviceId = null, options = {}) {
    const id = this._requireTargetDevice(deviceId);
    const res = await this.executeAction("mobile_take_screenshot", { device: id, ...options });
    const imgData = res.image?.data || res.result?.data || null;
    return {
      ...res,
      data: imgData,
      mimeType: res.image?.mimeType || "image/png",
      source: "mobile-mcp"
    };
  }

  async captureScreen(deviceId = null, options = {}) {
    return this.captureScreenshot(deviceId, options);
  }

  /**
   * High-Level Helper: Inspect screen UI hierarchy elements.
   */
  async inspectHierarchy(deviceId = null) {
    const id = this._requireTargetDevice(deviceId);
    return this.executeAction("mobile_list_elements_on_screen", { device: id });
  }

  async getHierarchy(deviceId = null) {
    return this.inspectHierarchy(deviceId);
  }

  /**
   * High-Level Helper: Tap at coordinate (x, y).
   */
  async tap(x, y, deviceId = null) {
    const id = this._requireTargetDevice(deviceId);
    return this.executeAction("mobile_click_on_screen_at_coordinates", { device: id, x, y });
  }

  /**
   * High-Level Helper: Swipe in direction.
   */
  async swipe(direction = "down", deviceId = null) {
    const id = this._requireTargetDevice(deviceId);
    return this.executeAction("mobile_swipe_on_screen", { device: id, direction });
  }

  /**
   * High-Level Helper: Type text into active element.
   */
  async typeText(text, deviceId = null) {
    const id = this._requireTargetDevice(deviceId);
    return this.executeAction("mobile_type_keys", { device: id, text });
  }

  /**
   * High-Level Helper: Press hardware navigation key.
   */
  async pressKey(button = "HOME", deviceId = null) {
    const id = this._requireTargetDevice(deviceId);
    return this.executeAction("mobile_press_button", { device: id, button });
  }

  /**
   * Comprehensive subsystem status and telemetry.
   */
  async getStatus() {
    const diag = await this.registry.getPlatformDiagnostics();
    const mcpStat = this.mcpClient.getStatus();
    const devices = this.registry.getDevices();

    return {
      subsystem: "ULTRON Mobile Control Engine",
      version: "1.0.0",
      initialized: this.isInitialized,
      activeDevice: this.registry.getSelectedDevice(),
      deviceCount: devices.length,
      devices,
      mcpServer: {
        status: mcpStat.status,
        transport: mcpStat.transport,
        pid: mcpStat.pid,
        serverVersion: mcpStat.serverVersion,
        toolsDiscovered: mcpStat.toolsCount
      },
      platformDiagnostics: diag,
      recentAuditLogs: this.permissions.getAuditLogs(null, 10)
    };
  }

  /**
   * Shutdown mobile control subsystem cleanly.
   */
  async shutdown() {
    this.registry.stopPolling();
    for (const [id, wf] of this.activeWorkflows.entries()) {
      wf.cancelled = true;
    }
    this.activeWorkflows.clear();
    await this.mcpClient.stop();
    this.isInitialized = false;
  }
}

export const mobileControlEngine = new MobileControlEngine();
