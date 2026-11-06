import test from "node:test";
import assert from "node:assert/strict";
import {
  multiDeviceManager,
  MultiDeviceManager,
  DEVICE_TYPES
} from "../integrations/multi-device-manager.js";

function createTestManager() {
  return new MultiDeviceManager({
    persist: false,
    androidBridge: {
      async unlockDevice(deviceId) { return { success: true, deviceId }; },
      async lockDevice(deviceId) { return { success: true, deviceId }; },
      async playMedia(deviceId, mediaUrl, query) { return { success: true, deviceId, mediaUrl, query }; }
    }
  });
}

test("MultiDeviceManager: Fleet initializes with primary PC and 3 Android mobile devices", () => {
  const mdm = createTestManager();
  const devices = mdm.listDevices();

  assert.equal(devices.length, 4);
  assert.ok(devices.some(d => d.type === DEVICE_TYPES.WINDOWS_PC));
  const mobileCount = devices.filter(d => d.type === DEVICE_TYPES.ANDROID_SMARTPHONE).length;
  assert.equal(mobileCount, 3);
});

test("MultiDeviceManager: Simultaneously unlocks all 3 mobile devices", async () => {
  const mdm = createTestManager();
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
  const mdm = createTestManager();
  await mdm.unlockMobileDevices();

  const result = await mdm.lockMobileDevices();
  assert.equal(result.success, true);
  assert.equal(result.lockedCount, 3);

  const mobileDevices = mdm.listDevices({ platform: "android" });
  assert.ok(mobileDevices.every(d => d.screenLocked === true));
});

test("MultiDeviceManager: Simultaneously launches media playback across all capable devices", async () => {
  const mdm = createTestManager();
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

test("MultiDeviceManager: Does not fake Android success without a real bridge", async () => {
  const mdm = new MultiDeviceManager({ persist: false });
  const unlock = await mdm.unlockMobileDevices();
  const lock = await mdm.lockMobileDevices();
  const media = await mdm.playMediaAcrossDevices({ mediaUrl: "https://example.com/media.mp3" });
  assert.equal(unlock.success, false);
  assert.equal(unlock.error, "ANDROID_BRIDGE_UNAVAILABLE");
  assert.equal(lock.success, false);
  assert.equal(lock.error, "ANDROID_BRIDGE_UNAVAILABLE");
  assert.equal(media.success, false);
  assert.equal(media.error, "ANDROID_BRIDGE_UNAVAILABLE");
});

test("MultiDeviceManager: Disconnects and reconnects devices with status tracking", () => {
  const mdm = createTestManager();
  const phone = "phone-android-alpha";

  const disc = mdm.disconnectDevice(phone);
  assert.equal(disc.success, true);
  assert.equal(mdm.getDevice(phone).online, false);

  const rec = mdm.reconnectDevice(phone);
  assert.equal(rec.success, true);
  assert.equal(mdm.getDevice(phone).online, true);
});
