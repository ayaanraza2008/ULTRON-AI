import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { windowsAutomation } from "../system/windows-automation.js";

describe("Windows Hardware Control Suite", () => {
  test("queries display brightness cleanly", async () => {
    const res = await windowsAutomation.getDisplayBrightness();
    assert.equal(typeof res.supported, "boolean");
    assert.ok(typeof res.brightness === "number" && res.brightness >= 0 && res.brightness <= 100);
  });

  test("sets display brightness within valid bounds", async () => {
    // Read current brightness first
    const current = await windowsAutomation.getDisplayBrightness();
    const targetLevel = current.brightness || 100;

    const setRes = await windowsAutomation.setDisplayBrightness(targetLevel);
    assert.equal(setRes.success, true);
    assert.equal(setRes.brightness, targetLevel);
  });

  test("clamps display brightness below 0 and above 100", async () => {
    const minRes = await windowsAutomation.setDisplayBrightness(-20);
    assert.equal(minRes.brightness, 0);

    const maxRes = await windowsAutomation.setDisplayBrightness(150);
    assert.equal(maxRes.brightness, 100);
  });

  test("dispatches supported virtual media keys", async () => {
    const playRes = await windowsAutomation.dispatchMediaKey("play_pause");
    assert.equal(playRes.success, true);
    assert.equal(playRes.action, "play_pause");

    const stopRes = await windowsAutomation.dispatchMediaKey("stop");
    assert.equal(stopRes.success, true);
    assert.equal(stopRes.action, "stop");
  });

  test("rejects unsupported media key action", async () => {
    await assert.rejects(
      async () => windowsAutomation.dispatchMediaKey("eject_cdrom"),
      /Unsupported media action/
    );
  });

  test("handles window state changes", async () => {
    const minRes = await windowsAutomation.setWindowState("restore");
    assert.equal(minRes.success, true);
    assert.equal(minRes.action, "restore");
  });

  test("rejects unsupported window state action", async () => {
    await assert.rejects(
      async () => windowsAutomation.setWindowState("explode"),
      /Unsupported window action/
    );
  });

  test("queries GPU hardware information", async () => {
    const gpu = await windowsAutomation.getGpuInfo();
    assert.ok(typeof gpu.name === "string" && gpu.name.length > 0);
    assert.ok(typeof gpu.vramBytes === "number" && gpu.vramBytes >= 0);
  });

  test("getSystemVitals includes brightness and GPU telemetry", async () => {
    const vitals = await windowsAutomation.getSystemVitals();
    assert.equal(vitals.telemetrySource, "windows_pc");
    assert.ok(vitals.gpu && typeof vitals.gpu.name === "string");
    assert.ok(vitals.brightness && typeof vitals.brightness.brightness === "number");
    assert.ok(typeof vitals.ramUsagePercent === "number");
    assert.equal(typeof vitals.memoryHeadroomSafe, "boolean");
  });

  test("blocks actions when Emergency Stop is engaged", async () => {
    windowsAutomation.setEmergencyStop(true);
    await assert.rejects(
      async () => windowsAutomation.setDisplayBrightness(80),
      /Emergency Stop/
    );
    await assert.rejects(
      async () => windowsAutomation.dispatchMediaKey("play_pause"),
      /Emergency Stop/
    );
    await assert.rejects(
      async () => windowsAutomation.setWindowState("minimize"),
      /Emergency Stop/
    );
    windowsAutomation.setEmergencyStop(false);
  });
});
