import test from "node:test";
import assert from "node:assert/strict";
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
