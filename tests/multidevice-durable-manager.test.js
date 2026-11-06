import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DatabasePersistenceAdapter,
  FilePersistenceAdapter
} from "../integrations/multi-device-persistence.js";
import { MultiDeviceManager } from "../integrations/multi-device-manager.js";

function makeDeviceHub() {
  return {
    pairedDevices: new Map([
      ["phone-1", { id: "phone-1", ownerUserId: "owner-1", status: "active" }]
    ])
  };
}

test("DatabasePersistenceAdapter treats an empty successful cloud read as authoritative", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-authoritative-empty-"));
  try {
    const fallback = new FilePersistenceAdapter({ storagePath: path.join(tempDir, "fallback.json") });
    fallback.saveSync({
      devices: [["stale-phone", { id: "stale-phone", name: "Stale local device" }]],
      sharedState: [["old", { payload: { old: true }, version: 1 }]],
      pendingDeliveries: [],
      revokedDevices: []
    });
    const adapter = new DatabasePersistenceAdapter({
      fallbackAdapter: fallback,
      supabaseRest: { fetch: async () => ({ ok: true, json: async () => [] }) }
    });

    const loaded = await adapter.load();
    assert.deepEqual(loaded.devices, []);
    assert.deepEqual(loaded.sharedState, []);
    assert.equal(adapter.lastLoadOutcome.authoritative, true);
    assert.equal(adapter.lastLoadOutcome.backend, "supabase_rest");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MultiDeviceManager loads the authoritative cloud snapshot before serving state", async () => {
  const cloudSnapshot = {
    devices: [["phone-1", { id: "phone-1", name: "Cloud Phone", online: true }]],
    sharedState: [["theme", { key: "theme", payload: { mode: "dark" }, version: 7 }]],
    pendingDeliveries: [["phone-1", [{ deliveryId: "cloud-delivery" }]]],
    revokedDevices: []
  };
  const adapter = {
    async load() { return cloudSnapshot; },
    async save() { return { success: true, backend: "supabase_rest", cloudPersisted: true }; }
  };
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    deviceHub: makeDeviceHub(),
    seedDefaultFleet: false
  });

  assert.equal(await manager.ready, true);
  assert.equal(manager.getSharedEcosystemState("theme").version, 7);
  assert.equal(manager.getDevice("phone-1").name, "Cloud Phone");
  assert.equal(manager.pollPendingEvents("phone-1")[0].deliveryId, "cloud-delivery");
});

test("durable state sync commits cloud state before any device notification", async () => {
  const order = [];
  const adapter = {
    async load() { return null; },
    async save(snapshot) {
      order.push("cloud-save");
      assert.equal(snapshot.sharedState[0][0], "workspace");
      assert.equal(snapshot.pendingDeliveries[0][0], "phone-1");
      return { success: true, backend: "supabase_rest", cloudPersisted: true };
    }
  };
  const gateway = {
    dispatchStateSync({ deviceIds, event }) {
      order.push("dispatch");
      assert.deepEqual(deviceIds, ["phone-1"]);
      assert.equal(event.stateKey, "workspace");
      return { success: true, sentDeviceIds: [...deviceIds] };
    }
  };
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    deviceHub: makeDeviceHub(),
    deviceGateway: gateway,
    seedDefaultFleet: false
  });
  const localEvents = [];
  manager.subscribeDevice("phone-1", event => localEvents.push(event));

  const result = await manager.syncStateAcrossDevicesDurably({
    stateKey: "workspace",
    payload: { activeDocument: "plan.md" },
    ownerUserId: "owner-1",
    targetDevices: ["phone-1"]
  });

  assert.equal(result.success, true);
  assert.equal(result.cloudPersisted, true);
  assert.equal(result.persistenceBackend, "supabase_rest");
  assert.deepEqual(order, ["cloud-save", "dispatch"]);
  assert.equal(localEvents.length, 1);
  assert.deepEqual(result.sentToDevices, ["phone-1"]);
});

test("durable state sync rolls back and sends nothing when cloud persistence falls back locally", async () => {
  let fallbackSnapshot = null;
  let dispatchCount = 0;
  const adapter = {
    fallbackAdapter: {
      async save(snapshot) { fallbackSnapshot = snapshot; return true; }
    },
    async load() { return null; },
    async save() {
      return { success: true, backend: "fallback_file", cloudPersisted: false, warning: "DB_OFFLINE" };
    }
  };
  const gateway = {
    dispatchStateSync() {
      dispatchCount += 1;
      return { success: true, sentDeviceIds: ["phone-1"] };
    }
  };
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    deviceHub: makeDeviceHub(),
    deviceGateway: gateway,
    seedDefaultFleet: false
  });

  const result = await manager.syncStateAcrossDevicesDurably({
    stateKey: "workspace",
    payload: { activeDocument: "must-not-escape.md" },
    ownerUserId: "owner-1",
    targetDevices: ["phone-1"]
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "CLOUD_PERSISTENCE_FAILED");
  assert.equal(result.cloudPersisted, false);
  assert.equal(manager.getSharedEcosystemState("workspace"), null);
  assert.equal(manager.pollPendingEvents("phone-1").length, 0);
  assert.equal(dispatchCount, 0);
  assert.deepEqual(fallbackSnapshot.sharedState, []);
});

test("durable delivery ACK is only accepted after cloud persistence succeeds", async () => {
  const adapter = {
    async load() { return null; },
    async save() { return { success: true, backend: "database", cloudPersisted: true }; }
  };
  const manager = new MultiDeviceManager({
    persist: true,
    persistenceAdapter: adapter,
    deviceHub: makeDeviceHub(),
    seedDefaultFleet: false
  });
  manager.pendingDeliveries.set("phone-1", [{ deliveryId: "delivery-1" }]);

  const result = await manager.acknowledgeDeliveryDurably("phone-1", "delivery-1");
  assert.equal(result.success, true);
  assert.equal(result.acknowledged, true);
  assert.equal(result.cloudPersisted, true);
  assert.equal(manager.pollPendingEvents("phone-1").length, 0);
});
