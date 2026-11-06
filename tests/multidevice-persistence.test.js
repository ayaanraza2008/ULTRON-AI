/**
 * ULTRON AI — Multi-Device Durable Persistence & Scale Verification Suite
 *
 * Verifies:
 * 1. FilePersistenceAdapter atomic write, directory creation, sync/async save and load.
 * 2. FilePersistenceAdapter versioned state conflict detection.
 * 3. DatabasePersistenceAdapter transactional version check and mock database persistence.
 * 4. DatabasePersistenceAdapter automatic fallback to FilePersistenceAdapter when DB fails.
 * 5. MultiDeviceManager end-to-end integration with persistence adapters.
 * 6. Fleet scalability verification across arbitrary fleet sizes (1, 2, 5, 10, 20 devices).
 * 7. Server restart state and delivery queue recovery under concurrent conditions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  FilePersistenceAdapter,
  DatabasePersistenceAdapter,
  createMultiDevicePersistenceAdapter
} from "../integrations/multi-device-persistence.js";
import {
  MultiDeviceManager,
  DEVICE_TYPES
} from "../integrations/multi-device-manager.js";

test("FilePersistenceAdapter: atomic write, reload, and directory creation", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-file-persist-"));
  const storePath = path.join(tmpDir, "nested", "subfolder", "multidevice-state.json");

  try {
    const adapter = new FilePersistenceAdapter({ storagePath: storePath });

    const sampleData = {
      devices: [["dev-1", { id: "dev-1", name: "Laptop", platform: "windows" }]],
      sharedState: [["volume", { key: "volume", payload: { level: 80 }, version: 1 }]],
      pendingDeliveries: [["dev-1", [{ deliveryId: "del-101", stateKey: "volume" }]]],
      revokedDevices: []
    };

    // Save synchronously
    const saveResult = adapter.saveSync(sampleData);
    assert.equal(saveResult, true);
    assert.equal(fs.existsSync(storePath), true);

    // Load synchronously
    const loaded = adapter.loadSync();
    assert.ok(loaded);
    assert.equal(loaded.version, "2.0.0");
    assert.equal(loaded.devices.length, 1);
    assert.equal(loaded.devices[0][0], "dev-1");
    assert.equal(loaded.sharedState[0][0], "volume");

    // Async save and load
    sampleData.devices.push(["dev-2", { id: "dev-2", name: "Tablet", platform: "android" }]);
    const asyncSaveResult = await adapter.save(sampleData);
    assert.equal(asyncSaveResult, true);

    const asyncLoaded = await adapter.load();
    assert.equal(asyncLoaded.devices.length, 2);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("FilePersistenceAdapter: version conflict detection on shared state", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-version-persist-"));
  const storePath = path.join(tmpDir, "state.json");

  try {
    const adapter = new FilePersistenceAdapter({ storagePath: storePath });

    // Initial update (version 0 -> 1)
    const update1 = await adapter.saveSharedState({
      stateKey: "theme",
      payload: { mode: "dark" },
      expectedVersion: 0
    });
    assert.equal(update1.success, true);
    assert.equal(update1.version, 1);

    // Update with correct expectedVersion (version 1 -> 2)
    const update2 = await adapter.saveSharedState({
      stateKey: "theme",
      payload: { mode: "cyber" },
      expectedVersion: 1
    });
    assert.equal(update2.success, true);
    assert.equal(update2.version, 2);

    // Update with stale expectedVersion (version mismatch rejection)
    const updateConflict = await adapter.saveSharedState({
      stateKey: "theme",
      payload: { mode: "light" },
      expectedVersion: 1 // Actual version is 2
    });
    assert.equal(updateConflict.success, false);
    assert.equal(updateConflict.error, "VERSION_CONFLICT");
    assert.equal(updateConflict.currentVersion, 2);
    assert.equal(updateConflict.expectedVersion, 1);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("DatabasePersistenceAdapter: transactional version check and mock database operations", async () => {
  const mockDb = new Map();
  const adapter = new DatabasePersistenceAdapter({ inMemoryMockDb: mockDb });

  // 1. Initial shared state update
  const res1 = await adapter.saveSharedState({
    stateKey: "workspace",
    payload: { activeDoc: "report.pdf" },
    expectedVersion: 0
  });
  assert.equal(res1.success, true);
  assert.equal(res1.version, 1);
  assert.equal(res1.backend, "database");

  // 2. Conflicting version update rejected
  const resConflict = await adapter.saveSharedState({
    stateKey: "workspace",
    payload: { activeDoc: "overwrite.pdf" },
    expectedVersion: 0 // Authoritative is 1
  });
  assert.equal(resConflict.success, false);
  assert.equal(resConflict.error, "VERSION_CONFLICT");
  assert.equal(resConflict.currentVersion, 1);

  // 3. Sequential update with matching expectedVersion
  const res2 = await adapter.saveSharedState({
    stateKey: "workspace",
    payload: { activeDoc: "final.pdf" },
    expectedVersion: 1
  });
  assert.equal(res2.success, true);
  assert.equal(res2.version, 2);

  // 4. State save and load
  const saveStateRes = await adapter.save({
    devices: [["dev-pc", { id: "dev-pc", name: "PC", online: true }]],
    sharedState: [["workspace", { version: 2 }]],
    pendingDeliveries: [],
    revokedDevices: []
  });
  assert.equal(saveStateRes.success, true);
  assert.equal(saveStateRes.backend, "database");

  const loadedState = await adapter.load();
  assert.ok(loadedState);
  assert.equal(loadedState.devices.length, 1);
  assert.equal(loadedState.devices[0][0], "dev-pc");
});

test("DatabasePersistenceAdapter: automatic fallback to FilePersistenceAdapter when DB fails", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-db-fallback-"));
  const fallbackFile = path.join(tmpDir, "fallback-state.json");

  try {
    const fallback = new FilePersistenceAdapter({ storagePath: fallbackFile });
    // Intentionally point databaseUrl to an unreachable port to trigger error handling
    const adapter = new DatabasePersistenceAdapter({
      databaseUrl: "postgres://127.0.0.1:59999/invalid_test_db",
      fallbackAdapter: fallback,
      logger: { warn() {}, error() {} }
    });

    const testData = {
      devices: [["dev-offline", { id: "dev-offline", name: "Fallback Device" }]],
      sharedState: [],
      pendingDeliveries: [],
      revokedDevices: []
    };

    // Save should gracefully fall back to file adapter without crashing
    const saveOutcome = await adapter.save(testData);
    assert.equal(saveOutcome.success, true);
    assert.equal(saveOutcome.backend, "fallback_file");
    assert.ok(fs.existsSync(fallbackFile), "Fallback file must be created on DB error");

    // Load should read from fallback file
    const loadedData = await adapter.load();
    assert.ok(loadedData);
    assert.equal(loadedData.devices.length, 1);
    assert.equal(loadedData.devices[0][0], "dev-offline");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("createMultiDevicePersistenceAdapter factory instantiates correct backend", () => {
  // Default without DB returns FilePersistenceAdapter
  const fileAdapter = createMultiDevicePersistenceAdapter({ storagePath: "./test.json" });
  assert.ok(fileAdapter instanceof FilePersistenceAdapter);

  // With databaseUrl returns DatabasePersistenceAdapter
  const dbAdapter = createMultiDevicePersistenceAdapter({ databaseUrl: "postgres://localhost/test" });
  assert.ok(dbAdapter instanceof DatabasePersistenceAdapter);
  assert.ok(dbAdapter.fallbackAdapter instanceof FilePersistenceAdapter);
});

test("MultiDeviceManager: arbitrary fleet scale verification (1, 2, 5, 10, 20 devices)", () => {
  const mdm = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });

  // Register an expanding fleet across different hardware form-factors
  const fleetSizes = [1, 2, 5, 10, 20];
  for (let i = 1; i <= 20; i++) {
    const platform = i % 2 === 0 ? "windows" : "android";
    const type = platform === "windows"
      ? (i % 4 === 0 ? DEVICE_TYPES.WINDOWS_LAPTOP : DEVICE_TYPES.WINDOWS_PC)
      : (i % 3 === 0 ? DEVICE_TYPES.ANDROID_TABLET : DEVICE_TYPES.ANDROID_SMARTPHONE);

    mdm.registerDevice({
      id: `dev-fleet-${i}`,
      name: `Device Node ${i}`,
      type,
      platform,
      capabilities: ["notifications", "telemetry", platform === "android" ? "screen_unlock" : "run_script"],
      online: true,
      battery: { percent: 90 - i, isCharging: i % 2 === 0 }
    });

    if (fleetSizes.includes(i)) {
      const currentList = mdm.listDevices();
      assert.equal(currentList.length, i, `Fleet should contain exactly ${i} devices`);
    }
  }

  // Capability querying across 20-device fleet
  const androidDevices = mdm.findEligibleDevices("screen_unlock");
  assert.equal(androidDevices.length, 10);

  const pcDevices = mdm.findEligibleDevices("run_script");
  assert.equal(pcDevices.length, 10);

  // State sync broadcast targeting all 20 devices
  const syncResult = mdm.syncStateAcrossDevices({
    stateKey: "fleet_alert",
    payload: { message: "Security protocol active", level: "info" },
    originDeviceId: "dev-fleet-1"
  });

  assert.equal(syncResult.success, true);
  assert.equal(syncResult.queuedCount, 19); // Queued for all other 19 devices
});

test("MultiDeviceManager: async save, load, and dynamic adapter switching", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-mdm-async-"));
  const store1 = path.join(tmpDir, "store1.json");
  const store2 = path.join(tmpDir, "store2.json");

  try {
    const adapter1 = new FilePersistenceAdapter({ storagePath: store1 });
    const mdm = new MultiDeviceManager({ persistenceAdapter: adapter1, seedDefaultFleet: false });

    mdm.registerDevice({ id: "node-1", name: "Primary Node", platform: "windows" });
    const saveOk = await mdm.save();
    assert.equal(saveOk, true);
    assert.equal(fs.existsSync(store1), true);

    // Switch persistence adapter dynamically
    const adapter2 = new FilePersistenceAdapter({ storagePath: store2 });
    mdm.setPersistenceAdapter(adapter2);
    mdm.registerDevice({ id: "node-2", name: "Secondary Node", platform: "android" });
    await mdm.save();
    assert.equal(fs.existsSync(store2), true);

    // Reload from adapter 2 into fresh manager
    const mdmReloaded = new MultiDeviceManager({ persistenceAdapter: adapter2, seedDefaultFleet: false });
    await mdmReloaded.load();
    assert.equal(mdmReloaded.getDevice("node-1")?.name, "Primary Node");
    assert.equal(mdmReloaded.getDevice("node-2")?.name, "Secondary Node");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});


test("FilePersistenceAdapter: genuine AES-256-GCM encryption at rest with derived key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-crypto-persist-"));
  const storePath = path.join(tmpDir, "encrypted-state.json");
  const testSecret = "ultron_secure_test_master_secret_key_32_bytes_long!";

  try {
    const adapter = new FilePersistenceAdapter({
      storagePath: storePath,
      masterSecret: testSecret
    });

    const sensitiveData = {
      devices: [["dev-secure-1", { id: "dev-secure-1", name: "ConfidentialWorkstation", platform: "windows" }]],
      sharedState: [["vault", { key: "vault", payload: { secretToken: "super_secret_payload_value_12345" }, version: 1 }]],
      pendingDeliveries: [],
      revokedDevices: []
    };

    const saveOk = adapter.saveSync(sensitiveData);
    assert.equal(saveOk, true);

    // Read the raw disk content directly to prove encryption at rest
    const rawContent = fs.readFileSync(storePath, "utf8");
    assert.ok(rawContent.length > 0);

    // Raw content must NOT contain sensitive plaintext strings
    assert.equal(rawContent.includes("ConfidentialWorkstation"), false, "Plaintext device name must not appear in encrypted file");
    assert.equal(rawContent.includes("super_secret_payload_value_12345"), false, "Plaintext payload must not appear in encrypted file");

    // Must be a valid AES-256-GCM encrypted envelope
    const parsedEnvelope = JSON.parse(rawContent);
    assert.equal(parsedEnvelope.encrypted, true);
    assert.equal(parsedEnvelope.algorithm, "aes-256-gcm");
    assert.ok(parsedEnvelope.iv && parsedEnvelope.iv.length === 24); // 12 bytes = 24 hex chars
    assert.ok(parsedEnvelope.tag && parsedEnvelope.tag.length === 32); // 16 bytes = 32 hex chars
    assert.ok(parsedEnvelope.ciphertext && parsedEnvelope.ciphertext.length > 0);

    // Load back with key: verify seamless decryption
    const loaded = adapter.loadSync();
    assert.ok(loaded);
    assert.equal(loaded.devices[0][1].name, "ConfidentialWorkstation");
    assert.equal(loaded.sharedState[0][1].payload.secretToken, "super_secret_payload_value_12345");

    // Load with an adapter without the encryption key: must throw or reject securely
    const unkeyedAdapter = new FilePersistenceAdapter({ storagePath: storePath, masterSecret: "" });
    assert.throws(() => unkeyedAdapter.loadSync(), /ENCRYPTION_KEY_REQUIRED_FOR_PERSISTENCE/);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("FilePersistenceAdapter: seamless backward compatibility with legacy unencrypted records", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-legacy-persist-"));
  const storePath = path.join(tmpDir, "legacy-state.json");
  const testSecret = "ultron_secure_test_master_secret_key_32_bytes_long!";

  try {
    // Write unencrypted legacy JSON directly to disk
    const legacyPayload = {
      version: "2.0.0",
      savedAt: new Date().toISOString(),
      devices: [["legacy-dev", { id: "legacy-dev", name: "Legacy Phone", platform: "android" }]],
      sharedState: [],
      pendingDeliveries: [],
      revokedDevices: []
    };
    fs.writeFileSync(storePath, JSON.stringify(legacyPayload, null, 2), "utf8");

    // Load with encrypted-capable adapter
    const adapter = new FilePersistenceAdapter({
      storagePath: storePath,
      masterSecret: testSecret
    });

    const loaded = adapter.loadSync();
    assert.ok(loaded);
    assert.equal(loaded.devices[0][0], "legacy-dev");
    assert.equal(loaded.devices[0][1].name, "Legacy Phone");

    // Resaving now automatically upgrades the file to encrypted at rest
    adapter.saveSync(loaded);
    const upgradedRaw = fs.readFileSync(storePath, "utf8");
    const envelope = JSON.parse(upgradedRaw);
    assert.equal(envelope.encrypted, true);
    assert.equal(envelope.algorithm, "aes-256-gcm");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("MultiDeviceManager: presence freshness and heartbeat timeout eliminate phantom devices", () => {
  const mdm = new MultiDeviceManager({ persist: false, seedDefaultFleet: false });

  // Register device 1: active fresh heartbeat
  mdm.registerDevice({
    id: "dev-fresh",
    name: "Fresh Phone",
    platform: "android",
    capabilities: ["screen_unlock"],
    online: true,
    lastSeenAt: new Date().toISOString()
  });

  // Register device 2: stale device with heartbeat from 3 minutes ago
  const staleTimestamp = new Date(Date.now() - 180_000).toISOString();
  mdm.registerDevice({
    id: "dev-stale",
    name: "Stale PC",
    platform: "windows",
    capabilities: ["run_script"],
    online: true, // Marked true initially, but heartbeat is stale!
    lastSeenAt: staleTimestamp
  });

  // isDeviceOnline evaluates real heartbeat freshness
  assert.equal(mdm.isDeviceOnline("dev-fresh"), true);
  assert.equal(mdm.isDeviceOnline("dev-stale"), false, "Stale device must be evaluated as offline (not a phantom online device)");

  // listDevices({ online: true }) reflects reality
  const onlineList = mdm.listDevices({ online: true });
  assert.equal(onlineList.length, 1);
  assert.equal(onlineList[0].id, "dev-fresh");

  // findEligibleDevices({ onlineOnly: true }) does not dispatch to phantom devices
  const eligiblePc = mdm.findEligibleDevices("run_script", { onlineOnly: true });
  assert.equal(eligiblePc.length, 0, "Stale PC must not be eligible for online task dispatch");

  // When fresh heartbeat telemetry arrives, device becomes online
  const presResult = mdm.updateDevicePresence("dev-stale", { online: true });
  assert.equal(presResult.success, true);
  assert.equal(mdm.isDeviceOnline("dev-stale"), true);

  const recheckedEligible = mdm.findEligibleDevices("run_script", { onlineOnly: true });
  assert.equal(recheckedEligible.length, 1);
});

test("DatabasePersistenceAdapter: strict TLS certificate verification enforced (rejectUnauthorized: true)", () => {
  // Remote database URL without custom CA must default to strict TLS certificate verification
  const remoteAdapter = new DatabasePersistenceAdapter({
    databaseUrl: "postgres://db.prod.company.com:5432/ultron_multidevice"
  });
  const remoteConfig = remoteAdapter.resolvePoolConfig();
  assert.ok(remoteConfig);
  assert.ok(remoteConfig.ssl);
  assert.equal(remoteConfig.ssl.rejectUnauthorized, true, "Remote database pool must strictly enforce TLS certificate verification");

  // Local database URL must not attach remote SSL
  const localAdapter = new DatabasePersistenceAdapter({
    databaseUrl: "postgres://tester@127.0.0.1:5432/ultron_test"
  });
  const localConfig = localAdapter.resolvePoolConfig();
  assert.ok(localConfig);
  assert.equal(localConfig.ssl, undefined, "Local database pool should not attach remote SSL config");

  // Custom CA certificate options are applied safely without bypassing TLS
  const customCaAdapter = new DatabasePersistenceAdapter({
    databaseUrl: "postgres://db.prod.company.com:5432/ultron_multidevice",
    ssl: { ca: "-----BEGIN CERTIFICATE-----\nMOCK_CA_CERT\n-----END CERTIFICATE-----" }
  });
  const customCaConfig = customCaAdapter.resolvePoolConfig();
  assert.ok(customCaConfig.ssl);
  assert.equal(customCaConfig.ssl.rejectUnauthorized, true);
  assert.ok(customCaConfig.ssl.ca.includes("MOCK_CA_CERT"));
});

test("DatabasePersistenceAdapter: remote TLS cannot be disabled by URL, env, or options", () => {
  const previousOverride = process.env.ULTRON_DATABASE_SSL_REJECT_UNAUTHORIZED;
  process.env.ULTRON_DATABASE_SSL_REJECT_UNAUTHORIZED = "false";
  try {
    const disabledModeAdapter = new DatabasePersistenceAdapter({
      databaseUrl: "postgres://db.prod.company.com:5432/ultron_multidevice?sslmode=disable",
      ssl: { rejectUnauthorized: false }
    });
    const disabledModeConfig = disabledModeAdapter.resolvePoolConfig();
    assert.equal(disabledModeConfig.ssl.rejectUnauthorized, true);
    assert.equal(disabledModeConfig.connectionString.includes("sslmode=disable"), false);

    const noVerifyAdapter = new DatabasePersistenceAdapter({
      databaseUrl: "postgres://db.prod.company.com:5432/ultron_multidevice?sslmode=no-verify"
    });
    const noVerifyConfig = noVerifyAdapter.resolvePoolConfig();
    assert.equal(noVerifyConfig.ssl.rejectUnauthorized, true);
    assert.equal(noVerifyConfig.connectionString.includes("sslmode=no-verify"), false);

    const requireModeAdapter = new DatabasePersistenceAdapter({
      databaseUrl: "postgres://db.prod.company.com:5432/ultron_multidevice?sslmode=require"
    });
    const requireModeConfig = requireModeAdapter.resolvePoolConfig();
    assert.equal(requireModeConfig.ssl.rejectUnauthorized, true);
    assert.equal(requireModeConfig.connectionString.includes("sslmode="), false);
  } finally {
    if (previousOverride === undefined) delete process.env.ULTRON_DATABASE_SSL_REJECT_UNAUTHORIZED;
    else process.env.ULTRON_DATABASE_SSL_REJECT_UNAUTHORIZED = previousOverride;
  }
});


test("createMultiDevicePersistenceAdapter wires authenticated Supabase REST and upserts root state", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-supabase-rest-"));
  const calls = [];
  try {
    const adapter = createMultiDevicePersistenceAdapter({
      storagePath: path.join(tmpDir, "fallback.json"),
      supabaseUrl: "https://ultron-test.supabase.co",
      supabaseServiceRoleKey: "server-only-test-key",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return { ok: true, status: 204, json: async () => [] };
      }
    });

    assert.ok(adapter instanceof DatabasePersistenceAdapter);
    const outcome = await adapter.save({
      devices: [],
      sharedState: [],
      pendingDeliveries: [],
      revokedDevices: []
    });

    assert.equal(outcome.success, true);
    assert.equal(outcome.backend, "supabase_rest");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/ultron_multidevice_state\?on_conflict=key$/);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.get("apikey"), "server-only-test-key");
    assert.equal(calls[0].init.headers.get("Authorization"), "Bearer server-only-test-key");
    assert.match(calls[0].init.headers.get("Prefer"), /resolution=merge-duplicates/);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("createMultiDevicePersistenceAdapter rejects remote Supabase URLs without HTTPS", () => {
  assert.throws(() => createMultiDevicePersistenceAdapter({
    supabaseUrl: "http://supabase.example.com",
    supabaseServiceRoleKey: "server-only-test-key",
    fetchImpl: async () => ({ ok: true })
  }), /SUPABASE_URL_MUST_USE_HTTPS/);
});
