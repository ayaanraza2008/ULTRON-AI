import test from "node:test";
import assert from "node:assert/strict";
import { MultiDeviceManager } from "../integrations/multi-device-manager.js";

function emptySnapshot() {
  return { devices: [], sharedState: [], pendingDeliveries: [], revokedDevices: [] };
}

function makeAdapter({ load = emptySnapshot, save = async () => ({
  success: true,
  backend: "supabase_rest",
  cloudPersisted: true
}) } = {}) {
  const writes = [];
  return {
    writes,
    async load() { return load(); },
    async save(snapshot) {
      writes.push(structuredClone(snapshot));
      return save(snapshot);
    }
  };
}

test("Database-backed device lifecycle requires awaited cloud commits", async () => {
  const adapter = makeAdapter();
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    seedDefaultFleet: false
  });
  assert.equal(await manager.ready, true);
  assert.equal(manager.saveToDisk(), false);

  const blockedRegister = manager.registerDevice({
    id: "phone-lifecycle-1",
    name: "Lifecycle Phone",
    platform: "android"
  });
  assert.equal(blockedRegister.success, false);
  assert.equal(blockedRegister.error, "ASYNC_PERSISTENCE_REQUIRED");
  assert.equal(manager.getDevice("phone-lifecycle-1"), null);

  const registered = await manager.registerDeviceDurably({
    id: "phone-lifecycle-1",
    name: "Lifecycle Phone",
    platform: "android"
  });
  assert.equal(registered.success, true);
  assert.equal(registered.cloudPersisted, true);
  assert.equal(manager.getDevice("phone-lifecycle-1").name, "Lifecycle Phone");

  const blockedPresence = manager.updateDevicePresence("phone-lifecycle-1", { online: true });
  assert.equal(blockedPresence.success, false);
  assert.equal(blockedPresence.error, "ASYNC_PERSISTENCE_REQUIRED");

  const presence = await manager.updateDevicePresenceDurably("phone-lifecycle-1", {
    online: true,
    battery: { percent: 71, isCharging: false }
  });
  assert.equal(presence.success, true);
  assert.equal(presence.cloudPersisted, true);
  assert.equal(manager.getDevice("phone-lifecycle-1").battery.percent, 71);

  const blockedRevoke = manager.revokeDevice("phone-lifecycle-1", "test");
  assert.equal(blockedRevoke.success, false);
  assert.equal(blockedRevoke.error, "ASYNC_PERSISTENCE_REQUIRED");
  assert.ok(manager.getDevice("phone-lifecycle-1"));

  const revoked = await manager.revokeDeviceDurably("phone-lifecycle-1", "test");
  assert.equal(revoked.success, true);
  assert.equal(revoked.cloudPersisted, true);
  assert.equal(manager.getDevice("phone-lifecycle-1"), null);
  assert.ok(manager.revokedDevices.has("phone-lifecycle-1"));
  assert.equal(adapter.writes.length, 3);
  assert.ok(adapter.writes[2].revokedDevices.includes("phone-lifecycle-1"));
});

test("Android device commands persist the resulting state before returning success", async () => {
  const order = [];
  const adapter = makeAdapter({
    load: () => ({
      ...emptySnapshot(),
      devices: [[
        "phone-android-1",
        {
          id: "phone-android-1",
          name: "Android Phone",
          platform: "android",
          online: true,
          lastSeenAt: new Date().toISOString(),
          heartbeatTimeoutMs: 90_000,
          capabilities: ["media_playback"],
          screenLocked: true
        }
      ]]
    }),
    save: async () => {
      order.push("cloud-save");
      return { success: true, backend: "supabase_rest", cloudPersisted: true };
    }
  });
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    seedDefaultFleet: false,
    androidBridge: {
      async unlockDevice() { order.push("unlock"); return { success: true }; },
      async lockDevice() { order.push("lock"); return { success: true }; },
      async playMedia() { order.push("media"); return { success: true }; }
    }
  });
  assert.equal(await manager.ready, true);
  manager.devices.get("phone-android-1").online = true;
  manager.devices.get("phone-android-1").lastSeenAt = new Date().toISOString();

  const unlocked = await manager.unlockMobileDevices();
  assert.equal(unlocked.success, true);
  assert.equal(unlocked.cloudPersisted, true);
  assert.equal(manager.getDevice("phone-android-1").screenLocked, false);
  assert.deepEqual(order.slice(0, 2), ["unlock", "cloud-save"]);

  const locked = await manager.lockMobileDevices();
  assert.equal(locked.success, true);
  assert.equal(locked.cloudPersisted, true);
  assert.equal(manager.getDevice("phone-android-1").screenLocked, true);
  assert.deepEqual(order.slice(2, 4), ["lock", "cloud-save"]);

  const media = await manager.playMediaAcrossDevices({ query: "ambient focus" });
  assert.equal(media.success, true);
  assert.equal(media.cloudPersisted, true);
  assert.deepEqual(order.slice(4, 6), ["media", "cloud-save"]);
});

test("Android command reports possible execution when cloud state commit fails", async () => {
  let bridgeCalled = false;
  const adapter = makeAdapter({
    load: () => ({
      ...emptySnapshot(),
      devices: [[
        "phone-android-2",
        {
          id: "phone-android-2",
          name: "Second Android Phone",
          platform: "android",
          online: true,
          lastSeenAt: new Date().toISOString(),
          heartbeatTimeoutMs: 90_000,
          capabilities: ["media_playback"],
          screenLocked: true
        }
      ]]
    }),
    save: async () => ({
      success: true,
      backend: "database",
      cloudPersisted: false,
      warning: "MOCK_DATABASE_ONLY"
    })
  });
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    seedDefaultFleet: false,
    androidBridge: {
      async unlockDevice() {
        bridgeCalled = true;
        return { success: true };
      }
    }
  });
  assert.equal(await manager.ready, true);
  manager.devices.get("phone-android-2").online = true;
  manager.devices.get("phone-android-2").lastSeenAt = new Date().toISOString();

  const result = await manager.unlockMobileDevices();
  assert.equal(bridgeCalled, true);
  assert.equal(result.success, false);
  assert.equal(result.error, "DEVICE_PERSISTENCE_FAILED");
  assert.equal(result.cloudPersisted, false);
  assert.equal(result.actionMayHaveExecuted, true);
  assert.equal(manager.getDevice("phone-android-2").screenLocked, true);
});


test("Switching to a database adapter waits for its authoritative cloud state", async () => {
  const initialAdapter = makeAdapter();
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: initialAdapter,
    seedDefaultFleet: false
  });
  await manager.ready;
  manager.registerDevice({
    id: "old-local-device",
    name: "Old Local Device",
    platform: "windows"
  });

  const cloudAdapter = makeAdapter({
    load: () => ({
      ...emptySnapshot(),
      devices: [[
        "cloud-device",
        {
          id: "cloud-device",
          name: "Cloud Authoritative Device",
          platform: "android",
          online: false,
          lastSeenAt: new Date().toISOString()
        }
      ]]
    })
  });
  const ready = manager.setPersistenceAdapter(cloudAdapter);
  assert.equal(await ready, true);
  assert.equal(manager.getDevice("cloud-device").name, "Cloud Authoritative Device");
  assert.equal(manager.getDevice("old-local-device"), null);
});

test("Binding a DeviceHub to a database-backed manager imports only after cloud commit", async () => {
  const adapter = makeAdapter();
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    seedDefaultFleet: false
  });
  await manager.ready;

  const binding = await manager.bindWithDeviceHub({
    listPairedDevices: () => [{
      id: "paired-browser-1",
      name: "Owner Browser",
      platform: "browser",
      capabilities: { notifications: true, telemetry: true },
      online: true
    }]
  });

  assert.equal(binding.success, true);
  assert.equal(binding.cloudPersisted, true);
  assert.equal(binding.importedCount, 1);
  assert.equal(manager.getDevice("paired-browser-1").platform, "browser");
  assert.equal(adapter.writes.length, 1);
});
