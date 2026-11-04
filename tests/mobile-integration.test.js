import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createMobileRouter } from "../mobile/mobile-router.js";
import { MobileControlEngine } from "../mobile/mobile-control-engine.js";
import { MobileDeviceRegistry } from "../mobile/mobile-device-registry.js";
import { MobilePermissionEngine, MOBILE_PERMISSION_LEVELS } from "../mobile/mobile-permission-engine.js";
import { MobileTaskPlanner } from "../mobile/mobile-task-planner.js";
import { MobileTaskAgent } from "../agents/mobile-task-agent.js";

// Mock Adb Bridge for integration tests
class MockAdbBridge {
  constructor() {
    this.devices = [
      { id: "device-test-1", state: "online", model: "Pixel_8_Pro", connectionType: "usb", ready: true, platform: "android" }
    ];
    this.foreground = { package: "com.google.android.apps.nexuslauncher", activity: "MainActivity" };
  }

  async checkAvailability() {
    return { available: true, path: "mock-adb", version: "1.0.41", platform: "win32" };
  }

  async listDevices() {
    return { success: true, count: this.devices.length, devices: this.devices };
  }

  async getForegroundApp() {
    return this.foreground;
  }

  async execDevice() {
    return { success: true, stdout: "", stderr: "" };
  }

  async takeScreenshot() {
    return { success: true, format: "base64", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
  }

  async dumpHierarchy() {
    return { success: true, elements: [{ id: "elem-1", text: "Search", bounds: { left: 0, top: 0, right: 100, bottom: 50 } }] };
  }
}

// Mock MCP Client
class MockMcpClient {
  constructor() {
    this.status = "CONNECTED";
    this.discoveredTools = new Map([
      ["mobile_list_available_devices", {}],
      ["mobile_take_screenshot", {}],
      ["mobile_list_elements_on_screen", {}],
      ["mobile_click_on_screen_at_coordinates", {}],
      ["mobile_press_button", {}],
      ["mobile_launch_app", {}],
      ["mobile_install_app", {}]
    ]);
  }

  getStatus() {
    return { status: this.status, transport: "stdio", pid: 9999, toolsCount: 7 };
  }

  async start() {
    return { success: true, toolsCount: 7, serverVersion: "1.0.16" };
  }

  async stop() {}

  async callTool(name, args) {
    if (name === "mobile_take_screenshot") {
      return {
        success: true,
        image: { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", mimeType: "image/png" }
      };
    }
    if (name === "mobile_list_elements_on_screen") {
      return {
        success: true,
        text: JSON.stringify({ elements: [{ id: "btn-ok", text: "OK" }] })
      };
    }
    return { success: true, text: `Mock response for ${name}`, args };
  }
}

async function authorizeTestDevice(baseUrl, deviceId = "device-test-1") {
  const res = await fetch(`${baseUrl}/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, maxLevel: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION })
  });
  const data = await res.json();
  assert.equal(res.status, 200, data.error?.message || "Device authorization failed");
  assert.equal(data.success, true);
}

async function withMobileServer(options = {}, fn) {
  const mockAdb = new MockAdbBridge();
  const mockMcp = new MockMcpClient();
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

  await controlEngine.initialize();

  const taskAgent = new MobileTaskAgent({
    controlEngine,
    visionEngine: {
      understandImage: async () => ({ description: "Android Home Screen with Search bar visible." })
    }
  });

  const app = express();
  app.use(express.json());

  // Mount mobile router
  app.use("/api/mobile", createMobileRouter({
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: "test-user" }; next(); },
    controlEngine,
    taskAgent
  }));

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/mobile`;

  try {
    await fn({ baseUrl, controlEngine, taskAgent, permissions });
  } finally {
    await controlEngine.shutdown();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("MobileIntegration: GET /api/mobile/status returns operational telemetry", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/status`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.initialized, true);
    assert.equal(data.devicesCount, 1);
  });
});

test("MobileIntegration: GET /api/mobile/devices lists connected Android devices", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/devices`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.count, 1);
    assert.equal(data.devices[0].id, "device-test-1");
  });
});

test("MobileIntegration: newly discovered devices are not implicitly authorized", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/devices`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.devices[0].authorized, false);
  });
});

test("MobileIntegration: unauthenticated caller cannot use internal-call header to authorize a device", async () => {
  const mockAdb = new MockAdbBridge();
  const mockMcp = new MockMcpClient();
  const registry = new MobileDeviceRegistry({ adbBridge: mockAdb });
  const permissions = new MobilePermissionEngine();
  const controlEngine = new MobileControlEngine({
    adbBridge: mockAdb,
    mcpClient: mockMcp,
    deviceRegistry: registry,
    permissionEngine: permissions,
    autoStartMcp: false
  });
  await controlEngine.initialize();

  const app = express();
  app.use("/api/mobile", createMobileRouter({ controlEngine, taskAgent: new MobileTaskAgent({ controlEngine }) }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const res = await fetch(`http://127.0.0.1:${address.port}/api/mobile/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ultron-internal-call": "true"
      },
      body: JSON.stringify({ deviceId: "device-test-1", maxLevel: 2 })
    });
    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.error.code, "AUTHENTICATED_USER_REQUIRED");
    assert.equal(permissions.deviceAuthorizations.size, 0);
  } finally {
    await controlEngine.shutdown();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

test("MobileIntegration: unpaired device cannot receive control actions", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-test-1",
        action: "mobile_click_on_screen_at_coordinates",
        params: { x: 100, y: 100 }
      })
    });
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error.code, "DEVICE_UNAUTHORIZED");
  });
});

test("MobileIntegration: POST /api/mobile/action executes touch and navigation actions", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    await authorizeTestDevice(baseUrl);
    const res = await fetch(`${baseUrl}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-test-1",
        action: "mobile_click_on_screen_at_coordinates",
        params: { x: 540, y: 1200 }
      })
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.action, "mobile_click_on_screen_at_coordinates");
  });
});

test("MobileIntegration: POST /api/mobile/screenshot returns valid image data", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    await authorizeTestDevice(baseUrl);
    const res = await fetch(`${baseUrl}/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "device-test-1", format: "base64" })
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.mimeType, "image/png");
    assert.ok(data.data.startsWith("iVBORw0KGgo"));
  });
});

test("MobileIntegration: POST /api/mobile/elements returns UI accessibility hierarchy", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    await authorizeTestDevice(baseUrl);
    const res = await fetch(`${baseUrl}/elements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "device-test-1" })
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });
});

test("MobileIntegration: Level 4 actions require single-use confirmation token", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    await authorizeTestDevice(baseUrl);
    // 1. Critical action without token must return 403 CONFIRMATION_REQUIRED
    const rejectRes = await fetch(`${baseUrl}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-test-1",
        action: "mobile_install_app",
        params: { apk: "untrusted.apk" }
      })
    });
    const rejectData = await rejectRes.json();

    assert.equal(rejectRes.status, 403);
    assert.equal(rejectData.error.code, "CONFIRMATION_REQUIRED");
    assert.ok(rejectData.error.confirmationToken);

    // 2. Authorize via /confirm endpoint
    const confirmRes = await fetch(`${baseUrl}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rejectData.error.confirmationToken,
        action: "mobile_install_app"
      })
    });
    const confirmData = await confirmRes.json();

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmData.success, true);
    assert.equal(confirmData.confirmed, true);

    // 3. Replay with the same token must fail
    const replayRes = await fetch(`${baseUrl}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rejectData.error.confirmationToken,
        action: "mobile_install_app"
      })
    });
    assert.equal(replayRes.status, 403);
  });
});

test("MobileIntegration: End-to-End Autonomous Mobile Task (goal -> plan -> execute -> summary)", async () => {
  await withMobileServer({}, async ({ baseUrl }) => {
    await authorizeTestDevice(baseUrl);
    const res = await fetch(`${baseUrl}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: "Take a screenshot of my phone and analyze what's on screen",
        deviceId: "device-test-1"
      })
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.agent, "mobile-device-agent");
    assert.ok(data.summary.includes("Mobile task completed"));
    assert.ok(data.visualPerception);
  });
});
