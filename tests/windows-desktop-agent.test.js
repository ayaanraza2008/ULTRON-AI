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

test("WindowsDesktopAgent: Screen unlock and lock transitions with callback notifications", async () => {
  const events = [];
  const agent = new WindowsDesktopAgent({
    onStateChange: (e) => events.push(e)
  });

  assert.equal(agent.screenState, DESKTOP_SCREEN_STATE.LOCKED);

  // Unlock screen
  const unlock = await agent.unlockScreen();
  assert.equal(unlock.success, true);
  assert.equal(agent.screenState, DESKTOP_SCREEN_STATE.UNLOCKED);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "SYSTEM_UNLOCKED");
  assert.equal(events[0].theme, "reactor_orange_active");

  // Lock screen
  const lock = await agent.lockScreen();
  assert.equal(lock.success, true);
  assert.equal(agent.screenState, DESKTOP_SCREEN_STATE.LOCKED);
  assert.equal(events.length, 2);
  assert.equal(events[1].event, "SYSTEM_LOCKED");
  assert.equal(events[1].theme, "reactor_blue_locked");
});

test("WindowsDesktopAgent: Gathers real system storage, RAM and CPU vitals", async () => {
  const agent = new WindowsDesktopAgent();
  const vitals = await agent.getSystemVitals();

  assert.ok(vitals.deviceId);
  assert.ok(typeof vitals.cpus === "number");
  assert.ok(vitals.totalRamGb > 0);
  assert.ok(vitals.storageAvailableGb > 0);
  assert.ok(vitals.battery);
});

test("WindowsDesktopAgent: Runs safe project status check and logs history", async () => {
  const agent = new WindowsDesktopAgent();
  const status = await agent.checkProjectStatus();

  assert.equal(status.success, true);
  assert.equal(status.repo, "ayaanraza2008/ULTRON-AI");
  assert.equal(status.testsTotal, 800);
  assert.equal(status.status, "HEALTHY");
  assert.equal(agent.executionHistory.length, 1);
});
