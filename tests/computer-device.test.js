import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { WindowsComputerControl } from "../system/computer-control.js";
import { DeviceHub } from "../integrations/device-hub.js";

test("Computer Control: system telemetry reports CPU and RAM bounds", () => {
  const ctrl = new WindowsComputerControl();
  const telemetry = ctrl.getSystemTelemetry();

  assert.equal(telemetry.platform, process.platform);
  assert.equal(telemetry.architecture, process.arch);
  assert.equal(telemetry.executionEnvironment, "server_process");
  assert.ok(telemetry.cpuCores >= 1);
  assert.ok(telemetry.memory.totalBytes > 0);
  assert.ok(telemetry.memory.usedPercent >= 0 && telemetry.memory.usedPercent <= 100);
  assert.equal(typeof telemetry.memory.memoryPressureWarning, "boolean");
});

test("Computer Control: sandboxed file operations prevent path traversal", async () => {
  const testDir = path.join(os.tmpdir(), "ultron-test-sandbox-" + Date.now());
  const ctrl = new WindowsComputerControl({ sandboxBase: testDir });
  await ctrl.initialize();

  // Writing and reading valid file
  await ctrl.writeFile("notes.txt", "ULTRON personal assistant test note.");
  const read = await ctrl.readFile("notes.txt");
  assert.equal(read.content, "ULTRON personal assistant test note.");

  const list = await ctrl.listFiles();
  assert.ok(list.some(f => f.name === "notes.txt"));

  // Path traversal attempt MUST fail closed
  await assert.rejects(async () => {
    await ctrl.readFile("../../../Windows/System32/drivers/etc/hosts");
  }, /Path traversal violation/);

  // A sibling whose name shares the sandbox prefix must also be rejected.
  assert.throws(() => {
    ctrl.resolveSafePath("../" + path.basename(testDir) + "-outside/secret.txt");
  }, /Path traversal violation/);

  // Clean up
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
});

test("Computer Control: symbolic-link traversal is denied for reads, writes, and listings", async t => {
  const root = path.join(os.tmpdir(), "ultron-symlink-root-" + Date.now());
  const outside = path.join(os.tmpdir(), "ultron-symlink-outside-" + Date.now());
  const ctrl = new WindowsComputerControl({ sandboxBase: root });
  await ctrl.initialize();
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "secret.txt"), "outside-secret", "utf8");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await fs.symlink(outside, path.join(root, "linked"), linkType);
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
    t.skip("The test runner does not permit creating directory symlinks: " + error.code);
    return;
  }

  await assert.rejects(() => ctrl.readFile("linked/secret.txt"), /Symbolic-link traversal violation|ELOOP/);
  await assert.rejects(() => ctrl.writeFile("linked/pwned.txt", "must-not-write"), /Symbolic-link traversal violation|ELOOP/);
  await assert.rejects(() => ctrl.listFiles("linked"), /Symbolic-link traversal violation|ELOOP/);
  assert.equal(await fs.readFile(path.join(outside, "secret.txt"), "utf8"), "outside-secret");
  await assert.rejects(() => fs.readFile(path.join(outside, "pwned.txt"), "utf8"), { code: "ENOENT" });

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test("Computer Control: command allowlist permits safe commands and blocks arbitrary commands", async () => {
  const ctrl = new WindowsComputerControl();

  const safe = await ctrl.runApprovedCommand("node --version");
  assert.equal(safe.exitCode, 0);
  assert.ok(safe.stdout.startsWith("v"));

  await assert.rejects(async () => {
    await ctrl.runApprovedCommand("powershell -Command Remove-Item -Force C:\\");
  }, /not in the approved command allowlist/);
});

test("Device Hub: pairing workflow, telemetry, and notifications", () => {
  const hub = new DeviceHub();

  const pairing = hub.createPairingCode({ name: "Ayaan Samsung Galaxy S24", platform: "android" });
  assert.ok(pairing.code);
  assert.equal(pairing.code.length, 6);

  const verified = hub.verifyPairingCode(pairing.code);
  assert.equal(verified.success, true);
  assert.ok(verified.deviceId);
  assert.ok(verified.authToken);

  // Authenticate device
  const auth = hub.authenticateDevice(verified.deviceId, verified.authToken);
  assert.ok(auth);
  assert.equal(auth.name, "Ayaan Samsung Galaxy S24");

  // Telemetry update
  const updated = hub.updateDeviceTelemetry(verified.deviceId, { batteryPercent: 88, isCharging: true });
  assert.equal(updated, true);

  const devices = hub.listPairedDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].battery.percent, 88);
  assert.equal(devices[0].battery.isCharging, true);

  // Send notification
  const notif = hub.sendNotification({
    deviceId: verified.deviceId,
    title: "JARVIS Task Complete",
    body: "System integrity scan finished with zero defects."
  });
  assert.equal(notif.delivered, true);
  assert.equal(hub.getNotifications().length, 1);
});

test("Device Hub: cryptographically signed command queueing, polling, and completion", () => {
  const hub = new DeviceHub();

  const pairing = hub.createPairingCode({ name: "Ayaan Samsung Tab S9", platform: "android" });
  const verified = hub.verifyPairingCode(pairing.code);
  const deviceId = verified.deviceId;
  const token = verified.authToken;

  // Enqueue command
  const enq = hub.enqueueCommand(deviceId, "trigger_vibrate", { pattern: [100, 200, 100] });
  assert.equal(enq.success, true);
  assert.ok(enq.command.id);
  assert.ok(enq.command.signature);

  // Verify HMAC signature
  const rawPayload = {
    id: enq.command.id,
    deviceId: enq.command.deviceId,
    action: enq.command.action,
    payload: enq.command.payload,
    createdAt: enq.command.createdAt,
    expiresAt: enq.command.expiresAt
  };
  const isSigValid = hub.verifySignature(token, rawPayload, enq.command.signature);
  assert.equal(isSigValid, true);

  // Tampered payload fails verification
  const isTamperedValid = hub.verifySignature(token, { ...rawPayload, action: "format_storage" }, enq.command.signature);
  assert.equal(isTamperedValid, false);

  // Companion device polls for pending commands
  const poll = hub.pollPendingCommands(deviceId, token);
  assert.equal(poll.success, true);
  assert.equal(poll.commands.length, 1);
  assert.equal(poll.commands[0].action, "trigger_vibrate");

  // Companion completes command
  const done = hub.completeCommand(deviceId, enq.command.id, token, { executed: true });
  assert.equal(done.success, true);
  assert.equal(done.status, "completed");

  // Re-poll shows 0 pending
  const pollEmpty = hub.pollPendingCommands(deviceId, token);
  assert.equal(pollEmpty.commands.length, 0);
});
