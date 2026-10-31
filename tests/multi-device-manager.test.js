import test from "node:test";
import assert from "node:assert/strict";
import {
  multiDeviceManager,
  MultiDeviceManager,
  DEVICE_TYPES
} from "../integrations/multi-device-manager.js";

test("MultiDeviceManager: Fleet initializes with primary PC and 3 Android mobile devices", () => {
  const mdm = new MultiDeviceManager();
  const devices = mdm.listDevices();

  assert.equal(devices.length, 4);
  assert.ok(devices.some(d => d.type === DEVICE_TYPES.WINDOWS_PC));
  const mobileCount = devices.filter(d => d.type === DEVICE_TYPES.ANDROID_SMARTPHONE).length;
  assert.equal(mobileCount, 3);
});

test("MultiDeviceManager: Simultaneously unlocks all 3 mobile devices", async () => {
  const mdm = new MultiDeviceManager();
  // Ensure all devices start locked
  mdm.listDevices({ platform: "android" }).forEach(d => d.screenLocked = true);

  const result = await mdm.unlockMobileDevices();
  assert.equal(result.success, true);
  assert.equal(result.unlockedCount, 3);
  assert.equal(result.targetedCount, 3);

  // Verify all 3 mobile devices are now unlocked
  const mobileDevices = mdm.listDevices({ platform: "android" });
  assert.ok(mobileDevices.every(d => d.screenLocked === false));
  assert.equal(mdm.commandHistory.length, 1);
});

test("MultiDeviceManager: Simultaneously locks all mobile devices", async () => {
  const mdm = new MultiDeviceManager();
  await mdm.unlockMobileDevices();

  const result = await mdm.lockMobileDevices();
  assert.equal(result.success, true);
  assert.equal(result.lockedCount, 3);

  const mobileDevices = mdm.listDevices({ platform: "android" });
  assert.ok(mobileDevices.every(d => d.screenLocked === true));
});

test("MultiDeviceManager: Simultaneously launches media playback across all capable devices", async () => {
  const mdm = new MultiDeviceManager();
  const mediaOutcome = await mdm.playMediaAcrossDevices({
    mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    query: "favorite song"
  });

  assert.equal(mediaOutcome.success, true);
  assert.ok(mediaOutcome.playingDevices >= 3);
  assert.equal(mediaOutcome.mediaUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  const mobileDevices = mdm.listDevices({ platform: "android" });
  assert.ok(mobileDevices.every(d => d.currentMedia && d.currentMedia.playing === true));
});

test("MultiDeviceManager: Disconnects and reconnects devices with status tracking", () => {
  const mdm = new MultiDeviceManager();
  const phone = "phone-android-alpha";

  const disc = mdm.disconnectDevice(phone);
  assert.equal(disc.success, true);
  assert.equal(mdm.getDevice(phone).online, false);

  const rec = mdm.reconnectDevice(phone);
  assert.equal(rec.success, true);
  assert.equal(mdm.getDevice(phone).online, true);
});
