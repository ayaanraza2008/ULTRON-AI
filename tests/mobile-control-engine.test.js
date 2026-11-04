import test from "node:test";
import assert from "node:assert/strict";
import { MobileControlEngine } from "../mobile/mobile-control-engine.js";
import { MobileDeviceRegistry } from "../mobile/mobile-device-registry.js";
import { MobilePermissionEngine, MOBILE_PERMISSION_LEVELS } from "../mobile/mobile-permission-engine.js";
import { MobileTaskPlanner } from "../mobile/mobile-task-planner.js";

// Mock AdbBridge for deterministic unit testing
class MockAdbBridge {
  constructor() {
    this.devices = [
      { id: "emulator-5554", state: "online", model: "Pixel_7", connectionType: "emulator", ready: true, platform: "android" }
    ];
    this.foregroundApp = { package: "com.google.android.apps.nexuslauncher", activity: "NexusLauncherActivity" };
    this.commandLog = [];
  }

  async checkAvailability() {
    return { available: true, path: "mock-adb", version: "1.0.41", platform: "win32" };
  }

  async listDevices() {
    return { success: true, count: this.devices.length, devices: this.devices };
  }

  async getForegroundApp() {
    return this.foregroundApp;
  }

  async execDevice(deviceId, args) {
    this.commandLog.push({ deviceId, args });
    return { success: true, stdout: "", stderr: "" };
  }

  async tap(deviceId, x, y) {
    this.commandLog.push({ deviceId, action: "tap", x, y });
    return { success: true };
  }

  async pressKey(deviceId, keycode) {
    this.commandLog.push({ deviceId, action: "pressKey", keycode });
    return { success: true };
  }

  async launchApp(deviceId, pkg) {
    this.commandLog.push({ deviceId, action: "launchApp", pkg });
    this.foregroundApp = { package: pkg, activity: "MainActivity" };
    return { success: true };
  }
}

// Mock MCP Client
class MockMcpClient {
  constructor() {
    this.status = "CONNECTED";
    this.discoveredTools = new Map([
      ["mobile_list_available_devices", {}],
      ["mobile_click_on_screen_at_coordinates", {}],
      ["mobile_press_button", {}]
    ]);
  }

  getStatus() {
    return { status: this.status, transport: "stdio", pid: 1234, toolsCount: 3 };
  }

  async start() {
    return { success: true, toolsCount: 3, serverVersion: "1.0.16" };
  }

  async stop() {
    this.status = "DISCONNECTED";
  }

  async callTool(name, args) {
    return { success: true, text: "Mock MCP Tool Executed", name, args };
  }
}

test("MobileControlEngine: initializes lifecycle and discovers devices", async () => {
  const mockAdb = new MockAdbBridge();
  const mockMcp = new MockMcpClient();
  const registry = new MobileDeviceRegistry({ adbBridge: mockAdb });
  const permissions = new MobilePermissionEngine();
  const planner = new MobileTaskPlanner();

  const engine = new MobileControlEngine({
    adbBridge: mockAdb,
    mcpClient: mockMcp,
    deviceRegistry: registry,
    permissionEngine: permissions,
    taskPlanner: planner,
    autoStartMcp: true
  });

  const initRes = await engine.initialize();
  assert.equal(initRes.initialized, true);
  assert.equal(initRes.devicesCount, 1);
  assert.equal(initRes.activeDevice.id, "emulator-5554");

  const status = await engine.getStatus();
  assert.equal(status.initialized, true);
  assert.equal(status.deviceCount, 1);

  await engine.shutdown();
  assert.equal(engine.isInitialized, false);
});

test("MobileControlEngine: executes single action with pre/post state capture", async () => {
  const mockAdb = new MockAdbBridge();
  const mockMcp = new MockMcpClient();
  const registry = new MobileDeviceRegistry({ adbBridge: mockAdb });
  const permissions = new MobilePermissionEngine();

  const engine = new MobileControlEngine({
    adbBridge: mockAdb,
    mcpClient: mockMcp,
    deviceRegistry: registry,
    permissionEngine: permissions,
    autoStartMcp: false
  });

  await engine.initialize();

  // Execute tap
  const tapRes = await engine.executeAction("mobile_click_on_screen_at_coordinates", {
    device: "emulator-5554",
    x: 500,
    y: 800
  });

  assert.equal(tapRes.success, true);
  assert.ok(tapRes.verification);
  assert.ok(tapRes.verification.preState);
  assert.ok(tapRes.verification.postState);

  await engine.shutdown();
});

test("MobileControlEngine: executes multi-step workflow with cancellation support", async () => {
  const mockAdb = new MockAdbBridge();
  const mockMcp = new MockMcpClient();
  const registry = new MobileDeviceRegistry({ adbBridge: mockAdb });
  const permissions = new MobilePermissionEngine();
  const planner = new MobileTaskPlanner();

  const engine = new MobileControlEngine({
    adbBridge: mockAdb,
    mcpClient: mockMcp,
    deviceRegistry: registry,
    permissionEngine: permissions,
    taskPlanner: planner,
    autoStartMcp: false
  });

  await engine.initialize();

  const plan = {
    id: "wf-test-1",
    steps: [
      { stepIndex: 1, action: "mobile_press_button", params: { button: "HOME" } },
      { stepIndex: 2, action: "mobile_click_on_screen_at_coordinates", params: { x: 100, y: 200 } }
    ]
  };

  const wfResult = await engine.executeWorkflow(plan, { deviceId: "emulator-5554" });
  assert.equal(wfResult.success, true);
  assert.equal(wfResult.totalSteps, 2);
  assert.equal(wfResult.stepResults.length, 2);

  // Cancellation test: cancel non-existent or completed returns false
  assert.equal(engine.cancelWorkflow("completed-wf"), false);

  await engine.shutdown();
});

test("MobileControlEngine: emergency stop halts all actions immediately", async () => {
  const mockAdb = new MockAdbBridge();
  const mockMcp = new MockMcpClient();
  const registry = new MobileDeviceRegistry({ adbBridge: mockAdb });
  const permissions = new MobilePermissionEngine();

  const engine = new MobileControlEngine({
    adbBridge: mockAdb,
    mcpClient: mockMcp,
    deviceRegistry: registry,
    permissionEngine: permissions,
    autoStartMcp: false
  });

  await engine.initialize();

  // Trigger emergency stop
  const halt = engine.emergencyStop("Security hazard detected");
  assert.equal(halt.halted, true);

  // Action attempt must be rejected
  const actionRes = await engine.executeAction("mobile_click_on_screen_at_coordinates", {
    device: "emulator-5554",
    x: 10,
    y: 10
  });

  assert.equal(actionRes.success, false);
  assert.equal(actionRes.code, "EMERGENCY_STOP_ACTIVE");

  // Reset emergency stop
  engine.resetEmergencyStop();
  assert.equal(engine.emergencyHalted, false);

  await engine.shutdown();
});
