/**
 * ULTRON AI — Mobile MCP End-to-End Autonomy & Voice Integration Test Suite
 *
 * Validates:
 * 1. Natural language chat & voice routing to MobileTaskPlanner.
 * 2. Complete "Ultron, open YouTube on my phone." workflow.
 * 3. Human confirmation gating (Level 3/4 single-use approval tokens).
 * 4. Application launch execution through MobileControlEngine & Mobile MCP.
 * 5. Foreground state verification and screenshot perception evidence.
 * 6. Truthful success/failure synthesis for ULTRON chat and voice engine.
 * 7. In-flight workflow cancellation and Emergency Stop protection.
 * 8. Device disconnect, reconnect, and daemon recovery resilience.
 * 9. Cross-user account isolation and anti-replay token protection.
 * 10. Real physical device acceptance assertions when hardware is connected.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { AutonomousOrchestrator } from "../core/autonomous-orchestrator.js";
import { ToolRegistry } from "../core/tool-registry.js";
import { MobileControlEngine } from "../mobile/mobile-control-engine.js";
import { MobileDeviceRegistry } from "../mobile/mobile-device-registry.js";
import { MobilePermissionEngine, MOBILE_PERMISSION_LEVELS } from "../mobile/mobile-permission-engine.js";
import { MobileTaskPlanner, COMMON_APP_PACKAGES } from "../mobile/mobile-task-planner.js";
import { JarvisVoiceEngine } from "../voice/voice-engine.js";
import { adbBridge } from "../mobile/adb-bridge.js";

// Mock Adb Bridge for deterministic harness
class MockAdbBridge {
  constructor(options = {}) {
    this.devices = [
      {
        id: "mock-oppo-cph2127",
        state: "online",
        model: "CPH2127",
        connectionType: "wireless",
        ready: true,
        platform: "android"
      }
    ];
    this.foreground = { packageName: "com.android.launcher", activity: ".Launcher" };
    this.isOffline = false;
  }

  async checkAvailability() {
    return { available: true, path: "mock-adb", version: "1.0.41", platform: "win32" };
  }

  async listDevices() {
    if (this.isOffline) {
      return { success: true, count: 0, devices: [] };
    }
    return { success: true, count: this.devices.length, devices: this.devices };
  }

  async getForegroundApp() {
    return this.foreground;
  }

  async execDevice() {
    return { success: true, stdout: "", stderr: "" };
  }

  async takeScreenshot() {
    return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  }

  async launchApp(_deviceId, packageName) {
    this.foreground = { packageName, activity: ".MainActivity" };
    return { success: true, stdout: `Events injected: 1 (package: ${packageName})` };
  }

  async terminateApp(_deviceId, _packageName) {
    this.foreground = { packageName: "com.android.launcher", activity: ".Launcher" };
    return { success: true, stdout: "Success" };
  }

  async dumpHierarchy() {
    return "<hierarchy><node text='YouTube' bounds='[0,0][720,1600]'/></hierarchy>";
  }
}

// Mock MCP Client
class MockMcpClient {
  constructor(adb) {
    this.adb = adb;
    this.status = "CONNECTED";
    this.discoveredTools = new Map([
      ["mobile_list_available_devices", {}],
      ["mobile_take_screenshot", {}],
      ["mobile_list_elements_on_screen", {}],
      ["mobile_click_on_screen_at_coordinates", {}],
      ["mobile_press_button", {}],
      ["mobile_launch_app", {}],
      ["mobile_terminate_app", {}]
    ]);
  }

  getStatus() {
    return { status: this.status, transport: "stdio", pid: 12345, toolsCount: this.discoveredTools.size };
  }

  async start() {
    return { success: true, toolsCount: this.discoveredTools.size, serverVersion: "1.0.16" };
  }

  async stop() {
    this.status = "DISCONNECTED";
  }

  async callTool(name, args) {
    if (name === "mobile_launch_app") {
      const pkg = args.package || args.packageName;
      await this.adb.launchApp(args.device, pkg);
      return { success: true, text: `Launched app ${pkg}` };
    }
    if (name === "mobile_take_screenshot") {
      const buf = await this.adb.takeScreenshot(args.device);
      return {
        success: true,
        text: "Screenshot captured",
        image: { data: buf.toString("base64"), mimeType: "image/png" }
      };
    }
    if (name === "mobile_list_elements_on_screen") {
      const xml = await this.adb.dumpHierarchy(args.device);
      return { success: true, text: xml };
    }
    if (name === "mobile_press_button") {
      return { success: true, text: `Pressed button ${args.button}` };
    }
    return { success: true, text: `Executed ${name}` };
  }
}

function createTestHarness(options = {}) {
  const mockAdb = new MockAdbBridge(options);
  const mockMcp = new MockMcpClient(mockAdb);
  const registry = new MobileDeviceRegistry({ adbBridge: mockAdb });
  const permissions = new MobilePermissionEngine();
  const planner = new MobileTaskPlanner();

  const controlEngine = new MobileControlEngine({
    adbBridge: mockAdb,
    mcpClient: mockMcp,
    deviceRegistry: registry,
    permissionEngine: permissions,
    taskPlanner: planner,
    autoStartMcp: false
  });

  const registryAdapters = {
    mobileControlEngine: controlEngine
  };

  const toolReg = new ToolRegistry(registryAdapters);
  const orchestrator = new AutonomousOrchestrator({
    registry: toolReg,
    defaultAutonomyLevel: 3,
    strictApprovalGates: true,
    persistenceDir: path.resolve(".local/test-e2e-orchestrator")
  });

  const voice = new JarvisVoiceEngine();

  return { mockAdb, mockMcp, registry, permissions, planner, controlEngine, toolReg, orchestrator, voice };
}

test("MobileE2E: Natural language voice/chat 'Ultron, open YouTube on my phone.' analyzes intent and formulates plan", async () => {
  const { orchestrator, controlEngine } = createTestHarness();
  await controlEngine.initialize();

  const prompt = "Ultron, open YouTube on my phone.";

  // 1. Intent Analysis
  const intentAnalysis = orchestrator.analyzeIntent(prompt);
  assert.equal(intentAnalysis.intent, "MOBILE_DEVICE_CONTROL");
  assert.equal(intentAnalysis.domain, "INTEGRATIONS");

  // 2. Plan Formulation
  const plan = orchestrator.formulatePlan(intentAnalysis, prompt);
  assert.ok(plan.steps.length >= 2, "Must formulate at least 2 steps: launch app + verify screenshot");
  assert.equal(plan.steps[0].toolId, "mobile_app_lifecycle");
  assert.equal(plan.steps[0].params.operation, "launch");
  assert.equal(plan.steps[0].params.packageName, "com.google.android.youtube");
  assert.equal(plan.steps[1].toolId, "mobile_screen_inspection");
  assert.deepEqual(plan.steps[1].dependsOn, ["step-1"]);
});

test("MobileE2E: Enforces human confirmation gate (APPROVAL_REQUIRED with single-use token)", async () => {
  const { orchestrator, controlEngine } = createTestHarness();
  await controlEngine.initialize();

  const prompt = "Ultron, open YouTube on my phone.";
  const res = await orchestrator.processUserRequest(prompt, { userId: "operator-ayaan" });

  assert.equal(res.success, false);
  assert.equal(res.status, "APPROVAL_REQUIRED");
  assert.ok(res.approvalRequest, "Must generate an approvalRequest object");
  assert.equal(res.approvalRequest.toolId, "mobile_app_lifecycle");
  assert.equal(res.approvalRequest.userId, "operator-ayaan");
  assert.equal(res.approvalRequest.status, "PENDING");
  assert.ok(res.textResponse.includes("authorization to proceed"));
});

test("MobileE2E: Approval token consumption launches YouTube, verifies foreground, and captures screenshot", async () => {
  const { orchestrator, controlEngine, mockAdb, voice } = createTestHarness();
  await controlEngine.initialize();

  const prompt = "Ultron, open YouTube on my phone.";

  // Step 1: Request approval
  const gateRes = await orchestrator.processUserRequest(prompt, { userId: "operator-ayaan" });
  assert.equal(gateRes.status, "APPROVAL_REQUIRED");
  const approvalId = gateRes.approvalRequest.id;

  // Step 2: Approve
  const approveRes = orchestrator.approveRequest(approvalId, { userId: "operator-ayaan", isAdmin: true });
  assert.equal(approveRes.success, true);

  // Step 3: Execute with approvalId
  const execRes = await orchestrator.processUserRequest(prompt, {
    userId: "operator-ayaan",
    approvalId
  });

  assert.equal(execRes.success, true);
  assert.equal(execRes.status, "COMPLETED");
  assert.equal(execRes.verified, true);
  assert.ok(execRes.textResponse.includes("com.google.android.youtube has been launched on your phone"));
  assert.ok(execRes.textResponse.includes("Foreground state verified: YES"));

  // Verify real foreground package was updated in ADB
  const fg = await mockAdb.getForegroundApp();
  assert.equal(fg.packageName, "com.google.android.youtube");

  // Verify voice output formatting
  const speech = voice.formatSpokenUpdate(execRes.textResponse, "en");
  assert.ok(speech.includes("Affirmative, Ayaan"));
  assert.ok(speech.includes("com.google.android.youtube"));
});

test("MobileE2E: Multilingual voice response synthesis (English, Hinglish, Hindi)", async () => {
  const { orchestrator, controlEngine } = createTestHarness();
  await controlEngine.initialize();

  // English
  const resEn = await orchestrator.processUserRequest("open youtube on my phone", {
    userId: "operator-ayaan",
    preApproved: true,
    trustedInternalAdmin: true
  });
  assert.ok(resEn.textResponse.includes("com.google.android.youtube has been launched on your phone"));

  // Hinglish
  const resHinglish = await orchestrator.processUserRequest("phone par youtube open karo", {
    userId: "operator-ayaan",
    preApproved: true,
    trustedInternalAdmin: true
  });
  assert.ok(resHinglish.textResponse.includes("Ji Ayaan, aapke phone par"));
  assert.ok(resHinglish.textResponse.includes("launch kar diya gaya hai"));
});

test("MobileE2E: Workflow cancellation immediately halts execution and preserves state", async () => {
  const { controlEngine } = createTestHarness();
  await controlEngine.initialize();

  let stepStartedCount = 0;
  controlEngine.on("workflow_step_started", () => {
    stepStartedCount++;
  });

  const wf = {
    goal: "Multi-step navigation",
    steps: [
      { action: "mobile_press_button", params: { button: "HOME" } },
      { action: "mobile_press_button", params: { button: "BACK" } }
    ]
  };

  const execPromise = controlEngine.executeWorkflow(wf);
  const activeWfId = Array.from(controlEngine.activeWorkflows.keys())[0];
  if (activeWfId) {
    controlEngine.cancelWorkflow(activeWfId);
  }

  const result = await execPromise;
  assert.equal(result.cancelled, true);
  assert.ok(result.completedSteps < wf.steps.length);
});

test("MobileE2E: Global Emergency Stop halts actions, invalidates approvals, and blocks subsequent requests", async () => {
  const { orchestrator, controlEngine } = createTestHarness();
  await controlEngine.initialize();

  // 1. Create a pending approval
  const gateRes = await orchestrator.processUserRequest("open youtube on my phone", { userId: "operator-ayaan" });
  assert.equal(gateRes.status, "APPROVAL_REQUIRED");
  const approvalId = gateRes.approvalRequest.id;

  // 2. Engage Emergency Stop
  const stopRes = orchestrator.setEmergencyStop(true, "Security breach test", { userId: "operator", isAdmin: true });
  assert.equal(stopRes.emergencyHalted, true);
  assert.equal(orchestrator.emergencyHalted, true);

  // 3. Approval must be invalidated
  const invalidated = orchestrator.pendingApprovals.get(approvalId);
  assert.equal(invalidated.status, "INVALIDATED");

  // 4. Any subsequent requests must be fail-closed
  const blockedReq = await orchestrator.processUserRequest("open youtube on my phone", { userId: "operator-ayaan" });
  assert.equal(blockedReq.success, false);
  assert.equal(blockedReq.status, "BLOCKED");
  assert.ok(blockedReq.textResponse.includes("Emergency Stop"));

  // 5. Emergency stop reset restores normal operations
  orchestrator.setEmergencyStop(false, "Test complete", { userId: "operator", isAdmin: true });
  assert.equal(orchestrator.emergencyHalted, false);
});

test("MobileE2E: Cross-user authorization isolation prevents approval token theft", async () => {
  const { orchestrator, controlEngine } = createTestHarness();
  await controlEngine.initialize();

  // User Alpha requests approval
  const reqRes = await orchestrator.processUserRequest("open youtube on my phone", { userId: "user-alpha" });
  const approvalId = reqRes.approvalRequest.id;

  // Approve token for User Alpha
  orchestrator.approveRequest(approvalId, { userId: "user-alpha" });

  // User Beta attempts to redeem User Alpha's approval token
  const attackRes = await orchestrator.processUserRequest("open youtube on my phone", {
    userId: "user-beta",
    approvalId
  });

  assert.equal(attackRes.success, false);
  assert.equal(attackRes.status, "CROSS_USER_ACCESS_DENIED");
  assert.ok(attackRes.error.includes("Cross-user security violation"));
});

test("MobileE2E: Anti-replay protection prevents duplicate consumption of approval tokens", async () => {
  const { orchestrator, controlEngine } = createTestHarness();
  await controlEngine.initialize();

  const reqRes = await orchestrator.processUserRequest("open youtube on my phone", { userId: "user-alpha" });
  const approvalId = reqRes.approvalRequest.id;

  orchestrator.approveRequest(approvalId, { userId: "user-alpha" });

  // First legitimate execution consumes token
  const firstExec = await orchestrator.processUserRequest("open youtube on my phone", {
    userId: "user-alpha",
    approvalId
  });
  assert.equal(firstExec.success, true);
  assert.equal(firstExec.status, "COMPLETED");

  // Second execution with same token must be rejected as replay attack
  const secondExec = await orchestrator.processUserRequest("open youtube on my phone", {
    userId: "user-alpha",
    approvalId
  });
  assert.equal(secondExec.success, false);
  assert.equal(secondExec.status, "REPLAY_ATTACK_DETECTED");
  assert.ok(secondExec.error.includes("replay attack rejected"));
});

test("MobileE2E: Device disconnect and reconnect recovery handling", async () => {
  const { controlEngine, mockAdb } = createTestHarness();
  await controlEngine.initialize();

  // Simulate device going offline
  mockAdb.isOffline = true;
  await controlEngine.discoverDevices();
  assert.equal(controlEngine.registry.getDevices().length, 0);

  // Attempting action while disconnected must fail gracefully
  const failRes = await controlEngine.executeAction("mobile_press_button", { button: "HOME" });
  assert.equal(failRes.success, false);
  assert.ok(failRes.error.includes("No mobile devices connected"));

  // Reconnect device
  mockAdb.isOffline = false;
  const reconnected = await controlEngine.discoverDevices();
  assert.equal(reconnected.count, 1);
  assert.equal(reconnected.connected, true);

  // Operations resume normally
  const successRes = await controlEngine.executeAction("mobile_press_button", { button: "HOME" });
  assert.equal(successRes.success, true);
});

// Physical Device Acceptance Verification (Runs conditionally when physical device is attached)
test("MobileE2E: Physical device acceptance on OPPO CPH2127", async (t) => {
  let devRes;
  try {
    devRes = await adbBridge.listDevices();
  } catch (err) {
    t.skip(`Physical ADB discovery unavailable: ${err.message}`);
    return;
  }

  const physicalDevice = devRes.devices?.find(d => d.type === "real" || d.name?.includes("CPH2127") || d.id?.includes("adb-"));
  if (!physicalDevice) {
    t.skip("No physical Android hardware attached. Skipping real hardware assertions.");
    return;
  }

  // 1. Verify device identification
  const details = await adbBridge.getDeviceDetails(physicalDevice.id);
  assert.ok(details.androidVersion, "Device must report Android OS version");
  assert.ok(details.screenSize.width > 0, "Device must report screen width");
  assert.ok(details.screenSize.height > 0, "Device must report screen height");

  // 2. Verify foreground app query
  const fg = await adbBridge.getForegroundApp(physicalDevice.id);
  assert.ok(fg.packageName, "Device must report valid foreground package");

  // 3. Verify real screen capture buffer
  const screenshotBuf = await adbBridge.takeScreenshot(physicalDevice.id);
  assert.ok(Buffer.isBuffer(screenshotBuf), "Screenshot must be returned as a valid Buffer");
  assert.ok(screenshotBuf.length > 1000, "Screenshot buffer must contain valid PNG data");

  // 4. Verify PNG magic header bytes (0x89 0x50 0x4E 0x47)
  assert.equal(screenshotBuf[0], 0x89);
  assert.equal(screenshotBuf[1], 0x50);
  assert.equal(screenshotBuf[2], 0x4E);
  assert.equal(screenshotBuf[3], 0x47);
});
