/**
 * ULTRON AI — Autonomous Mobile Task Agent
 * Module: agents/mobile-task-agent.js
 *
 * Implements autonomous mobile device control, high-level goal decomposition,
 * multi-step mobile execution DAGs, screen perception integration (UltronVision),
 * permission enforcement, step assertions, and rollback capabilities.
 */

import { mobileControlEngine as defaultMobileEngine } from "../mobile/mobile-control-engine.js";
import { ultronVision as defaultUltronVision } from "../vision/ultron-vision.js";

export const MOBILE_AGENT_METADATA = {
  id: "mobile-device-agent",
  name: "MOBILE TASK AGENT",
  role: "Native Mobile Device Automation & Hardware Bridge",
  responsibility: "Android device discovery, screen perception, UI automation, app lifecycle, and secure mobile workflows via Mobile MCP and ADB.",
  capabilities: [
    "mobile_device_discovery",
    "mobile_screen_perception",
    "mobile_ui_interaction",
    "mobile_app_orchestration",
    "mobile_workflow_automation",
    "mobile_security_guard"
  ],
  allowedTools: [
    "mobile_device_discovery",
    "mobile_screen_inspection",
    "mobile_interaction_dispatch",
    "mobile_app_lifecycle",
    "mobile_autonomous_task"
  ],
  maxConcurrency: 2,
  autonomyLevelThreshold: 2,
  retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
  executionBoundaries: { timeoutMs: 60000, maxPayloadBytes: 2097152 },
  inputSchema: {
    type: "object",
    required: ["goal"],
    properties: {
      goal: { type: "string" },
      deviceId: { type: "string" },
      options: { type: "object" }
    }
  },
  outputSchema: {
    type: "object",
    required: ["success", "agent", "summary"],
    properties: {
      success: { type: "boolean" },
      agent: { type: "string" },
      summary: { type: "string" },
      planId: { type: "string" },
      stepsExecuted: { type: "number" }
    }
  }
};

export class MobileTaskAgent {
  constructor(options = {}) {
    this.controlEngine = options.controlEngine || defaultMobileEngine;
    this.visionEngine = options.visionEngine || defaultUltronVision;
    this.researchEngine = options.researchEngine || null;
    this.securitySentinel = options.securitySentinel || null;
    this.logger = options.logger || console;
    this.metadata = MOBILE_AGENT_METADATA;
    this.activeExecutions = new Map();
  }

  /**
   * Translates high-level natural language user goals into multi-step mobile execution DAGs.
   * Example goals:
   *  - "Open YouTube on my phone and search for quantum computing"
   *  - "Take a screenshot of my phone and analyze what's on screen"
   *  - "Check notifications on my connected Android device"
   *  - "Open Settings on phone and check Wi-Fi status"
   *  - "List all apps installed on my phone"
   */
  async executeGoal(goalText, options = {}) {
    const startTime = Date.now();
    const executionId = "mobile-exec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const userId = typeof options.userId === "string" ? options.userId.trim() : "";
    if (!userId) {
      return {
        success: false,
        executionId,
        agent: this.metadata.id,
        error: "AUTHENTICATED_USER_REQUIRED",
        message: "Sign in before ULTRON can inspect or control a paired mobile device.",
        elapsedMs: Date.now() - startTime
      };
    }

    try {
      // 1. Device Discovery & Health Check
      const discovery = await this.controlEngine.discoverDevices();
      const devices = Array.isArray(discovery) ? discovery : (discovery.devices || []);
      const count = devices.length;
      const isConnected = devices.some(d => d.ready) || discovery.connected;

      if (!isConnected || count === 0) {
        return {
          success: false,
          executionId,
          agent: this.metadata.id,
          error: "NO_DEVICES_CONNECTED",
          message: "No connected Android devices detected. Please attach a device via USB (with USB Debugging enabled) or connect wirelessly via ADB.",
          deviceCount: 0,
          elapsedMs: Date.now() - startTime
        };
      }

      const targetDeviceId = options.deviceId || discovery.activeDeviceId || devices[0]?.id;
      const device = devices.find(d => d.id === targetDeviceId) || devices[0];

      // 2. Goal Decomposition into Execution Plan
      const plan = await this.controlEngine.planner.planFromIntent(goalText, {
        deviceId: targetDeviceId,
        ...options
      });

      // 3. Security Pre-Screening: pass each step through permission checks
      for (const step of plan.steps) {
        const permCheck = this.controlEngine.permissionEngine.checkAction(step.action, {
          package: step.params?.package || step.params?.packageName,
          url: step.params?.url,
          autonomyLevel: options.autonomyLevel ?? 2
        });

        if (!permCheck.allowed && !permCheck.requiresConfirmation) {
          return {
            success: false,
            executionId,
            agent: this.metadata.id,
            error: "SECURITY_GATE_REJECTED",
            reason: permCheck.reason,
            blockedStep: step.id,
            elapsedMs: Date.now() - startTime
          };
        }

        if (permCheck.requiresConfirmation && !options.confirmationToken) {
          const pendingParams = { ...step.params, device: targetDeviceId };
          const token = this.controlEngine.permissionEngine.requestConfirmation(
            step.action,
            pendingParams,
            `Mobile Task Agent: ${step.description}`,
            userId
          );
          return {
            success: false,
            executionId,
            agent: this.metadata.id,
            requiresConfirmation: true,
            confirmationToken: token.token,
            expiresAt: token.expiresAt,
            pendingAction: step.action,
            pendingParams,
            message: `Level ${permCheck.level} action requires your confirmation: ${step.description}. Confirm this step, then submit the task again to continue the remaining workflow.`,
            blockedStep: step.id
          };
        }
      }

      // 4. Special Case Handling: Visual Screen Perception
      const isPerceptionTask = /\b(analyze|look|inspect|what's on screen|see|read screen)\b/i.test(goalText);
      let visualPerception = null;

      if (isPerceptionTask) {
        // Take screenshot
        const screenshotRes = await this.controlEngine.captureScreen(targetDeviceId, {}, { userId });
        if (screenshotRes.success && screenshotRes.data) {
          const dataUrl = screenshotRes.data.startsWith("data:")
            ? screenshotRes.data
            : `data:image/png;base64,${screenshotRes.data}`;

          // Invoke vision perception
          try {
            if (this.visionEngine && typeof this.visionEngine.understandImage === "function") {
              const visionPrompt = options.visionPrompt || `Analyze this Android mobile screen for the task: "${goalText}". List key visible UI elements, text, and active application state.`;
              visualPerception = await this.visionEngine.understandImage(dataUrl, visionPrompt);
            }
          } catch (visionErr) {
            visualPerception = {
              note: "Vision analyzer bypassed or standby",
              error: visionErr.message
            };
          }
        }
      }

      // 5. Execute Plan via Control Engine
      const workflowResult = await this.controlEngine.executeWorkflow(plan, {
        deviceId: targetDeviceId,
        confirmationToken: options.confirmationToken,
        userId
      });

      // 6. Post-Step Assertion & JARVIS Summary Generation
      const jarvisSummary = this.synthesizeJarvisResponse(goalText, device, workflowResult, visualPerception);

      return {
        success: workflowResult.success,
        executionId,
        agent: this.metadata.id,
        planId: plan.id,
        deviceId: targetDeviceId,
        deviceModel: device.model || "Android Device",
        stepsExecuted: workflowResult.completedSteps?.length || 0,
        summary: jarvisSummary,
        workflow: workflowResult,
        visualPerception,
        elapsedMs: Date.now() - startTime
      };
    } catch (err) {
      return {
        success: false,
        executionId,
        agent: this.metadata.id,
        error: "EXECUTION_EXCEPTION",
        message: err.message,
        elapsedMs: Date.now() - startTime
      };
    }
  }

  /**
   * Dispatches a single verified mobile action with immediate return.
   */
  async executeAction(action, params = {}, options = {}) {
    const discovery = await this.controlEngine.discoverDevices();
    if (!discovery.connected || discovery.count === 0) {
      return {
        success: false,
        error: "NO_DEVICES_CONNECTED",
        message: "No Android devices connected to ULTRON."
      };
    }

    const deviceId = options.deviceId || discovery.activeDeviceId || discovery.devices[0].id;
    const userId = typeof options.userId === "string" ? options.userId.trim() : "";
    if (!userId) return { success: false, code: "AUTHENTICATED_USER_REQUIRED", error: "An authenticated user identity is required." };
    return this.controlEngine.executeAction(action, { ...params, device: deviceId }, { ...options, userId });
  }

  /**
   * Retrieves active mobile device status.
   */
  async getStatus() {
    return this.controlEngine.getStatus();
  }

  /**
   * Synthesizes natural human-like JARVIS voice & text briefing from mobile actions.
   */
  synthesizeJarvisResponse(goalText, device, workflowResult, visualPerception) {
    const devName = device.model ? `${device.model} (${device.id})` : device.id;
    if (!workflowResult.success) {
      return `Sir, the mobile task "${goalText}" on ${devName} encountered an obstruction at step: ${workflowResult.error || "unknown"}.`;
    }

    const stepCount = workflowResult.completedSteps?.length || 0;
    let summary = `Mobile task completed on ${devName}. Successfully executed ${stepCount} operational stage${stepCount === 1 ? "" : "s"}.`;

    if (visualPerception && visualPerception.description) {
      summary += ` Screen perception analysis: ${visualPerception.description}`;
    }

    return summary;
  }
}

export const mobileTaskAgent = new MobileTaskAgent();
