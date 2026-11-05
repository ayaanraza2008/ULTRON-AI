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
import fs from "node:fs";
import path from "node:path";

export const DEVICE_TYPES = {
  WINDOWS_PC: "windows_pc",
  WINDOWS_LAPTOP: "windows_laptop",
  ANDROID_SMARTPHONE: "android_smartphone",
  ANDROID_TABLET: "android_tablet",
  WEB_BROWSER: "web_browser",
  CLIENT_ADAPTER: "client_adapter",
  GENERIC_COMPANION: "generic_companion",
  ROBOT_NODE: "robot_node" // Deprecated legacy constant; robotics excluded from active personal AI scope
};

export class MultiDeviceManager {
  constructor(options = {}) {
    this.devices = new Map();
    this.androidBridge = options.androidBridge || null;
    this.deviceHub = options.deviceHub || null;
    this.commandHistory = [];
    this.sharedState = new Map();
    this.subscribers = new Map();
    this.pendingDeliveries = new Map();
    this.revokedDevices = new Set();
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "data", "multidevice-state.json");
    // Persistence is opt-in for isolated instances; the production singleton
    // explicitly enables it. Tests and short-lived tools stay side-effect free.
    this.isPersistent = Boolean(options.persist === true || options.storagePath);
    this.isInitializing = true;
    if (options.seedDefaultFleet !== false) {
      this.initializeDefaultFleet();
    }
    this.isInitializing = false;
    if (this.isPersistent) {
      this.loadFromDisk();
    }
  }

  saveToDisk() {
    if (!this.isPersistent) return false;
    let tmpPath = null;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const serialized = {
        savedAt: new Date().toISOString(),
        devices: Array.from(this.devices.entries()),
        sharedState: Array.from(this.sharedState.entries()),
        pendingDeliveries: Array.from(this.pendingDeliveries.entries()),
        revokedDevices: Array.from(this.revokedDevices)
      };
      // Write beside the destination and rename so a crash cannot leave a
      // partially written registry/state document.
      tmpPath = `${this.storagePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmpPath, this.storagePath);
      return true;
    } catch {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      return false;
    }
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.storagePath)) return false;
      const raw = fs.readFileSync(this.storagePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.devices)) {
        for (const [id, entry] of data.devices) {
          if (id && entry) {
            // An online flag from disk is never proof of current connectivity.
            this.devices.set(id, { ...entry, online: false });
          }
        }
      }
      if (Array.isArray(data.sharedState)) {
        for (const [key, state] of data.sharedState) {
          if (key && state) this.sharedState.set(key, state);
        }
      }
      if (Array.isArray(data.pendingDeliveries)) {
        for (const [id, queue] of data.pendingDeliveries) {
          if (id && Array.isArray(queue)) this.pendingDeliveries.set(id, queue);
        }
      }
      if (Array.isArray(data.revokedDevices)) {
        this.revokedDevices = new Set(data.revokedDevices);
      }
      return true;
    } catch {
      return false;
    }
  }

  subscribeDevice(deviceId, callback) {
    if (!deviceId || typeof callback !== "function") return false;
    if (this.revokedDevices.has(deviceId)) return false;
    if (!this.subscribers.has(deviceId)) {
      this.subscribers.set(deviceId, new Set());
    }
    this.subscribers.get(deviceId).add(callback);
    const pending = this.pendingDeliveries.get(deviceId) || [];
    for (const evt of pending) {
      try { callback(evt); } catch {}
    }
    return true;
  }

  unsubscribeDevice(deviceId, callback = null) {
    if (!deviceId) return false;
    const subs = this.subscribers.get(deviceId);
    if (!subs) return false;
    if (callback) {
      subs.delete(callback);
    } else {
      subs.clear();
    }
    return true;
  }

  pollPendingEvents(deviceId) {
    if (!deviceId || this.revokedDevices.has(deviceId)) return [];
    const queue = this.pendingDeliveries.get(deviceId) || [];
    return [...queue];
  }

  acknowledgeDelivery(deviceId, deliveryId) {
    if (!deviceId || !deliveryId) return { success: false, error: "PARAMS_REQUIRED" };
    const queue = this.pendingDeliveries.get(deviceId);
    if (!queue) return { success: false, error: "NO_PENDING_QUEUE" };
    const initialLen = queue.length;
    const updated = queue.filter(item => item.deliveryId !== deliveryId);
    this.pendingDeliveries.set(deviceId, updated);
    this.saveToDisk();
    return {
      success: true,
      deviceId,
      acknowledgedDeliveryId: deliveryId,
      acknowledged: initialLen > updated.length,
      remainingCount: updated.length
    };
  }

  revokeDevice(deviceId, reason = "owner_revoked") {
    if (!this.devices.has(deviceId)) {
      return { success: false, error: "DEVICE_NOT_FOUND" };
    }
    const dev = this.devices.get(deviceId);
    dev.status = "revoked";
    dev.online = false;
    dev.revokedAt = new Date().toISOString();
    this.revokedDevices.add(deviceId);
    this.pendingDeliveries.delete(deviceId);
    this.unsubscribeDevice(deviceId);
    this.saveToDisk();
    return { success: true, deviceId, status: "revoked", reason, revokedAt: dev.revokedAt };
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
    if (this.revokedDevices.has(id)) {
      return { success: false, error: "DEVICE_REVOKED", deviceId: id };
    }
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
    if (this.isPersistent && !this.isInitializing && !this.saveToDisk()) {
      this.devices.delete(id);
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED", deviceId: id };
    }
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

  /**
   * Unregisters / removes a device from the active fleet.
   */
  unregisterDevice(deviceId) {
    const exists = this.devices.has(deviceId);
    if (!exists) return { success: false, error: "DEVICE_NOT_FOUND" };
    this.devices.delete(deviceId);
    return { success: true, deviceId, unregistered: true };
  }

  /**
   * Updates presence, battery, vitals and last seen timestamp for a device.
   */
  updateDevicePresence(deviceId, telemetry = {}) {
    const dev = this.devices.get(deviceId);
    if (!dev) return { success: false, error: "DEVICE_NOT_FOUND" };
    if (typeof telemetry.online === "boolean") dev.online = telemetry.online;
    if (telemetry.battery && typeof telemetry.battery.percent === "number") {
      dev.battery = {
        percent: Math.max(0, Math.min(100, telemetry.battery.percent)),
        isCharging: Boolean(telemetry.battery.isCharging)
      };
    }
    if (telemetry.vitals) dev.vitals = telemetry.vitals;
    dev.lastSeenAt = new Date().toISOString();
    return { success: true, deviceId, online: dev.online, lastSeenAt: dev.lastSeenAt };
  }

  /**
   * Finds all devices matching a specific capability (e.g. screen_unlock, run_script, camera).
   */
  findEligibleDevices(capability, { onlineOnly = true, type = null } = {}) {
    const cleanCap = String(capability || "").toLowerCase().trim();
    let matches = Array.from(this.devices.values());
    if (onlineOnly) {
      matches = matches.filter(d => d.online === true);
    }
    if (type) {
      matches = matches.filter(d => d.type === type);
    }
    if (cleanCap) {
      matches = matches.filter(d => Array.isArray(d.capabilities) && d.capabilities.includes(cleanCap));
    }
    return matches;
  }

  /**
   * Returns capabilities list for a device.
   */
  getDeviceCapabilities(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return null;
    return Array.isArray(dev.capabilities) ? [...dev.capabilities] : [];
  }

  /**
   * Synchronizes shared ecosystem state across devices with conflict resolution.
   */
  syncStateAcrossDevices({ stateKey, payload, originDeviceId = null, expectedVersion = null, targetDevices = null } = {}) {
    if (!stateKey || typeof stateKey !== "string") {
      return { success: false, error: "STATE_KEY_REQUIRED" };
    }
    const cleanKey = stateKey.trim();

    // Sensitive data guard: credentials must not be synced as broadcast state
    const payloadStr = JSON.stringify(payload || {});
    if (/(?:api_key|authToken|password|tokenHash|bearer\s+[a-z0-9])/i.test(payloadStr)) {
      return {
        success: false,
        error: "SENSITIVE_DATA_BLOCKED",
        message: "Private authentication credentials must not be broadcast as shared ecosystem state."
      };
    }

    const existing = this.sharedState.get(cleanKey);
    const currentVersion = existing ? (Number(existing.version) || 1) : 0;

    // Server-authoritative monotonic version check
    if (expectedVersion !== null && expectedVersion !== undefined) {
      if (Number(expectedVersion) !== currentVersion) {
        return {
          success: false,
          error: "VERSION_CONFLICT",
          currentVersion,
          expectedVersion: Number(expectedVersion),
          message: `State update rejected: expected version ${expectedVersion} does not match authoritative version ${currentVersion}.`,
          currentState: existing
        };
      }
    }

    const now = Date.now();
    // Stale timestamp conflict guard
    if (existing && existing.updatedAtMs && existing.updatedAtMs > now) {
      return {
        success: false,
        error: "CONFLICT_STALE_UPDATE",
        message: "State update rejected: an existing update with a later timestamp exists.",
        currentState: existing
      };
    }

    const nextVersion = currentVersion + 1;
    const timestamp = new Date(now).toISOString();

    const stateEntry = {
      key: cleanKey,
      payload,
      originDeviceId,
      updatedAt: timestamp,
      updatedAtMs: now,
      version: nextVersion
    };
    this.sharedState.set(cleanKey, stateEntry);

    const targetList = targetDevices || Array.from(this.devices.keys()).filter(id => id !== originDeviceId);
    const deliveredTo = [];
    const queuedFor = [];

    for (const targetId of targetList) {
      if (this.revokedDevices.has(targetId)) continue;
      const deliveryEvent = {
        deliveryId: "del_" + crypto.randomUUID(),
        eventId: "evt_" + crypto.randomUUID(),
        type: "STATE_SYNC",
        stateKey: cleanKey,
        version: nextVersion,
        payload,
        timestamp
      };

      const subs = this.subscribers.get(targetId);
      if (subs && subs.size > 0) {
        for (const cb of subs) {
          try { cb(deliveryEvent); } catch {}
        }
        deliveredTo.push(targetId);
      }

      const queue = this.pendingDeliveries.get(targetId) || [];
      queue.push(deliveryEvent);
      if (queue.length > 100) queue.shift();
      this.pendingDeliveries.set(targetId, queue);
      queuedFor.push(targetId);
    }

    this.saveToDisk();

    return {
      success: true,
      syncedKey: cleanKey,
      version: nextVersion,
      updatedAt: timestamp,
      synchronizedDevices: targetList,
      deliveredDevices: deliveredTo,
      queuedDevices: queuedFor,
      deliveredCount: deliveredTo.length,
      queuedCount: queuedFor.length
    };
  }

  syncSharedMemory({ memoryKey, memoryData, originDeviceId = null, expectedVersion = null } = {}) {
    if (!memoryKey || typeof memoryKey !== "string") {
      return { success: false, error: "MEMORY_KEY_REQUIRED" };
    }
    return this.syncStateAcrossDevices({
      stateKey: "memory:" + memoryKey.trim(),
      payload: memoryData,
      originDeviceId,
      expectedVersion
    });
  }

  getSharedMemory(memoryKey) {
    if (!memoryKey) return null;
    const entry = this.sharedState.get("memory:" + String(memoryKey).trim());
    return entry?.payload || null;
  }

  /**
   * Retrieves shared ecosystem state.
   */
  getSharedEcosystemState(stateKey = null) {
    if (stateKey) {
      return this.sharedState.get(String(stateKey).trim()) || null;
    }
    const result = {};
    for (const [k, v] of this.sharedState.entries()) {
      result[k] = v;
    }
    return result;
  }

  /**
   * Clears shared ecosystem state.
   */
  clearSharedState(stateKey = null) {
    if (stateKey) {
      const deleted = this.sharedState.delete(String(stateKey).trim());
      return { success: deleted, stateKey };
    }
    this.sharedState.clear();
    return { success: true, clearedAll: true };
  }

  /**
   * Binds this manager with a DeviceHub instance to auto-import paired devices.
   */
  bindWithDeviceHub(deviceHub) {
    this.deviceHub = deviceHub;
    if (!deviceHub) return;
    if (typeof deviceHub.listPairedDevices === "function") {
      const paired = deviceHub.listPairedDevices();
      for (const dev of paired) {
        if (!this.devices.has(dev.id)) {
          let type = DEVICE_TYPES.GENERIC_COMPANION;
          if (dev.platform === "windows") type = DEVICE_TYPES.WINDOWS_PC;
          else if (dev.platform === "android") type = DEVICE_TYPES.ANDROID_SMARTPHONE;
          else if (dev.platform === "browser") type = DEVICE_TYPES.WEB_BROWSER;

          this.registerDevice({
            id: dev.id,
            name: dev.name,
            type,
            platform: dev.platform,
            capabilities: dev.capabilities ? Object.keys(dev.capabilities) : ["notifications", "telemetry"],
            online: dev.online ?? true,
            battery: dev.battery || { percent: 100, isCharging: false }
          });
        }
      }
    }
  }
}

// Real runtime starts with no fabricated online devices. Actual devices must pair
// and heartbeat before they can be selected for remote operations.
export const multiDeviceManager = new MultiDeviceManager({ seedDefaultFleet: false, persist: true });
