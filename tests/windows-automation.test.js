import test from "node:test";
import assert from "node:assert/strict";
import { WindowsAutomation } from "../system/windows-automation.js";
import os from "node:os";
import path from "node:path";

test("WindowsAutomation: getBatteryStatus returns structured power telemetry", async () => {
  const automation = new WindowsAutomation();
  const battery = await automation.getBatteryStatus();

  assert.equal(typeof battery.present, "boolean");
  assert.equal(typeof battery.percent, "number");
  assert.equal(typeof battery.isCharging, "boolean");
  assert.ok(battery.percent >= 0 && battery.percent <= 100);
});

test("WindowsAutomation: setSystemVolume validates allowed actions and responds", async () => {
  const automation = new WindowsAutomation();

  const muteResult = await automation.setSystemVolume("mute");
  assert.equal(muteResult.success, true);
  assert.equal(muteResult.action, "mute");

  const levelResult = await automation.setSystemVolume("set_level", 40);
  assert.equal(levelResult.success, true);
  assert.equal(levelResult.value, 40);

  await assert.rejects(
    async () => automation.setSystemVolume("unsupported_action"),
    /Unsupported volume action/
  );
});

test("WindowsAutomation: screen capture produces output metadata and respects Emergency Stop", async () => {
  const testSandbox = path.join(os.tmpdir(), "ultron_test_capture_" + Date.now());
  const automation = new WindowsAutomation({ sandboxBase: testSandbox });

  const capture = await automation.captureScreen("test_unit");
  assert.equal(capture.success, true);
  assert.ok(capture.path.includes("test_unit"));
  assert.ok(capture.dataUrl.startsWith("data:image/png;base64,"));

  // Verify Emergency Stop halts screen capture
  automation.setEmergencyStop(true);
  await assert.rejects(
    async () => automation.captureScreen(),
    /Emergency Stop/
  );
});

test("WindowsAutomation: lockWorkstation halts under Emergency Stop and executes safely", async () => {
  const automation = new WindowsAutomation();

  automation.setEmergencyStop(true);
  await assert.rejects(
    async () => automation.lockWorkstation(),
    /Emergency Stop/
  );

  automation.setEmergencyStop(false);
  // On non-windows or in test mode, ensure it returns safe response
  if (process.platform !== "win32") {
    const res = await automation.lockWorkstation();
    assert.equal(res.success, true);
    assert.equal(res.locked, true);
  }
});

test("WindowsAutomation: closeApprovedApp enforces allowlist and rejects unapproved processes", async () => {
  const automation = new WindowsAutomation();

  // Rejects unapproved app
  await assert.rejects(
    async () => automation.closeApprovedApp("unauthorized_app.exe"),
    /not in the approved closable allowlist/
  );

  // Accepts allowlisted app
  const res = await automation.closeApprovedApp("notepad");
  assert.equal(res.success, true);
  assert.equal(res.app, "notepad");
});

test("WindowsAutomation: getSystemVitals provides holistic client machine telemetry", async () => {
  const automation = new WindowsAutomation();
  const vitals = await automation.getSystemVitals();

  assert.equal(vitals.telemetrySource, "windows_pc");
  assert.equal(typeof vitals.activeWindow, "string");
  assert.equal(typeof vitals.ramUsagePercent, "number");
  assert.equal(typeof vitals.memoryHeadroomSafe, "boolean");
  assert.ok(vitals.battery);
});
