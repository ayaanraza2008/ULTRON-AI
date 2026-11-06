import test from "node:test";
import assert from "node:assert/strict";
import { MultiDeviceManager } from "../integrations/multi-device-manager.js";

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
