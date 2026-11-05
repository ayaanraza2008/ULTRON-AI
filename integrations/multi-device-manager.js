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
import { deviceHub as defaultDeviceHub } from "./device-hub.js";
import { deviceWebSocketGateway as defaultDeviceGateway } from "./device-websocket-gateway.js";

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
    this.deviceHub = options.deviceHub || defaultDeviceHub;
    this.deviceGateway = options.deviceGateway || defaultDeviceGateway;
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
    if (options.registerDeliveryAckHandler === true && typeof this.deviceGateway?.setStateSyncAckHandler === "function") {
      this.deviceGateway.setStateSyncAckHandler(({ deviceId, ownerUserId, deliveryId }) => {
        const paired = this.deviceHub?.pairedDevices?.get(deviceId);
        if (!paired || paired.status === "revoked" || paired.ownerUserId !== ownerUserId) {
          return { success: false, error: "DEVICE_OWNER_MISMATCH" };
        }
        return this.acknowledgeDelivery(deviceId, deliveryId);
      });
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
    const device = this.devices.get(deviceId);
    if (!device || this.revokedDevices.has(deviceId) || device.status === "revoked") return null;
    return device;
  }

  listDevices(filter = {}) {
    let list = Array.from(this.devices.values()).filter(device =>
      !this.revokedDevices.has(device.id) && device.status !== "revoked"
    );
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
    const mobileDevices = this.listDevices({ platform: "android", online: true });
    if (!mobileDevices.length) {
      return { success: false, error: "NO_ONLINE_ANDROID_DEVICES", targetedCount: 0, unlockedCount: 0, devices: [] };
    }
    if (!this.androidBridge || typeof this.androidBridge.unlockDevice !== "function") {
      return {
        success: false, error: "ANDROID_BRIDGE_UNAVAILABLE",
        targetedCount: mobileDevices.length, unlockedCount: 0,
        devices: mobileDevices.map(dev => ({ deviceId: dev.id, name: dev.name, success: false, error: "ANDROID_BRIDGE_UNAVAILABLE" }))
      };
    }
    const results = [];
    for (const dev of mobileDevices) {
      try {
        const bridgeResult = await this.androidBridge.unlockDevice(dev.id);
        const acknowledged = bridgeResult === true || bridgeResult?.success === true;
        if (acknowledged) {
          dev.screenLocked = false;
          dev.lastSeenAt = new Date().toISOString();
        }
        results.push({ deviceId: dev.id, name: dev.name, success: acknowledged, screenLocked: acknowledged ? false : dev.screenLocked, bridgeResult });
      } catch (error) {
        results.push({ deviceId: dev.id, name: dev.name, success: false, error: "ANDROID_UNLOCK_FAILED", message: String(error?.message || "Android unlock failed").slice(0, 200) });
      }
    }
    const unlockedCount = results.filter(result => result.success).length;
    const failedCount = results.length - unlockedCount;
    this.commandHistory.unshift({ action: "UNLOCK_MOBILE_DEVICES", timestamp: new Date().toISOString(), targetedCount: mobileDevices.length, unlockedCount, failedCount, results });
    if (this.commandHistory.length > 50) this.commandHistory.pop();
    if (this.isPersistent && unlockedCount > 0 && !this.saveToDisk()) {
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED", targetedCount: mobileDevices.length, unlockedCount: 0, failedCount: mobileDevices.length, devices: results };
    }
    return {
      success: failedCount === 0 && unlockedCount > 0,
      targetedCount: mobileDevices.length, unlockedCount, failedCount, devices: results,
      ...(failedCount > 0 ? { error: "ANDROID_UNLOCK_PARTIAL_FAILURE" } : {})
    };
  }

  async lockMobileDevices() {
    const mobileDevices = this.listDevices({ platform: "android", online: true });
    if (!mobileDevices.length) {
      return { success: false, error: "NO_ONLINE_ANDROID_DEVICES", targetedCount: 0, lockedCount: 0, devices: [] };
    }
    if (!this.androidBridge || typeof this.androidBridge.lockDevice !== "function") {
      return {
        success: false, error: "ANDROID_BRIDGE_UNAVAILABLE",
        targetedCount: mobileDevices.length, lockedCount: 0,
        devices: mobileDevices.map(dev => ({ deviceId: dev.id, name: dev.name, success: false, error: "ANDROID_BRIDGE_UNAVAILABLE" }))
      };
    }
    const results = [];
    for (const dev of mobileDevices) {
      try {
        const bridgeResult = await this.androidBridge.lockDevice(dev.id);
        const acknowledged = bridgeResult === true || bridgeResult?.success === true;
        if (acknowledged) {
          dev.screenLocked = true;
          dev.lastSeenAt = new Date().toISOString();
        }
        results.push({ deviceId: dev.id, name: dev.name, success: acknowledged, screenLocked: acknowledged ? true : dev.screenLocked, bridgeResult });
      } catch (error) {
        results.push({ deviceId: dev.id, name: dev.name, success: false, error: "ANDROID_LOCK_FAILED", message: String(error?.message || "Android lock failed").slice(0, 200) });
      }
    }
    const lockedCount = results.filter(result => result.success).length;
    const failedCount = results.length - lockedCount;
    if (this.isPersistent && lockedCount > 0 && !this.saveToDisk()) {
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED", targetedCount: mobileDevices.length, lockedCount: 0, failedCount: mobileDevices.length, devices: results };
    }
    return {
      success: failedCount === 0 && lockedCount > 0,
      targetedCount: mobileDevices.length, lockedCount, failedCount, devices: results,
      ...(failedCount > 0 ? { error: "ANDROID_LOCK_PARTIAL_FAILURE" } : {})
    };
  }

  async playMediaAcrossDevices({ mediaUrl = "", query = "favorite song" } = {}) {
    const capableDevices = this.listDevices({ platform: "android", online: true }).filter(dev =>
      Array.isArray(dev.capabilities) &&
      (dev.capabilities.includes("media_playback") || dev.capabilities.includes("youtube_launch"))
    );
    if (!capableDevices.length) {
      return { success: false, error: "NO_ONLINE_MEDIA_CAPABLE_DEVICES", playingDevices: 0, devices: [] };
    }
    if (mediaUrl && (typeof mediaUrl !== "string" || !/^https:\/\//i.test(mediaUrl))) {
      return { success: false, error: "MEDIA_URL_INVALID", playingDevices: 0, devices: [] };
    }
    if (!mediaUrl && (typeof query !== "string" || !query.trim())) {
      return { success: false, error: "MEDIA_QUERY_REQUIRED", playingDevices: 0, devices: [] };
    }
    if (!this.androidBridge || typeof this.androidBridge.playMedia !== "function") {
      return {
        success: false, error: "ANDROID_BRIDGE_UNAVAILABLE", playingDevices: 0, targetedCount: capableDevices.length,
        devices: capableDevices.map(dev => ({ deviceId: dev.id, name: dev.name, success: false, playing: false, error: "ANDROID_BRIDGE_UNAVAILABLE" }))
      };
    }
    const results = [];
    for (const dev of capableDevices) {
      try {
        const bridgeResult = await this.androidBridge.playMedia(dev.id, mediaUrl || null, query);
        const acknowledged = bridgeResult === true || bridgeResult?.success === true;
        if (acknowledged) {
          dev.currentMedia = { url: mediaUrl || null, query, startedAt: new Date().toISOString(), playing: true };
          dev.lastSeenAt = new Date().toISOString();
        }
        results.push({ deviceId: dev.id, name: dev.name, mediaUrl: mediaUrl || null, success: acknowledged, playing: acknowledged, bridgeResult });
      } catch (error) {
        results.push({ deviceId: dev.id, name: dev.name, mediaUrl: mediaUrl || null, success: false, playing: false, error: "ANDROID_MEDIA_FAILED", message: String(error?.message || "Android media command failed").slice(0, 200) });
      }
    }
    const playingDevices = results.filter(result => result.success).length;
    const failedCount = results.length - playingDevices;
    if (this.isPersistent && playingDevices > 0 && !this.saveToDisk()) {
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED", playingDevices: 0, failedCount: results.length, devices: results };
    }
    const eventRecord = { action: "PLAY_MEDIA_ACROSS_DEVICES", timestamp: new Date().toISOString(), targetedCount: capableDevices.length, mediaUrl: mediaUrl || null, results };
    this.commandHistory.unshift(eventRecord);
    if (this.commandHistory.length > 50) this.commandHistory.pop();
    return {
      success: failedCount === 0 && playingDevices > 0, playingDevices, failedCount, mediaUrl: mediaUrl || null, devices: results,
      ...(failedCount > 0 ? { error: "ANDROID_MEDIA_PARTIAL_FAILURE" } : {})
    };
  }

  disconnectDevice(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev || this.revokedDevices.has(deviceId) || dev.status === "revoked") {
      return { success: false, error: this.revokedDevices.has(deviceId) ? "DEVICE_REVOKED" : "DEVICE_NOT_FOUND" };
    }
    dev.online = false;
    dev.lastSeenAt = new Date().toISOString();
    if (this.isPersistent && !this.saveToDisk()) return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
    return { success: true, deviceId, online: false };
  }

  reconnectDevice(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev || this.revokedDevices.has(deviceId) || dev.status === "revoked") {
      return { success: false, error: this.revokedDevices.has(deviceId) ? "DEVICE_REVOKED" : "DEVICE_NOT_FOUND" };
    }
    dev.online = true;
    dev.lastSeenAt = new Date().toISOString();
    if (this.isPersistent && !this.saveToDisk()) return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
    return { success: true, deviceId, online: true };
  }

  /**
   * Unregisters / removes a device from the active fleet.
   */
  unregisterDevice(deviceId) {
    if (!this.devices.has(deviceId)) return { success: false, error: "DEVICE_NOT_FOUND" };
    return this.revokeDevice(deviceId, "owner_unregistered");
  }

  /**
   * Updates presence, battery, vitals and last seen timestamp for a device.
   */
  updateDevicePresence(deviceId, telemetry = {}) {
    const dev = this.devices.get(deviceId);
    if (!dev || this.revokedDevices.has(deviceId) || dev.status === "revoked") {
      return { success: false, error: this.revokedDevices.has(deviceId) ? "DEVICE_REVOKED" : "DEVICE_NOT_FOUND" };
    }
    if (typeof telemetry.online === "boolean") dev.online = telemetry.online;
    if (telemetry.battery && typeof telemetry.battery.percent === "number") {
      dev.battery = {
        percent: Math.max(0, Math.min(100, telemetry.battery.percent)),
        isCharging: Boolean(telemetry.battery.isCharging)
      };
    }
    if (telemetry.vitals) dev.vitals = telemetry.vitals;
    dev.lastSeenAt = new Date().toISOString();
    if (this.isPersistent && !this.saveToDisk()) return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
    return { success: true, deviceId, online: dev.online, lastSeenAt: dev.lastSeenAt };
  }

  /**
   * Finds all devices matching a specific capability (e.g. screen_unlock, run_script, camera).
   */
  findEligibleDevices(capability, { onlineOnly = true, type = null } = {}) {
    const cleanCap = String(capability || "").toLowerCase().trim();
    let matches = Array.from(this.devices.values()).filter(d => !this.revokedDevices.has(d.id) && d.status !== "revoked");
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
    const dev = this.getDevice(deviceId);
    if (!dev) return null;
    return Array.isArray(dev.capabilities) ? [...dev.capabilities] : [];
  }

  /**
   * Synchronizes shared ecosystem state across devices with conflict resolution.
   */
  syncStateAcrossDevices({ stateKey, payload, originDeviceId = null, ownerUserId = null, expectedVersion = null, targetDevices = null } = {}) {
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

    const originDevice = originDeviceId ? this.deviceHub?.pairedDevices?.get(originDeviceId) : null;
    const resolvedOwnerUserId = String(ownerUserId || originDevice?.ownerUserId || "").trim() || null;
    if (this.isPersistent && !resolvedOwnerUserId) {
      return {
        success: false,
        error: "OWNER_CONTEXT_REQUIRED",
        message: "Persistent multi-device synchronization requires a verified owner identity."
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

    const requestedTargets = targetDevices || (
      resolvedOwnerUserId && typeof this.deviceHub?.listPairedDevices === "function"
        ? this.deviceHub.listPairedDevices(resolvedOwnerUserId).map(device => device.id)
        : Array.from(this.devices.keys()).filter(id => id !== originDeviceId)
    );
    const targetList = [...new Set(requestedTargets.map(id => String(id || "").trim()).filter(id => {
      if (!id || id === originDeviceId || this.revokedDevices.has(id)) return false;
      if (!resolvedOwnerUserId) return true;
      const paired = this.deviceHub?.pairedDevices?.get(id);
      return Boolean(paired && paired.status !== "revoked" && paired.ownerUserId === resolvedOwnerUserId);
    }))];
    const locallyNotified = [];
    const queuedFor = [];
    const eventsByTarget = new Map();

    for (const targetId of targetList) {
      const deliveryEvent = {
        deliveryId: "del_" + crypto.randomUUID(),
        eventId: "evt_" + crypto.randomUUID(),
        type: "STATE_SYNC",
        ownerUserId: resolvedOwnerUserId,
        stateKey: cleanKey,
        version: nextVersion,
        payload,
        timestamp
      };
      eventsByTarget.set(targetId, deliveryEvent);

      const queue = this.pendingDeliveries.get(targetId) || [];
      queue.push(deliveryEvent);
      if (queue.length > 100) queue.shift();
      this.pendingDeliveries.set(targetId, queue);
      queuedFor.push(targetId);
    }

    // Persist state and delivery records before notifying remote clients.
    // A failed local persistence write must never be reported as success.
    if (this.isPersistent && !this.saveToDisk()) {
      if (existing) this.sharedState.set(cleanKey, existing);
      else this.sharedState.delete(cleanKey);
      for (const [targetId, evt] of eventsByTarget.entries()) {
        const queue = this.pendingDeliveries.get(targetId) || [];
        this.pendingDeliveries.set(targetId, queue.filter(item => item.deliveryId !== evt.deliveryId));
      }
      return { success: false, error: "STATE_PERSISTENCE_FAILED", message: "Shared state could not be durably recorded." };
    }

    for (const targetId of targetList) {
      const deliveryEvent = eventsByTarget.get(targetId);
      const subs = this.subscribers.get(targetId);
      if (subs && subs.size > 0) {
        let notified = false;
        for (const cb of subs) {
          try { cb(deliveryEvent); notified = true; } catch {}
        }
        if (notified) locallyNotified.push(targetId);
      }
    }

    const websocketSent = [];
    if (resolvedOwnerUserId && typeof this.deviceGateway?.dispatchStateSync === "function") {
      for (const targetId of targetList) {
        const result = this.deviceGateway.dispatchStateSync({
          ownerUserId: resolvedOwnerUserId,
          deviceIds: [targetId],
          event: eventsByTarget.get(targetId)
        });
        if (result?.success && result.sentDeviceIds?.includes(targetId)) websocketSent.push(targetId);
      }
    }

    const deliveredTo = [...new Set([...locallyNotified, ...websocketSent])];
    return {
      success: true,
      syncedKey: cleanKey,
      version: nextVersion,
      updatedAt: timestamp,
      synchronizedDevices: targetList,
      sentToDevices: websocketSent,
      locallyNotifiedDevices: locallyNotified,
      queuedDevices: queuedFor,
      pendingAcknowledgementDevices: queuedFor,
      deliveredCount: 0,
      sentCount: websocketSent.length,
      queuedCount: queuedFor.length,
      transport: resolvedOwnerUserId ? "authenticated_websocket_sse_with_ack_queue" : "in_process_test_callbacks",
      ownerUserId: resolvedOwnerUserId
    };
  }

  syncSharedMemory({ memoryKey, memoryData, originDeviceId = null, ownerUserId = null, expectedVersion = null } = {}) {
    if (!memoryKey || typeof memoryKey !== "string") {
      return { success: false, error: "MEMORY_KEY_REQUIRED" };
    }
    return this.syncStateAcrossDevices({
      stateKey: "memory:" + memoryKey.trim(),
      payload: memoryData,
      originDeviceId,
      ownerUserId,
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
export const multiDeviceManager = new MultiDeviceManager({ seedDefaultFleet: false, persist: true, registerDeliveryAckHandler: true });
