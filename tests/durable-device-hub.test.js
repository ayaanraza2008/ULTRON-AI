import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DeviceHub } from "../integrations/device-hub.js";

test("Durable DeviceHub: Complete lifecycle, restart recovery, token hashing, and revocation", async (t) => {
  const tmpDir = path.join(os.tmpdir(), "ultron-devicehub-test-" + Date.now());
  const storePath = path.join(tmpDir, "paired-devices.json");

  await t.test("pairing, single-use claim, and token hashing", () => {
    const hub = new DeviceHub({ durableStoragePath: storePath, env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" } });

    // Step 1: Create pairing code
    const pairing = hub.createPairingCode({ name: "Windows Companion PC", platform: "windows" });
    assert.equal(typeof pairing.code, "string");
    assert.equal(pairing.code.length, 6);

    // Step 2: Owner approves
    const approved = hub.approvePairingCode(pairing.code, "owner-uuid-1234");
    assert.equal(approved.success, true);
    assert.ok(approved.deviceId);
    assert.ok(approved.deviceToken);

    // Step 3: Companion claims
    const claimed = hub.claimPairingCode(pairing.code);
    assert.equal(claimed.success, true);
    assert.equal(claimed.deviceId, approved.deviceId);
    assert.equal(claimed.deviceToken, approved.deviceToken);

    // Step 4: Claiming again MUST fail closed (single-use)
    const doubleClaim = hub.claimPairingCode(pairing.code);
    assert.equal(doubleClaim.success, false);
    assert.equal(doubleClaim.error, "INVALID_PAIRING_CODE");

    // Step 5: Verify disk store exists and does NOT contain plaintext token
    assert.ok(fs.existsSync(storePath), "Durable storage file must be created on disk");
    const rawDisk = fs.readFileSync(storePath, "utf8");
    assert.ok(!rawDisk.includes(approved.deviceToken), "Plaintext device token must NEVER be written to disk");
    assert.ok(rawDisk.includes("tokenHash"), "Durable store must contain tokenHash");
  });

  await t.test("restart recovery: second DeviceHub instance reloads paired device without plaintext token on disk", () => {
    // Instantiate brand new DeviceHub instance pointing to same file (simulating server restart)
    const hubRestarted = new DeviceHub({ durableStoragePath: storePath, env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" } });

    const devices = hubRestarted.listPairedDevices("owner-uuid-1234");
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, "Windows Companion PC");
    assert.equal(devices[0].platform, "windows");
    assert.equal(devices[0].status, "active");

    // Read stored token hash
    const rawDisk = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const deviceId = rawDisk.devices[0].id;

    // Verify authentication using decrypted token
    const devRecord = hubRestarted.pairedDevices.get(deviceId);
    assert.ok(devRecord.authToken, "Decrypted token must be restored in memory from AES-256-GCM cipher");

    const authCheck = hubRestarted.authenticateDevice(deviceId, devRecord.authToken);
    assert.ok(authCheck, "Device authentication must succeed after server restart");
    assert.equal(authCheck.id, deviceId);

    const lookupCheck = hubRestarted.findDeviceByToken(devRecord.authToken);
    assert.ok(lookupCheck, "findDeviceByToken must succeed after server restart");
    assert.equal(lookupCheck.id, deviceId);
  });

  await t.test("cryptographic command signing and verification across server restart", () => {
    const hub = new DeviceHub({ durableStoragePath: storePath, env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" } });
    const devices = hub.listPairedDevices();
    const deviceId = devices[0].id;
    const devRecord = hub.pairedDevices.get(deviceId);
    const token = devRecord.authToken;

    // Enqueue command
    const enq = hub.enqueueCommand(deviceId, "execute_approved_action", { action: "open_calc" });
    assert.equal(enq.success, true);
    assert.ok(enq.command.signature);

    // Verify signature
    const isValid = hub.verifySignature(token, {
      id: enq.command.id,
      deviceId: enq.command.deviceId,
      action: enq.command.action,
      payload: enq.command.payload,
      createdAt: enq.command.createdAt,
      expiresAt: enq.command.expiresAt
    }, enq.command.signature);
    assert.equal(isValid, true);

    // Poll and complete
    const poll = hub.pollPendingCommands(deviceId, token);
    assert.equal(poll.commands.length, 1);
    const done = hub.completeCommand(deviceId, enq.command.id, token, { success: true });
    assert.equal(done.success, true);
  });

  await t.test("token rotation and device revocation", () => {
    const hub = new DeviceHub({ durableStoragePath: storePath, env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" } });
    const devices = hub.listPairedDevices();
    const deviceId = devices[0].id;
    const oldToken = hub.pairedDevices.get(deviceId).authToken;

    // Rotate token
    const rotated = hub.rotateDeviceToken(deviceId, "owner-uuid-1234");
    assert.equal(rotated.success, true);
    assert.ok(rotated.newDeviceToken);
    assert.notEqual(rotated.newDeviceToken, oldToken);

    // Old token MUST now be rejected
    assert.equal(hub.authenticateDevice(deviceId, oldToken), null);
    // New token MUST be accepted
    assert.ok(hub.authenticateDevice(deviceId, rotated.newDeviceToken));

    // Revoke device
    const revoked = hub.revokeDevice(deviceId, "owner-uuid-1234");
    assert.equal(revoked.success, true);
    assert.equal(revoked.status, "revoked");

    // Revoked device cannot authenticate even with new token
    assert.equal(hub.authenticateDevice(deviceId, rotated.newDeviceToken), null);
    assert.equal(hub.findDeviceByToken(rotated.newDeviceToken), null);
  });

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test("DeviceHub refuses durable persistence without a dedicated encryption secret", () => {
  const tmpDir = path.join(os.tmpdir(), "ultron-devicehub-no-secret-" + Date.now());
  const storePath = path.join(tmpDir, "paired-devices.json");
  const hub = new DeviceHub({
    durableStoragePath: storePath,
    env: { SUPABASE_SERVICE_ROLE_KEY: "service-role-key-must-not-be-reused-for-device-encryption" }
  });

  assert.equal(hub.isPersistent, false);
  assert.equal(hub.persistenceError, "ULTRON_DEVICE_SIGNING_SECRET_REQUIRED_MIN_32_CHARS");
  assert.equal(hub.saveToDisk(), false);
  assert.equal(fs.existsSync(storePath), false);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test("DeviceHub direct verification binds the authenticated owner", () => {
  const hub = new DeviceHub({ env: {} });
  const pairing = hub.createPairingCode({ name: "Owner A device", platform: "windows" });
  const verified = hub.verifyPairingCode(pairing.code, null, "owner-a");
  assert.equal(verified.success, true);
  assert.equal(hub.listPairedDevices("owner-a").length, 1);
  assert.equal(hub.listPairedDevices("owner-b").length, 0);
});

test("paired-device migration does not expose unapproved short pairing codes to authenticated clients", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20261101180000_durable_paired_devices.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.pending_device_pairings\s+from\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+all\s+on\s+table\s+public\.pending_device_pairings\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /approved\s*=\s*false/i);
  assert.match(sql, /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.paired_devices\s+from\s+anon\s*,\s*authenticated/i);
});
