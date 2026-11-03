import test from "node:test";
import assert from "node:assert/strict";
import { AdbBridge } from "../mobile/adb-bridge.js";

test("AdbBridge: discovers ADB executable on Windows host", async () => {
  const bridge = new AdbBridge();
  const availability = await bridge.checkAvailability();

  assert.ok(typeof availability.available === "boolean");
  if (availability.available) {
    assert.ok(availability.path, "Available ADB must report an executable path");
    assert.ok(availability.version, "Available ADB must report version string");
    assert.ok(availability.version.length > 0, "Version must be non-empty");
  }
});

test("AdbBridge: parses device list correctly across online, unauthorized, and offline states", () => {
  const bridge = new AdbBridge();

  const sampleOutput = `List of devices attached
emulator-5554	device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64xa transport_id:1
R5CR30XYZAB	unauthorized transport_id:2
192.168.1.105:5555	offline transport_id:3
`;

  const devices = bridge.parseDeviceList(sampleOutput);
  assert.equal(devices.length, 3);

  // Device 1: Online emulator
  assert.equal(devices[0].id, "emulator-5554");
  assert.equal(devices[0].state, "online");
  assert.equal(devices[0].connectionType, "emulator");
  assert.equal(devices[0].model, "sdk_gphone64_arm64");

  // Device 2: Unauthorized USB phone
  assert.equal(devices[1].id, "R5CR30XYZAB");
  assert.equal(devices[1].state, "unauthorized");
  assert.equal(devices[1].connectionType, "usb");

  // Device 3: Offline Wi-Fi device
  assert.equal(devices[2].id, "192.168.1.105:5555");
  assert.equal(devices[2].state, "offline");
  assert.equal(devices[2].connectionType, "wifi");
});

test("AdbBridge: sanitizes arguments against command injection and shell metacharacters", () => {
  const bridge = new AdbBridge();

  // Safe parameters should pass
  assert.doesNotThrow(() => bridge.sanitizeArg("com.google.android.youtube", "package"));
  assert.doesNotThrow(() => bridge.sanitizeArg("https://example.com", "url"));
  assert.doesNotThrow(() => bridge.sanitizeArg("1080", "coordinate"));

  // Malicious injections must be rejected
  assert.throws(() => bridge.sanitizeArg("calc.exe; rm -rf /", "package"), /INVALID_ARGUMENT/);
  assert.throws(() => bridge.sanitizeArg("app && reboot", "package"), /INVALID_ARGUMENT/);
  assert.throws(() => bridge.sanitizeArg("device|echo pwned", "deviceId"), /INVALID_ARGUMENT/);
  assert.throws(() => bridge.sanitizeArg("`whoami`", "text"), /INVALID_ARGUMENT/);
  assert.throws(() => bridge.sanitizeArg("$(id)", "text"), /INVALID_ARGUMENT/);
});

test("AdbBridge: parses foreground activity cleanly", () => {
  const bridge = new AdbBridge();

  const dumpsysOutput = `  mCurrentFocus=Window{8b79f88 u0 com.google.android.youtube/com.google.android.apps.youtube.app.watchwhile.WatchWhileActivity}`;
  const parsed = bridge.parseForegroundActivity(dumpsysOutput);

  assert.equal(parsed.package, "com.google.android.youtube");
  assert.equal(parsed.activity, "com.google.android.apps.youtube.app.watchwhile.WatchWhileActivity");
});
