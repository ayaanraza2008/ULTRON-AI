/**
 * ULTRON AI — OPERATION INFINITY: Multi-Device Personal AI Ecosystem Test Suite
 *
 * Verifies:
 * 1. Arbitrary N-device scalability across Windows PCs, laptops, Android phones,
 *    tablets, web browsers, and client adapters (no two-device limitation).
 * 2. Dynamic device registration, telemetry presence updates, and unregistration.
 * 3. Capability-aware task routing (findEligibleDevices).
 * 4. Ecosystem state synchronization across devices with conflict resolution.
 * 5. DeviceHub pairing, allowlist enforcement, and strict offline presence fail-closed behavior.
 * 6. Extended remote PC computer control actions (open folder, find file, vitals, inspect task, emergency stop).
 * 7. Single-owner exclusivity: owner-only signup gating and owner user ID verification.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MultiDeviceManager, DEVICE_TYPES } from "../integrations/multi-device-manager.js";
import { DeviceHub, APPROVED_REMOTE_ACTIONS } from "../integrations/device-hub.js";
import { WindowsDesktopAgent, DESKTOP_SCREEN_STATE } from "../system/windows-desktop-agent.js";
import { RemoteTaskOrchestrator } from "../system/remote-task-orchestrator.js";
import { createApp } from "../server.js";

async function withServer({ env = {}, fetchImpl = async () => new Response("{}", { status: 200 }) } = {}, run) {
  const mergedEnv = {
    SUPABASE_URL: "https://project.example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    NODE_ENV: "production",
    ...env
  };
  const app = createApp({ env: mergedEnv, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("MultiDeviceManager supports arbitrary N-device fleet (no two-device limit)", () => {
  const mdm = new MultiDeviceManager();

  // Initially has baseline fleet (4 devices: 1 primary desktop + 3 companion devices)
  const baselineCount = mdm.listDevices().length;
  assert.equal(baselineCount >= 2, true);

  // Register additional personal devices: laptop, second phone, tablet, browser
  const laptop = mdm.registerDevice({
    id: "dev-laptop-win11",
    name: "ThinkPad Workstation",
    type: DEVICE_TYPES.WINDOWS_LAPTOP,
    platform: "windows",
    capabilities: ["screen_lock", "screen_unlock", "run_script", "notifications"],
    online: true,
    battery: { percent: 85, isCharging: false }
  });
  assert.equal(laptop.id, "dev-laptop-win11");

  const phone2 = mdm.registerDevice({
    id: "dev-phone-pixel9",
    name: "Pixel 9 Pro",
    type: DEVICE_TYPES.ANDROID_SMARTPHONE,
    platform: "android",
    capabilities: ["screen_unlock", "sms", "camera", "notifications"],
    online: true,
    battery: { percent: 92, isCharging: true }
  });
  assert.equal(phone2.id, "dev-phone-pixel9");

  const tablet = mdm.registerDevice({
    id: "dev-tablet-tab9",
    name: "Galaxy Tab S9",
    type: DEVICE_TYPES.ANDROID_TABLET,
    platform: "android",
    capabilities: ["screen_unlock", "camera", "media_player", "notifications"],
    online: true,
    battery: { percent: 74, isCharging: false }
  });
  assert.equal(tablet.id, "dev-tablet-tab9");

  const browser = mdm.registerDevice({
    id: "dev-web-living-core",
    name: "Living Core Web Client",
    type: DEVICE_TYPES.WEB_BROWSER,
    platform: "browser",
    capabilities: ["hud_display", "audio_stream", "notifications"],
    online: true
  });
  assert.equal(browser.id, "dev-web-living-core");

  // Verify full expanded fleet
  const fleet = mdm.listDevices();
  assert.equal(fleet.length, baselineCount + 4);
  assert.equal(fleet.filter(d => d.online).length >= 5, true);

  // Verify dynamic unregistration
  const unreg = mdm.unregisterDevice("dev-tablet-tab9");
  assert.equal(unreg.success, true);
  assert.equal(mdm.listDevices().length, baselineCount + 3);
  assert.equal(mdm.getDevice("dev-tablet-tab9"), null);
});

test("Capability-aware routing and telemetry updates", () => {
  const mdm = new MultiDeviceManager();

  mdm.registerDevice({
    id: "pc-studio",
    name: "Studio Rig",
    type: DEVICE_TYPES.WINDOWS_PC,
    capabilities: ["cuda_compute", "heavy_build", "screen_lock"],
    online: true
  });

  mdm.registerDevice({
    id: "phone-primary",
    name: "Owner Phone",
    type: DEVICE_TYPES.ANDROID_SMARTPHONE,
    capabilities: ["telephony", "gps", "camera", "biometrics"],
    online: true
  });

  mdm.registerDevice({
    id: "pc-backup",
    name: "Backup Laptop",
    type: DEVICE_TYPES.WINDOWS_LAPTOP,
    capabilities: ["heavy_build"],
    online: false // offline
  });

  // Query capability 'heavy_build' with onlineOnly=true (default)
  const computeDevices = mdm.findEligibleDevices("heavy_build");
  assert.equal(computeDevices.length, 1);
  assert.equal(computeDevices[0].id, "pc-studio");

  // Query capability 'heavy_build' including offline
  const allCompute = mdm.findEligibleDevices("heavy_build", { onlineOnly: false });
  assert.equal(allCompute.length, 2);

  // Query capability 'camera'
  const cameraDevices = mdm.findEligibleDevices("camera");
  assert.equal(cameraDevices.length, 1);
  assert.equal(cameraDevices[0].id, "phone-primary");

  // Query device capabilities
  const caps = mdm.getDeviceCapabilities("phone-primary");
  assert.deepEqual(caps, ["telephony", "gps", "camera", "biometrics"]);

  // Update telemetry and presence
  const presenceRes = mdm.updateDevicePresence("phone-primary", {
    online: true,
    battery: { percent: 45, isCharging: true },
    vitals: { networkType: "5G", temperatureC: 31 }
  });
  assert.equal(presenceRes.success, true);
  const updatedDev = mdm.getDevice("phone-primary");
  assert.equal(updatedDev.battery.percent, 45);
  assert.equal(updatedDev.battery.isCharging, true);
  assert.equal(updatedDev.vitals.networkType, "5G");
});

test("Ecosystem state synchronization with conflict resolution", () => {
  const mdm = new MultiDeviceManager();

  // Sync active task state
  const sync1 = mdm.syncStateAcrossDevices({
    stateKey: "active_project_context",
    payload: { currentFile: "server.js", line: 42 },
    originDeviceId: "pc-primary"
  });
  assert.equal(sync1.success, true);
  assert.equal(sync1.syncedKey, "active_project_context");
  assert.equal(sync1.version, 1);

  // Retrieve state
  const state = mdm.getSharedEcosystemState("active_project_context");
  assert.equal(state.payload.currentFile, "server.js");
  assert.equal(state.version, 1);

  // Conflict resolution: simulate a stale update with past updatedAtMs
  const staleUpdate = {
    stateKey: "active_project_context",
    payload: { currentFile: "stale.js" },
    originDeviceId: "phone-primary"
  };
  // Inject artificially future timestamp into existing state
  state.updatedAtMs = Date.now() + 100_000;
  const conflictRes = mdm.syncStateAcrossDevices(staleUpdate);
  assert.equal(conflictRes.success, false);
  assert.equal(conflictRes.error, "CONFLICT_STALE_UPDATE");

  // Clean state
  mdm.clearSharedState("active_project_context");
  assert.equal(mdm.getSharedEcosystemState("active_project_context"), null);
});

test("DeviceHub allowlist includes new remote PC operations and blocks unsafe commands", () => {
  // Verify allowlisted actions
  assert.equal(APPROVED_REMOTE_ACTIONS.has("open_folder"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("find_file"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("inspect_task"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("stop_task"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("get_task_output"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("emergency_stop"), true);

  // Verify arbitrary/dangerous shell actions are denied
  assert.equal(APPROVED_REMOTE_ACTIONS.has("format"), false);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("bash"), false);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("rm_rf"), false);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("powershell_raw"), false);
});

test("DeviceHub strict offline presence check fails closed", () => {
  const hub = new DeviceHub({
    tokenSecret: "test-secret-at-least-32-chars-long-entropy-key-12345"
  });

  const pairing = hub.createPairingCode({
    name: "Offline Workstation",
    platform: "windows"
  });
  const paired = hub.verifyPairingCode(pairing.code, null, "owner-user-123");
  assert.equal(paired.success, true);
  const targetId = paired.deviceId;

  // Explicitly simulate offline state (e.g. PC shut down or disconnected)
  const dev = hub.pairedDevices.get(targetId);
  dev.online = false;
  dev.lastSeenAt = new Date(Date.now() - 300_000).toISOString(); // 5 min ago

  assert.equal(hub.isDeviceOnline(targetId), false);

  // Attempting to dispatch remote task to offline PC MUST fail closed
  const dispatchRes = hub.routeCommand({
    action: "open_folder",
    payload: { folder: "workspace" },
    targetDeviceId: targetId,
    callerUserId: "owner-user-123"
  });

  assert.equal(dispatchRes.success, false);
  assert.equal(dispatchRes.error, "TARGET_DEVICE_OFFLINE");
  assert.match(dispatchRes.message, /OFFLINE or unreachable/);
});

test("WindowsDesktopAgent handles extended remote PC actions and emergency stop", async () => {
  const agent = new WindowsDesktopAgent();

  // Test inspect_task
  const inspectRes = await agent.executeCommand("inspect_task");
  assert.equal(inspectRes.success, true);
  assert.equal(inspectRes.result.success, true);
  assert.equal(inspectRes.result.isEmergencyStopped, false);

  // Test emergency_stop
  const stopRes = await agent.executeCommand("emergency_stop");
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.result.status, "EMERGENCY_STOP_ENGAGED");

  // Verify inspect_task reflects emergency stop engaged
  const inspectAfterStop = await agent.executeCommand("inspect_task");
  assert.equal(inspectAfterStop.result.isEmergencyStopped, true);

  // Resume operations
  agent.computerControl.setEmergencyStop(false);
  assert.equal(agent.computerControl.isEmergencyStopped(), false);
});

test("RemoteTaskOrchestrator dispatches extended PC operations to Windows desktop agent", async () => {
  const mockAgent = {
    async executeCommand(action, payload) {
      return { success: true, mockAction: action, payload };
    },
    async getSystemVitals() {
      return { storageAvailableGb: 210, ramUsedPercent: 32 };
    }
  };

  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: mockAgent
  });

  // 1. LAUNCH_PC_APP
  const launchRes = await orchestrator.executeRemoteTask({
    callerId: "+1234567890",
    isOwner: true,
    action: "LAUNCH_PC_APP",
    payload: { app: "code" }
  });
  assert.equal(launchRes.success, true);
  assert.equal(launchRes.result.mockAction, "launch_app");

  // 2. OPEN_PC_FOLDER
  const folderRes = await orchestrator.executeRemoteTask({
    callerId: "+1234567890",
    isOwner: true,
    action: "OPEN_PC_FOLDER",
    payload: { folder: "src" }
  });
  assert.equal(folderRes.success, true);
  assert.equal(folderRes.result.mockAction, "open_folder");

  // 3. GET_PC_VITALS
  const vitalsRes = await orchestrator.executeRemoteTask({
    callerId: "+1234567890",
    isOwner: true,
    action: "GET_PC_VITALS"
  });
  assert.equal(vitalsRes.success, true);
  assert.equal(vitalsRes.result.storageAvailableGb, 210);

  // 4. EMERGENCY_STOP
  const emergRes = await orchestrator.executeRemoteTask({
    callerId: "+1234567890",
    isOwner: true,
    action: "EMERGENCY_STOP"
  });
  assert.equal(emergRes.success, true);
  assert.equal(emergRes.result.mockAction, "emergency_stop");
});

test("Owner-only signup gating rejects unauthorized public signups when disabled", async () => {
  const env = {
    ULTRON_DISABLE_PUBLIC_SIGNUP: "true",
    ULTRON_OWNER_BOOTSTRAP_TOKEN: "valid-owner-bootstrap-secret-998877"
  };

  await withServer({ env }, async base => {
    // Attempt signup without bootstrap token -> 403 SIGNUP_DISABLED
    const resWithoutToken = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "intruder@example.com", password: "Password123!" })
    });
    assert.equal(resWithoutToken.status, 403);
    const errBody = await resWithoutToken.json();
    assert.equal(errBody.error.code, "SIGNUP_DISABLED");

    // Attempt signup with invalid bootstrap token -> 403 SIGNUP_DISABLED
    const resBadToken = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ultron-bootstrap-token": "wrong-token"
      },
      body: JSON.stringify({ email: "intruder@example.com", password: "Password123!" })
    });
    assert.equal(resBadToken.status, 403);
    assert.equal((await resBadToken.json()).error.code, "SIGNUP_DISABLED");
  });
});

test("Single-owner exclusivity rejects non-owner authenticated accounts", async () => {
  const env = {
    ULTRON_OWNER_USER_ID: "owner-uuid-ayaan-001"
  };

  const fetchImpl = async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "intruder-uuid-999", email: "other@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("{}", { status: 200 });
  };

  await withServer({ env, fetchImpl }, async base => {
    // Authenticated request from a non-owner user ID -> 403 ULTRON_OWNER_ONLY
    const res = await fetch(base + "/api/runtime/readiness", {
      headers: {
        cookie: "ultron_sb_access=valid-token-for-intruder"
      }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "ULTRON_OWNER_ONLY");
    assert.match(body.error.message, /belongs exclusively to its registered owner/);
  });
});
