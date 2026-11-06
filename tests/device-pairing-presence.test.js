import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceHub } from "../integrations/device-hub.js";

test("verified pairing remains offline until the companion sends an authenticated heartbeat", () => {
  const hub = new DeviceHub({ env: {} });
  const pairing = hub.createPairingCode({ name: "Windows workstation", platform: "windows" });
  const paired = hub.verifyPairingCode(pairing.code, null, "owner-1");

  assert.equal(paired.success, true);
  assert.equal(hub.pairedDevices.get(paired.deviceId).online, false);
  assert.equal(hub.isDeviceOnline(paired.deviceId), false);
  assert.equal(hub.getDevicePresence(paired.deviceId).online, false);
  assert.equal(hub.listPairedDevices("owner-1")[0].online, false);

  // Token authentication alone is not a liveness signal.
  assert.ok(hub.authenticateDevice(paired.deviceId, paired.authToken));
  assert.equal(hub.isDeviceOnline(paired.deviceId), false);

  const heartbeat = hub.heartbeat(paired.deviceId, paired.authToken, { batteryPercent: 81 });
  assert.equal(heartbeat.success, true);
  assert.equal(heartbeat.online, true);
  assert.equal(hub.isDeviceOnline(paired.deviceId), true);
  assert.equal(hub.getDevicePresence(paired.deviceId).online, true);
  assert.equal(hub.listPairedDevices("owner-1")[0].online, true);
});

test("owner-approved pairing remains offline until the claimed companion heartbeats", () => {
  const hub = new DeviceHub({ env: {} });
  const pairing = hub.createPairingCode({ name: "Android companion", platform: "android" });
  const approved = hub.approvePairingCode(pairing.code, "owner-2");

  assert.equal(approved.success, true);
  assert.equal(hub.pairedDevices.get(approved.deviceId).online, false);
  assert.equal(hub.isDeviceOnline(approved.deviceId), false);

  const claimed = hub.claimPairingCode(pairing.code);
  assert.equal(claimed.success, true);
  assert.equal(claimed.deviceId, approved.deviceId);
  assert.equal(hub.isDeviceOnline(claimed.deviceId), false);

  const heartbeat = hub.heartbeat(claimed.deviceId, claimed.deviceToken);
  assert.equal(heartbeat.success, true);
  assert.equal(hub.isDeviceOnline(claimed.deviceId), true);
});

test("importing a durable pairing record never restores stale online presence", () => {
  const hub = new DeviceHub({ env: {} });
  const token = "ultron_dev_" + "a".repeat(64);
  const imported = hub.importPairedDevice({
    id: "durable-device-1",
    ownerUserId: "owner-3",
    authToken: token,
    status: "active",
    online: true,
    lastSeenAt: new Date().toISOString()
  });

  assert.ok(imported);
  assert.equal(imported.online, false);
  assert.equal(hub.isDeviceOnline(imported.id), false);

  const heartbeat = hub.heartbeat(imported.id, token);
  assert.equal(heartbeat.success, true);
  assert.equal(hub.isDeviceOnline(imported.id), true);
});

test("re-importing the same paired identity preserves only its fresh in-process heartbeat", () => {
  const hub = new DeviceHub({ env: {} });
  const token = "ultron_dev_" + "b".repeat(64);
  const identity = {
    id: "windows-live-session",
    ownerUserId: "owner-4",
    authToken: token,
    status: "active",
    platform: "windows"
  };

  const imported = hub.importPairedDevice(identity);
  assert.equal(imported.online, false);

  const heartbeat = hub.heartbeat(identity.id, token);
  assert.equal(heartbeat.success, true);
  const lastSeenAt = hub.pairedDevices.get(identity.id).lastSeenAt;

  // A subsequent authenticated HTTP request re-imports the DB record. Its
  // stored timestamp must not erase the fresh in-process liveness signal.
  const reimported = hub.importPairedDevice({
    ...identity,
    online: false,
    lastSeenAt: null
  });
  assert.equal(reimported.online, true);
  assert.equal(reimported.lastSeenAt, lastSeenAt);

  // A rotated credential or changed owner must not inherit the previous session.
  const rotated = hub.importPairedDevice({
    ...identity,
    authToken: "ultron_dev_" + "c".repeat(64)
  });
  assert.equal(rotated.online, false);
});

test("cached device presence uses the real platform heartbeat windows and rejects future timestamps", () => {
  const hub = new DeviceHub({ env: {} });
  const androidToken = "ultron_dev_" + "d".repeat(64);
  const windowsToken = "ultron_dev_" + "e".repeat(64);
  const now = Date.now();

  hub.importPairedDevice({
    id: "android-presence-window",
    ownerUserId: "owner-5",
    authToken: androidToken,
    platform: "android",
    status: "active"
  });
  hub.heartbeat("android-presence-window", androidToken);
  hub.pairedDevices.get("android-presence-window").lastSeenAt =
    new Date(now - 20 * 60 * 1000).toISOString();
  assert.equal(hub.isDeviceOnline("android-presence-window"), true);

  hub.pairedDevices.get("android-presence-window").lastSeenAt =
    new Date(now - 36 * 60 * 1000).toISOString();
  assert.equal(hub.isDeviceOnline("android-presence-window"), false);

  hub.importPairedDevice({
    id: "windows-presence-window",
    ownerUserId: "owner-5",
    authToken: windowsToken,
    platform: "windows",
    status: "active"
  });
  hub.heartbeat("windows-presence-window", windowsToken);
  hub.pairedDevices.get("windows-presence-window").lastSeenAt =
    new Date(now - 2 * 60 * 1000).toISOString();
  assert.equal(hub.isDeviceOnline("windows-presence-window"), false);

  hub.pairedDevices.get("android-presence-window").online = true;
  hub.pairedDevices.get("android-presence-window").lastSeenAt =
    new Date(now + 60 * 1000).toISOString();
  assert.equal(hub.isDeviceOnline("android-presence-window"), false);
});


test("durable pairing and approval fail closed when the registry cannot be written", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-device-pairing-fail-"));
  const blockedPath = path.join(tempDir, "blocked-registry");
  fs.mkdirSync(blockedPath);
  try {
    const hub = new DeviceHub({
      env: {},
      durableStoragePath: blockedPath,
      masterSecret: "ultron-test-device-signing-secret-0123456789"
    });
    assert.equal(hub.isPersistent, true);

    const pairing = hub.createPairingCode({ name: "Pairing persistence test", platform: "windows" });
    const verified = hub.verifyPairingCode(pairing.code, null, "owner-persist-1");
    assert.equal(verified.success, false);
    assert.equal(verified.error, "DEVICE_PERSISTENCE_FAILED");
    assert.equal(hub.pairedDevices.size, 0);
    assert.equal(hub.pendingPairings.has(pairing.code), true);

    const approvalPairing = hub.createPairingCode({ name: "Approval persistence test", platform: "android" });
    const approved = hub.approvePairingCode(approvalPairing.code, "owner-persist-1");
    assert.equal(approved.success, false);
    assert.equal(approved.error, "DEVICE_PERSISTENCE_FAILED");
    assert.equal(hub.pairedDevices.size, 0);
    assert.equal(hub.pendingPairings.get(approvalPairing.code).approved, undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("durable revoke, token rotation and unpair roll back when registry writes fail", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-device-mutation-fail-"));
  const registryPath = path.join(tempDir, "paired-devices.json");
  const blockedPath = path.join(tempDir, "blocked-registry");
  fs.mkdirSync(blockedPath);
  try {
    const hub = new DeviceHub({
      env: {},
      durableStoragePath: registryPath,
      masterSecret: "ultron-test-device-signing-secret-0123456789"
    });
    const pairing = hub.createPairingCode({ name: "Durability test device", platform: "windows" });
    const paired = hub.verifyPairingCode(pairing.code, null, "owner-persist-2");
    assert.equal(paired.success, true);
    const device = hub.pairedDevices.get(paired.deviceId);
    const originalToken = device.authToken;
    hub.commandQueue.set(paired.deviceId, [{ id: "queued-command" }]);

    hub.durableStoragePath = blockedPath;
    const revoked = hub.revokeDevice(paired.deviceId, "owner-persist-2");
    assert.equal(revoked.success, false);
    assert.equal(revoked.error, "DEVICE_PERSISTENCE_FAILED");
    assert.equal(device.status, "active");
    assert.equal(hub.revokedDevices.has(paired.deviceId), false);
    assert.equal(hub.commandQueue.get(paired.deviceId).length, 1);

    const rotated = hub.rotateDeviceToken(paired.deviceId, "owner-persist-2");
    assert.equal(rotated.success, false);
    assert.equal(rotated.error, "DEVICE_PERSISTENCE_FAILED");
    assert.equal(rotated.newDeviceToken, undefined);
    assert.equal(device.authToken, originalToken);
    assert.ok(hub.authenticateDevice(paired.deviceId, originalToken));

    const unpaired = hub.unpairDevice(paired.deviceId);
    assert.equal(unpaired.success, false);
    assert.equal(unpaired.error, "DEVICE_PERSISTENCE_FAILED");
    assert.equal(hub.pairedDevices.has(paired.deviceId), true);
    assert.equal(hub.commandQueue.get(paired.deviceId).length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
