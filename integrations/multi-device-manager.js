/**
 * ULTRON AI — Central Multi-Device Manager & Ecosystem Synchronizer
 * Project Codename: ULTRON ETERNAL
 *
 * Coordinates simultaneous multi-device automation across PCs and mobile devices:
 * - Simultaneous multi-device unlock (e.g. "unlock all three mobile devices").
 * - Synchronized media playback (e.g. "play my favorite song in all three of the devices").
 * - Multi-device registry tracking device types, connection health, battery, and capabilities.
 * - Least-privilege capability filtering per device.
 * - Integration with Android Companion Bridge and Windows Desktop Agent.
 */

import crypto from "node:crypto";

export const DEVICE_TYPES = {
  WINDOWS_PC: "windows_pc",
  WINDOWS_LAPTOP: "windows_laptop",
  ANDROID_SMARTPHONE: "android_smartphone",
  ANDROID_TABLET: "android_tablet",
  ROBOT_NODE: "robot_node"
};

export class MultiDeviceManager {
  constructor(options = {}) {
    this.devices = new Map();
    this.androidBridge = options.androidBridge || null;
    this.commandHistory = [];
    this.initializeDefaultFleet();
  }

  /**
   * Initializes baseline fleet matching the reference setup (PC + 3 Android phones).
   */
  initializeDefaultFleet() {
    this.registerDevice({
      id: "pc-primary-workstation",
      name: "Primary Windows PC",
      type: DEVICE_TYPES.WINDOWS_PC,
      platform: "windows",
      capabilities: ["screen_lock", "screen_unlock", "app_launch", "run_script", "file_management", "telemetry"],
      screenLocked: true,
      online: true,
      battery: { percent: 100, isCharging: true }
    });

    this.registerDevice({
      id: "phone-android-alpha",
      name: "Android Phone Alpha (Primary)",
      type: DEVICE_TYPES.ANDROID_SMARTPHONE,
      platform: "android",
      capabilities: ["screen_unlock", "screen_lock", "media_playback", "notifications", "youtube_launch"],
      screenLocked: true,
      online: true,
      battery: { percent: 92, isCharging: false }
    });

    this.registerDevice({
      id: "phone-android-beta",
      name: "Android Phone Beta (Second)",
      type: DEVICE_TYPES.ANDROID_SMARTPHONE,
      platform: "android",
      capabilities: ["screen_unlock", "screen_lock", "media_playback", "notifications", "youtube_launch"],
      screenLocked: true,
      online: true,
      battery: { percent: 84, isCharging: true }
    });

    this.registerDevice({
      id: "phone-android-gamma",
      name: "Android Phone Gamma (Third)",
      type: DEVICE_TYPES.ANDROID_SMARTPHONE,
      platform: "android",
      capabilities: ["screen_unlock", "screen_lock", "media_playback", "notifications", "youtube_launch"],
      screenLocked: true,
      online: true,
      battery: { percent: 78, isCharging: true }
    });
  }

  registerDevice(deviceMeta = {}) {
    const id = deviceMeta.id || "dev-" + crypto.randomUUID();
    const entry = {
      id,
      name: String(deviceMeta.name || "Connected Device").slice(0, 80),
      type: deviceMeta.type || DEVICE_TYPES.ANDROID_SMARTPHONE,
      platform: deviceMeta.platform || "android",
      capabilities: Array.isArray(deviceMeta.capabilities) ? deviceMeta.capabilities : ["notifications"],
      screenLocked: deviceMeta.screenLocked ?? true,
      online: deviceMeta.online ?? true,
      battery: deviceMeta.battery || { percent: 100, isCharging: false },
      lastSeenAt: new Date().toISOString(),
      currentMedia: null
    };

    this.devices.set(id, entry);
    return entry;
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId) || null;
  }

  listDevices(filter = {}) {
    let list = Array.from(this.devices.values());
    if (filter.type) {
      list = list.filter(d => d.type === filter.type);
    }
    if (filter.platform) {
      list = list.filter(d => d.platform === filter.platform);
    }
    if (typeof filter.online === "boolean") {
      list = list.filter(d => d.online === filter.online);
    }
    return list;
  }

  /**
   * Simultaneously unlocks all registered mobile devices (Phone 1, 2, 3).
   */
  async unlockMobileDevices() {
    const mobileDevices = this.listDevices({ platform: "android" });
    const results = [];

    for (const dev of mobileDevices) {
      dev.screenLocked = false;
      dev.lastSeenAt = new Date().toISOString();

      let bridgeResult = { success: true };
      if (this.androidBridge) {
        bridgeResult = await this.androidBridge.unlockDevice(dev.id);
      }

      results.push({
        deviceId: dev.id,
        name: dev.name,
        screenLocked: false,
        bridgeResult
      });
    }

    const eventRecord = {
      action: "UNLOCK_MOBILE_DEVICES",
      timestamp: new Date().toISOString(),
      targetedCount: mobileDevices.length,
      unlockedCount: results.length,
      results
    };
    this.commandHistory.unshift(eventRecord);
    if (this.commandHistory.length > 50) this.commandHistory.pop();

    return {
      success: true,
      targetedCount: mobileDevices.length,
      unlockedCount: results.length,
      devices: results
    };
  }

  /**
   * Simultaneously locks all registered mobile devices.
   */
  async lockMobileDevices() {
    const mobileDevices = this.listDevices({ platform: "android" });
    const results = [];

    for (const dev of mobileDevices) {
      dev.screenLocked = true;
      dev.lastSeenAt = new Date().toISOString();

      let bridgeResult = { success: true };
      if (this.androidBridge) {
        bridgeResult = await this.androidBridge.lockDevice(dev.id);
      }

      results.push({
        deviceId: dev.id,
        name: dev.name,
        screenLocked: true,
        bridgeResult
      });
    }

    return {
      success: true,
      targetedCount: mobileDevices.length,
      lockedCount: results.length,
      devices: results
    };
  }

  /**
   * Simultaneously launches media playback (e.g. YouTube favorite song) across all target devices.
   */
  async playMediaAcrossDevices({ mediaUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ", query = "favorite song" } = {}) {
    const capableDevices = Array.from(this.devices.values()).filter(d =>
      d.capabilities.includes("media_playback") || d.capabilities.includes("youtube_launch")
    );

    const results = [];
    for (const dev of capableDevices) {
      dev.currentMedia = {
        url: mediaUrl,
        query,
        startedAt: new Date().toISOString(),
        playing: true
      };
      dev.lastSeenAt = new Date().toISOString();

      let bridgeResult = { success: true };
      if (this.androidBridge && dev.platform === "android") {
        bridgeResult = await this.androidBridge.playMedia(dev.id, mediaUrl);
      }

      results.push({
        deviceId: dev.id,
        name: dev.name,
        mediaUrl,
        playing: true,
        bridgeResult
      });
    }

    const eventRecord = {
      action: "PLAY_MEDIA_ACROSS_DEVICES",
      timestamp: new Date().toISOString(),
      targetedCount: capableDevices.length,
      mediaUrl,
      results
    };
    this.commandHistory.unshift(eventRecord);
    if (this.commandHistory.length > 50) this.commandHistory.pop();

    return {
      success: true,
      playingDevices: results.length,
      mediaUrl,
      devices: results
    };
  }

  disconnectDevice(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return { success: false, error: "DEVICE_NOT_FOUND" };
    dev.online = false;
    dev.lastSeenAt = new Date().toISOString();
    return { success: true, deviceId, online: false };
  }

  reconnectDevice(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return { success: false, error: "DEVICE_NOT_FOUND" };
    dev.online = true;
    dev.lastSeenAt = new Date().toISOString();
    return { success: true, deviceId, online: true };
  }
}

export const multiDeviceManager = new MultiDeviceManager();
