import test from "node:test";
import assert from "node:assert/strict";
import {
  androidBridge,
  AndroidBridge
} from "../integrations/android-bridge.js";

test("AndroidBridge: Probes ADB environment with graceful companion fallback", async () => {
  const bridge = new AndroidBridge({ adbPath: "nonexistent-adb" });
  const probe = await bridge.probeAdbDevices();

  assert.equal(typeof probe.adbAvailable, "boolean");
  assert.equal(typeof probe.connectedCount, "number");
  assert.ok(Array.isArray(probe.serials));
});

test("AndroidBridge: Unlocks Android device via keyevent or companion protocol", async () => {
  const bridge = new AndroidBridge();
  const result = await bridge.unlockDevice("phone-android-alpha");

  assert.equal(result.success, true);
  assert.equal(result.deviceId, "phone-android-alpha");
  assert.ok(result.method);
});

test("AndroidBridge: Locks Android device screen", async () => {
  const bridge = new AndroidBridge();
  const result = await bridge.lockDevice("phone-android-beta");

  assert.equal(result.success, true);
  assert.equal(result.deviceId, "phone-android-beta");
  assert.ok(result.method);
});

test("AndroidBridge: Launches YouTube media playback intent", async () => {
  const bridge = new AndroidBridge();
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const result = await bridge.playMedia("phone-android-gamma", url);

  assert.equal(result.success, true);
  assert.equal(result.deviceId, "phone-android-gamma");
  assert.equal(result.mediaUrl, url);
});
