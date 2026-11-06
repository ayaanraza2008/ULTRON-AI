import test from "node:test";
import assert from "node:assert/strict";
import { MultiDeviceManager } from "../integrations/multi-device-manager.js";
import { DeviceHub } from "../integrations/device-hub.js";

test("fleet presence uses Android's periodic sync window and the Windows companion heartbeat window", () => {
  const manager = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });
  const now = Date.now();

  const android = manager.registerDevice({
    id: "presence-android-1",
    ownerUserId: "owner-1",
    platform: "android",
    online: true,
    lastSeenAt: new Date(now - 20 * 60 * 1000).toISOString()
  });
  assert.equal(android.heartbeatTimeoutMs, 35 * 60 * 1000);
  assert.equal(manager.isDeviceOnline(android.id), true);

  const windows = manager.registerDevice({
    id: "presence-windows-1",
    ownerUserId: "owner-1",
    platform: "windows",
    online: true,
    lastSeenAt: new Date(now - 2 * 60 * 1000).toISOString()
  });
  assert.equal(windows.heartbeatTimeoutMs, 90 * 1000);
  assert.equal(manager.isDeviceOnline(windows.id), false);
  assert.equal(manager.getDevice(windows.id).online, false);
});

test("fleet presence fails closed for malformed and future heartbeat timestamps", () => {
  const manager = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });

  for (const [id, lastSeenAt] of [
    ["presence-invalid-date", "not-a-date"],
    ["presence-future-date", new Date(Date.now() + 60_000).toISOString()]
  ]) {
    manager.registerDevice({
      id,
      ownerUserId: "owner-1",
      platform: "windows",
      online: true,
      lastSeenAt
    });
    assert.equal(manager.isDeviceOnline(id), false);
    assert.equal(manager.getDevice(id).online, false);
  }
});

test("updating a paired Android fleet record refreshes presence and its platform timeout", () => {
  const manager = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });
  manager.registerDevice({
    id: "presence-android-2",
    ownerUserId: "owner-2",
    platform: "android",
    online: false
  });

  const result = manager.updateDevicePresence("presence-android-2", {
    online: true,
    heartbeatTimeoutMs: 35 * 60 * 1000,
    battery: { percent: 67, isCharging: true }
  });

  assert.equal(result.success, true);
  assert.equal(manager.isDeviceOnline("presence-android-2"), true);
  assert.equal(manager.getDevice("presence-android-2").heartbeatTimeoutMs, 35 * 60 * 1000);
  assert.equal(manager.getDevice("presence-android-2").battery.percent, 67);
});

test("DeviceHub fleet import preserves owner identity and imports offline until heartbeat", () => {
  const hub = new DeviceHub({ env: {} });
  const pairing = hub.createPairingCode({ name: "Owner Windows", platform: "windows" });
  const paired = hub.verifyPairingCode(pairing.code, null, "owner-6");
  assert.equal(paired.success, true);

  const listed = hub.listPairedDevices("owner-6");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].ownerUserId, "owner-6");
  assert.equal(listed[0].online, false);

  const manager = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });
  const imported = manager.bindWithDeviceHub(hub);
  assert.equal(imported.success, true);
  assert.equal(imported.importedCount, 1);

  const device = manager.getDevice(paired.deviceId);
  assert.equal(device.ownerUserId, "owner-6");
  assert.equal(device.online, false);
  assert.equal(manager.isDeviceOnline(paired.deviceId), false);

  assert.equal(hub.heartbeat(paired.deviceId, paired.authToken).success, true);
  const refreshed = manager.bindWithDeviceHub(hub);
  assert.equal(refreshed.success, true);
  assert.equal(manager.getDevice(paired.deviceId).online, true);
  assert.equal(manager.isDeviceOnline(paired.deviceId), true);
});

test("DeviceHub fleet import rejects an existing device ID bound to another owner", () => {
  const hub = new DeviceHub({ env: {} });
  const pairing = hub.createPairingCode({ name: "Owner Android", platform: "android" });
  const paired = hub.verifyPairingCode(pairing.code, null, "owner-7");
  assert.equal(paired.success, true);

  const manager = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });
  manager.registerDevice({
    id: paired.deviceId,
    ownerUserId: "different-owner",
    platform: "android",
    online: false
  });

  const result = manager.bindWithDeviceHub(hub);
  assert.equal(result.success, false);
  assert.equal(result.error, "DEVICE_OWNER_MISMATCH");
  assert.equal(manager.getDevice(paired.deviceId).ownerUserId, "different-owner");
});
