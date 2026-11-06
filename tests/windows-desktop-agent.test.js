import test from "node:test";
import assert from "node:assert/strict";
import {
  windowsDesktopAgent,
  WindowsDesktopAgent,
  DESKTOP_SCREEN_STATE
} from "../system/windows-desktop-agent.js";
import { DeviceHub } from "../integrations/device-hub.js";

test("WindowsDesktopAgent: Registers with central DeviceHub", async () => {
  const hub = new DeviceHub();
  const agent = new WindowsDesktopAgent({
    deviceId: "test-pc-node",
    deviceName: "Test Engineering PC"
  });

  const reg = await agent.register(hub);
  assert.equal(reg.success, true);
  assert.equal(agent.registered, true);
  assert.ok(agent.authToken);
});

test("WindowsDesktopAgent: Remote unlock fails closed and lock reports its execution mode", async () => {
  const events = [];
  const agent = new WindowsDesktopAgent({
    onStateChange: (e) => events.push(e)
  });

  assert.equal(agent.screenState, DESKTOP_SCREEN_STATE.LOCKED);

  const unlock = await agent.unlockScreen();
  assert.equal(unlock.success, false);
  assert.equal(unlock.error, "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION");
  assert.equal(agent.screenState, DESKTOP_SCREEN_STATE.LOCKED);
  assert.equal(events.length, 0);

  const lock = await agent.lockScreen();
  assert.equal(lock.success, true);
  assert.equal(agent.screenState, DESKTOP_SCREEN_STATE.LOCKED);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "SYSTEM_LOCKED");
  assert.equal(events[0].theme, "reactor_blue_locked");
  assert.equal(lock.simulated, process.platform !== "win32");
});

test("WindowsDesktopAgent: Gathers real system storage, RAM and CPU vitals", async () => {
  const agent = new WindowsDesktopAgent();
  const vitals = await agent.getSystemVitals();

  assert.ok(vitals.deviceId);
  assert.ok(typeof vitals.cpus === "number");
  assert.ok(vitals.totalRamGb > 0);
  assert.ok(vitals.storageAvailableGb === null || vitals.storageAvailableGb > 0);
  assert.ok(vitals.battery);
});

test("WindowsDesktopAgent: Project status reports measured metadata without fabricated test results", async () => {
  const agent = new WindowsDesktopAgent({ projectRoot: process.cwd() });
  const status = await agent.checkProjectStatus();

  assert.equal(status.success, true);
  assert.ok(status.repository.detected);
  assert.ok(status.repository.branch);
  assert.match(status.repository.commitSha, /^[a-f0-9]{40}$/);
  assert.equal(status.tests.state, "NOT_RUN");
  assert.equal(status.status, "INSPECTION_ONLY_UNVERIFIED");
  assert.equal(Object.hasOwn(status, "testsTotal"), false);
  assert.equal(agent.executionHistory.length, 1);
});
