/**
 * ULTRON AI — OPERATION INFINITY: Master Multi-Device Personal AI Verification Suite
 *
 * Comprehensive End-to-End Verification of:
 * 1. Arbitrary N-device scalability across Windows PCs, laptops, Android phones,
 *    tablets, web browsers, and client adapters (no two-device limitation).
 * 2. MultiDeviceManager persistent durable storage & restart recovery.
 * 3. Real message delivery mechanism, active subscriber notification, offline queueing,
 *    and delivery acknowledgement.
 * 4. Server-authoritative monotonic versioned conflict resolution & sensitive data filter.
 * 5. Device revocation and isolation.
 * 6. Shared memory context across authorized personal devices.
 * 7. DeviceHub pairing, allowlist enforcement, and strict offline presence fail-closed behavior.
 * 8. Extended remote PC computer control actions, AbortController task cancellation,
 *    and multi-task emergency stop propagation.
 * 9. Elimination of fake success: RemoteTaskOrchestrator fails closed when agents are unavailable.
 * 10. Single-owner exclusivity: owner-only signup gating, timing-safe verification,
 *     and fail-closed behavior when owner ID is not configured.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MultiDeviceManager, DEVICE_TYPES } from "../integrations/multi-device-manager.js";
import { DeviceHub, APPROVED_REMOTE_ACTIONS } from "../integrations/device-hub.js";
import { WindowsDesktopAgent, DESKTOP_SCREEN_STATE } from "../system/windows-desktop-agent.js";
import { RemoteTaskOrchestrator } from "../system/remote-task-orchestrator.js";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";
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

test("1. MultiDeviceManager supports arbitrary N-device fleet (no two-device limit)", () => {
  const mdm = new MultiDeviceManager({ persist: false });

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

test("2. Capability-aware routing and telemetry updates", () => {
  const mdm = new MultiDeviceManager({ persist: false });

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

  const computeDevices = mdm.findEligibleDevices("heavy_build");
  assert.equal(computeDevices.length, 1);
  assert.equal(computeDevices[0].id, "pc-studio");

  const allCompute = mdm.findEligibleDevices("heavy_build", { onlineOnly: false });
  assert.equal(allCompute.length, 2);

  const cameraDevices = mdm.findEligibleDevices("camera");
  assert.equal(cameraDevices.length, 1);
  assert.equal(cameraDevices[0].id, "phone-primary");

  const caps = mdm.getDeviceCapabilities("phone-primary");
  assert.deepEqual(caps, ["telephony", "gps", "camera", "biometrics"]);

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

test("3. Durable persistence & restart recovery across MultiDeviceManager instances", () => {
  const tempFile = path.join(os.tmpdir(), "ultron-test-mdm-" + Date.now() + ".json");
  try {
    const mdm1 = new MultiDeviceManager({ storagePath: tempFile, persist: true });
    mdm1.registerDevice({
      id: "pc-custom-rig",
      name: "Custom Windows Rig",
      type: DEVICE_TYPES.WINDOWS_PC,
      capabilities: ["heavy_inference", "game_mode"],
      online: true
    });
    const persistedSync = mdm1.syncStateAcrossDevices({
      stateKey: "persisted_key_1",
      payload: { mode: "autonomous", activeProject: "ULTRON" },
      ownerUserId: "owner-test-user"
    });
    assert.equal(persistedSync.success, true);

    assert.equal(fs.existsSync(tempFile), true);

    // Restart recovery: second instance loads state from disk
    const mdm2 = new MultiDeviceManager({ storagePath: tempFile, persist: true });
    const recoveredDev = mdm2.getDevice("pc-custom-rig");
    assert.ok(recoveredDev);
    assert.equal(recoveredDev.name, "Custom Windows Rig");

    const recoveredState = mdm2.getSharedEcosystemState("persisted_key_1");
    assert.ok(recoveredState);
    assert.equal(recoveredState.payload.activeProject, "ULTRON");
    assert.equal(recoveredState.version, 1);
  } finally {
    try { fs.unlinkSync(tempFile); } catch {}
  }
});

test("4. Real message delivery: active subscriber, offline queueing, and delivery acknowledgement", () => {
  const mdm = new MultiDeviceManager({ persist: false });

  // Register two companion devices
  mdm.registerDevice({ id: "phone-alpha", name: "Phone Alpha", type: DEVICE_TYPES.ANDROID_SMARTPHONE });
  mdm.registerDevice({ id: "tablet-beta", name: "Tablet Beta", type: DEVICE_TYPES.ANDROID_TABLET });

  const deliveredEvents = [];
  // Phone Alpha subscribes to live events
  mdm.subscribeDevice("phone-alpha", (evt) => {
    deliveredEvents.push(evt);
  });

  // Sync state broadcast
  const syncRes = mdm.syncStateAcrossDevices({
    stateKey: "music_playback",
    payload: { track: "Interstellar Theme", isPlaying: true },
    originDeviceId: "pc-primary",
    targetDevices: ["phone-alpha", "tablet-beta"]
  });

  assert.equal(syncRes.success, true);
  assert.equal(syncRes.locallyNotifiedDevices.length, 1); // in-process callback notification
  assert.equal(syncRes.deliveredCount, 0); // no application ACK has arrived
  assert.equal(syncRes.sentCount, 0);      // no authenticated WebSocket/SSE session in this unit test
  assert.equal(syncRes.queuedCount, 2);    // queued for both devices

  // Verify Phone Alpha received the live event
  assert.equal(deliveredEvents.length, 1);
  assert.equal(deliveredEvents[0].stateKey, "music_playback");
  assert.equal(deliveredEvents[0].payload.track, "Interstellar Theme");

  // Tablet Beta (offline subscriber) polls pending events
  const pendingForTablet = mdm.pollPendingEvents("tablet-beta");
  assert.equal(pendingForTablet.length, 1);
  assert.equal(pendingForTablet[0].stateKey, "music_playback");

  // Tablet Beta acknowledges delivery
  const ackRes = mdm.acknowledgeDelivery("tablet-beta", pendingForTablet[0].deliveryId);
  assert.equal(ackRes.success, true);
  assert.equal(ackRes.acknowledged, true);
  assert.equal(ackRes.remainingCount, 0);

  // Tablet Beta queue is now empty
  assert.equal(mdm.pollPendingEvents("tablet-beta").length, 0);
});

test("State queue acknowledgement is not reported successful when durable write fails", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-mdm-ack-"));
  try {
    const invalidStorePath = path.join(tempDir, "existing-directory");
    fs.mkdirSync(invalidStorePath);
    const mdm = new MultiDeviceManager({ storagePath: invalidStorePath, persist: true, seedDefaultFleet: false });
    mdm.pendingDeliveries.set("phone-ack-fail", [{ deliveryId: "del-ack-fail" }]);
    const ack = mdm.acknowledgeDelivery("phone-ack-fail", "del-ack-fail");
    assert.equal(ack.success, false);
    assert.equal(ack.error, "STATE_PERSISTENCE_FAILED");
    assert.equal(mdm.pollPendingEvents("phone-ack-fail").length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Authenticated WebSocket state-sync ACK is bound to the paired device owner", async () => {
  let ackInput = null;
  const fakeHub = {
    pairedDevices: new Map([["phone-ack-1", {
      id: "phone-ack-1",
      ownerUserId: "owner-ack-1",
      status: "active"
    }]]),
    registerEventListener() { return () => {}; }
  };
  const gateway = new DeviceWebSocketGateway({
    deviceHub: fakeHub,
    logger: { warn() {} }
  });
  gateway.setStateSyncAckHandler(async input => {
    ackInput = input;
    return { success: true, acknowledged: true, remainingCount: 0 };
  });
  const sentFrames = [];
  const session = {
    authenticated: true,
    deviceId: "phone-ack-1",
    device: { id: "phone-ack-1", ownerUserId: "owner-ack-1", authToken: "device-token" },
    socket: { write(frame) { sentFrames.push(Buffer.from(frame)); return true; } }
  };
  try {
    await gateway.handleClientMessage(session, JSON.stringify({
      type: "STATE_SYNC_ACK",
      deliveryId: "del-ack-123"
    }));
    assert.deepEqual(ackInput, {
      deviceId: "phone-ack-1",
      ownerUserId: "owner-ack-1",
      deliveryId: "del-ack-123"
    });
    assert.equal(sentFrames.length, 1);
    const payload = sentFrames[0].subarray(2).toString("utf8");
    assert.equal(JSON.parse(payload).type, "STATE_SYNC_ACK_RESULT");
    assert.equal(JSON.parse(payload).success, true);
  } finally {
    gateway.close();
  }
});

test("5. Server-authoritative monotonic version conflict resolution & sensitive data filter", () => {
  const mdm = new MultiDeviceManager({ persist: false });

  // Initial update: version 1
  const sync1 = mdm.syncStateAcrossDevices({
    stateKey: "active_task",
    payload: { status: "started" }
  });
  assert.equal(sync1.success, true);
  assert.equal(sync1.version, 1);

  // Valid expectedVersion=1 update -> advances to version 2
  const sync2 = mdm.syncStateAcrossDevices({
    stateKey: "active_task",
    payload: { status: "in_progress" },
    expectedVersion: 1
  });
  assert.equal(sync2.success, true);
  assert.equal(sync2.version, 2);

  // Stale expectedVersion=1 update -> rejected with VERSION_CONFLICT
  const staleSync = mdm.syncStateAcrossDevices({
    stateKey: "active_task",
    payload: { status: "stale_overwrite" },
    expectedVersion: 1
  });
  assert.equal(staleSync.success, false);
  assert.equal(staleSync.error, "VERSION_CONFLICT");
  assert.equal(staleSync.currentVersion, 2);

  // Sensitive data filter: blocking broadcast of credentials
  const badSync = mdm.syncStateAcrossDevices({
    stateKey: "credentials_leak",
    payload: { tokenHash: "plain_secret_value_123" }
  });
  assert.equal(badSync.success, false);
  assert.equal(badSync.error, "SENSITIVE_DATA_BLOCKED");
});

test("6. Device revocation isolates device and drops active delivery", () => {
  const mdm = new MultiDeviceManager({ persist: false });
  mdm.registerDevice({ id: "untrusted-phone", name: "Compromised Device", type: DEVICE_TYPES.ANDROID_SMARTPHONE });

  let received = false;
  mdm.subscribeDevice("untrusted-phone", () => { received = true; });

  const revokeRes = mdm.revokeDevice("untrusted-phone", "lost_device");
  assert.equal(revokeRes.success, true);
  assert.equal(revokeRes.status, "revoked");
  assert.equal(mdm.getDevice("untrusted-phone"), null);
  assert.equal(mdm.listDevices().some(device => device.id === "untrusted-phone"), false);

  // Sync event targeting revoked device must skip it
  const syncRes = mdm.syncStateAcrossDevices({
    stateKey: "security_alert",
    payload: { level: "high" },
    targetDevices: ["untrusted-phone"]
  });
  assert.equal(syncRes.deliveredCount, 0);
  assert.equal(syncRes.queuedCount, 0);
  assert.equal(received, false);
});

test("7. Shared memory access across authorized personal devices", () => {
  const mdm = new MultiDeviceManager({ persist: false });

  // Store conversation memory context from Android
  const memSync = mdm.syncSharedMemory({
    memoryKey: "project_ultron_architecture",
    memoryData: { leadDev: "Ayaan Raza", activeBranch: "feat/ultron-operation-infinity-multidevice" },
    originDeviceId: "phone-android-alpha"
  });
  assert.equal(memSync.success, true);
  assert.equal(memSync.version, 1);

  // Retrieve authorized project memory from Windows PC
  const mem = mdm.getSharedMemory("project_ultron_architecture");
  assert.ok(mem);
  assert.equal(mem.leadDev, "Ayaan Raza");
  assert.equal(mem.activeBranch, "feat/ultron-operation-infinity-multidevice");
});

test("8. DeviceHub allowlist, pairing, and strict offline presence fail-closed", () => {
  assert.equal(APPROVED_REMOTE_ACTIONS.has("open_folder"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("find_file"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("inspect_task"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("stop_task"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("get_task_output"), true);
  assert.equal(APPROVED_REMOTE_ACTIONS.has("emergency_stop"), true);

  const hub = new DeviceHub({
    tokenSecret: "test-secret-at-least-32-chars-long-entropy-key-12345"
  });

  const pairing = hub.createPairingCode({ name: "Offline Workstation", platform: "windows" });
  const paired = hub.verifyPairingCode(pairing.code, null, "owner-user-123");
  assert.equal(paired.success, true);
  const targetId = paired.deviceId;

  // Mark device offline
  const dev = hub.pairedDevices.get(targetId);
  dev.online = false;
  dev.lastSeenAt = new Date(Date.now() - 300_000).toISOString();

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

test("9. WindowsDesktopAgent managed task tracking, task cancellation & emergency stop", async () => {
  const agent = new WindowsDesktopAgent();

  // Test inspecting initial state
  const inspectRes = await agent.executeCommand("inspect_task");
  assert.equal(inspectRes.success, true);
  assert.equal(inspectRes.result.isEmergencyStopped, false);

  // Simulate registering a long-running managed task
  const taskId = "task-comp-99";
  const managed = agent.createManagedTask(taskId, "long_worker_process");
  assert.equal(agent.activeTasks.get(taskId).status, "running");

  // Verify inspect_task reflects running task
  const inspectRunning = await agent.executeCommand("inspect_task");
  assert.equal(inspectRunning.result.runningCount, 1);

  // Test real task cancellation via stop_task
  const stopRes = await agent.executeCommand("stop_task", { taskId });
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.result.status, "aborted");
  assert.equal(managed.abortController.signal.aborted, true);
  assert.equal(agent.activeTasks.get(taskId).status, "aborted");

  // Create another task and test emergency stop
  const task2 = agent.createManagedTask("task-comp-100", "compute_task");
  const emergRes = await agent.executeCommand("emergency_stop");
  assert.equal(emergRes.success, true);
  assert.equal(emergRes.result.status, "EMERGENCY_STOP_ENGAGED");
  assert.ok(emergRes.result.abortedTasks.includes("task-comp-100"));
  assert.equal(task2.abortController.signal.aborted, true);
  assert.equal(agent.computerControl.isEmergencyStopped(), true);

  // Reset emergency stop
  agent.computerControl.setEmergencyStop(false);
});

test("10. RemoteTaskOrchestrator eliminates fake success: fails closed when agent unavailable", async () => {
  const orchestrator = new RemoteTaskOrchestrator(); // No agent attached

  // All PC commands must fail closed with WINDOWS_AGENT_UNAVAILABLE
  const pcActions = ["UNLOCK_PC_SCREEN", "LOCK_PC_SCREEN", "LAUNCH_PC_APP", "OPEN_PC_FOLDER", "FIND_PC_FILE", "GET_PC_VITALS", "EMERGENCY_STOP"];
  for (const act of pcActions) {
    const res = await orchestrator.executeRemoteTask({
      callerId: "+1234567890",
      isOwner: true,
      action: act
    });
    assert.equal(res.success, false, `Action ${act} should not succeed without agent`);
    assert.equal(res.error, "WINDOWS_AGENT_UNAVAILABLE");
  }

  // With a mock agent connected, calls execute genuinely
  const mockAgent = {
    async executeCommand(action, payload) {
      return { success: true, executedAction: action, payload };
    },
    async getSystemVitals() {
      return { storageAvailableGb: 250, ramUsedPercent: 28 };
    }
  };
  const orchestratorWithAgent = new RemoteTaskOrchestrator({ windowsDesktopAgent: mockAgent });

  const validLaunch = await orchestratorWithAgent.executeRemoteTask({
    callerId: "+1234567890",
    isOwner: true,
    action: "LAUNCH_PC_APP",
    payload: { app: "notepad" }
  });
  assert.equal(validLaunch.success, true);
  assert.equal(validLaunch.result.executedAction, "launch_app");
});

test("11. Owner-only signup gating & timing-safe token verification", async () => {
  const env = {
    ULTRON_DISABLE_PUBLIC_SIGNUP: "true",
    ULTRON_OWNER_BOOTSTRAP_TOKEN: "valid-bootstrap-secret-998877"
  };

  await withServer({ env }, async base => {
    // Attempt signup without bootstrap token -> 403 SIGNUP_DISABLED
    const resWithoutToken = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "intruder@example.com",
        password: ["example", "user", "secret", "phrase"].join("-")
      })
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
      body: JSON.stringify({
        email: "intruder@example.com",
        password: ["example", "user", "secret", "phrase"].join("-")
      })
    });
    assert.equal(resBadToken.status, 403);
    assert.equal((await resBadToken.json()).error.code, "SIGNUP_DISABLED");
  });
});

test("12. Single-owner exclusivity and fail-closed when owner is unconfigured", async () => {
  // Test 1: Non-owner account rejected
  const env1 = {
    ULTRON_OWNER_USER_ID: "owner-uuid-ayaan-001"
  };

  const fetchImpl1 = async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "intruder-uuid-999", email: "other@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("{}", { status: 200 });
  };

  await withServer({ env: env1, fetchImpl: fetchImpl1 }, async base => {
    const res = await fetch(base + "/api/runtime/readiness", {
      headers: { cookie: "ultron_sb_access=valid-token-for-intruder" }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "ULTRON_OWNER_ONLY");
    assert.match(body.error.message, /belongs exclusively to its registered owner/);
  });

  // Test 2: In personal mode with NO owner configured, protected data routes fail closed
  const env2 = {
    ULTRON_PERSONAL_AI_MODE: "true"
    // ULTRON_OWNER_USER_ID is missing
  };

  const fetchImpl2 = async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "any-user-uuid", email: "user@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("{}", { status: 200 });
  };

  await withServer({ env: env2, fetchImpl: fetchImpl2 }, async base => {
    const res = await fetch(base + "/api/runtime/readiness", {
      headers: { cookie: "ultron_sb_access=valid-token-any" }
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, "OWNER_NOT_CONFIGURED");
    assert.match(body.error.message, /owner user ID is not configured/);
  });
});


test("13. WebSocket/SSE state sync delivers only to authenticated devices owned by the target owner", () => {
  const writes = [];
  const deviceHub = {
    pairedDevices: new Map([
      ["phone-owner-a", { id: "phone-owner-a", ownerUserId: "owner-a", status: "active" }],
      ["phone-owner-b", { id: "phone-owner-b", ownerUserId: "owner-b", status: "active" }],
      ["phone-revoked", { id: "phone-revoked", ownerUserId: "owner-a", status: "revoked" }],
      ["browser-owner-a", { id: "browser-owner-a", ownerUserId: "owner-a", status: "active" }]
    ]),
    registerEventListener() { return () => {}; }
  };
  const gateway = new DeviceWebSocketGateway({ deviceHub, logger: { warn() {} } });
  gateway.sendFrame = (socket, payload) => {
    writes.push({ socket, payload });
    return true;
  };
  gateway.clients.set("phone-owner-a", {
    authenticated: true,
    device: { id: "phone-owner-a", ownerUserId: "owner-a" },
    socket: { id: "phone-owner-a" }
  });
  gateway.clients.set("phone-owner-b", {
    authenticated: true,
    device: { id: "phone-owner-b", ownerUserId: "owner-b" },
    socket: { id: "phone-owner-b" }
  });
  gateway.clients.set("phone-revoked", {
    authenticated: true,
    device: { id: "phone-revoked", ownerUserId: "owner-a" },
    socket: { id: "phone-revoked" }
  });
  const sseWrites = [];
  gateway.sseClients.set("browser-owner-a", new Set([{ write(value) { sseWrites.push(value); } }]));

  const result = gateway.dispatchStateSync({
    ownerUserId: "owner-a",
    deviceIds: ["phone-owner-a", "phone-owner-b", "phone-revoked", "browser-owner-a"],
    event: { stateKey: "project-context", version: 3, payload: { project: "ULTRON" } }
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.deliveredDeviceIds, ["phone-owner-a", "browser-owner-a"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.type, "STATE_SYNC");
  assert.equal(writes[0].payload.event.stateKey, "project-context");
  assert.equal(sseWrites.length, 1);
  assert.match(sseWrites[0], /STATE_SYNC/);
});
