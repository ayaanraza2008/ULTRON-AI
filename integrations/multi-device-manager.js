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
import {
  BaseMultiDevicePersistenceAdapter,
  FilePersistenceAdapter,
  DatabasePersistenceAdapter,
  createMultiDevicePersistenceAdapter
} from "./multi-device-persistence.js";

export const DEVICE_TYPES = {
  WINDOWS_PC: "windows_pc",
  WINDOWS_LAPTOP: "windows_laptop",
  ANDROID_SMARTPHONE: "android_smartphone",
  ANDROID_TABLET: "android_tablet",
  WEB_BROWSER: "web_browser",
  CLIENT_ADAPTER: "client_adapter",
  GENERIC_COMPANION: "generic_companion"
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
    this._durableStateQueue = Promise.resolve();
    this.env = options.env || process.env;
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "data", "multidevice-state.json");
    // Persistence is opt-in for isolated instances; the production singleton
    // explicitly enables it. Tests and short-lived tools stay side-effect free.
    this.isPersistent = Boolean(options.persist === true || options.storagePath || options.persistenceAdapter || options.databaseUrl || this.env.ULTRON_DATABASE_URL || options.inMemoryMockDb);
    this.persistenceAdapter = options.persistenceAdapter || (this.isPersistent ? createMultiDevicePersistenceAdapter({
      storagePath: this.storagePath,
      databaseUrl: options.databaseUrl || this.env.ULTRON_DATABASE_URL,
      supabaseUrl: options.supabaseUrl || this.env.SUPABASE_URL,
      supabaseServiceRoleKey: options.supabaseServiceRoleKey || this.env.SUPABASE_SERVICE_ROLE_KEY,
      supabaseRest: options.supabaseRest,
      fetchImpl: options.fetchImpl,
      inMemoryMockDb: options.inMemoryMockDb,
      logger: options.logger
    }) : null);
    this.isInitializing = true;
    if (options.seedDefaultFleet !== false) {
      this.initializeDefaultFleet();
    }
    this.isInitializing = false;
    this.initializationError = null;
    if (this.isPersistent && this.persistenceAdapter) {
      if (this.persistenceAdapter instanceof FilePersistenceAdapter) {
        this.loadFromDisk();
        this.ready = Promise.resolve(true);
      } else {
        this.ready = this.load().then(() => {
          if (this.persistenceAdapter instanceof DatabasePersistenceAdapter &&
              this.persistenceAdapter.lastLoadOutcome?.authoritative !== true) {
            throw new Error("CLOUD_STATE_LOAD_NOT_CONFIRMED");
          }
          return true;
        }).catch(error => {
          this.initializationError = error;
          if (options.logger?.warn) {
            options.logger.warn("MultiDeviceManager: cloud state initialization failed", { error: error?.message });
          }
          return false;
        });
      }
    } else {
      this.ready = Promise.resolve(true);
    }
    if (options.registerDeliveryAckHandler === true && typeof this.deviceGateway?.setStateSyncAckHandler === "function") {
      this.deviceGateway.setStateSyncAckHandler(({ deviceId, ownerUserId, deliveryId }) => {
        const paired = this.deviceHub?.pairedDevices?.get(deviceId);
        if (!paired || paired.status === "revoked" || paired.ownerUserId !== ownerUserId) {
          return { success: false, error: "DEVICE_OWNER_MISMATCH" };
        }
        return this.acknowledgeDeliveryDurably(deviceId, deliveryId);
      });
    }
  }

  serializeState() {
    return {
      version: "2.0.0",
      savedAt: new Date().toISOString(),
      devices: Array.from(this.devices.entries()),
      sharedState: Array.from(this.sharedState.entries()),
      pendingDeliveries: Array.from(this.pendingDeliveries.entries()),
      revokedDevices: Array.from(this.revokedDevices)
    };
  }

  hydrateState(data) {
    if (!data) return false;
    this.devices.clear();
    this.sharedState.clear();
    this.pendingDeliveries.clear();
    this.revokedDevices.clear();
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
  }

  saveToDisk() {
    if (!this.isPersistent || !(this.persistenceAdapter instanceof FilePersistenceAdapter)) return false;
    return this.persistenceAdapter.saveSync(this.serializeState());
  }

  loadFromDisk() {
    if (!this.isPersistent) return false;
    if (this.persistenceAdapter && typeof this.persistenceAdapter.loadSync === "function") {
      const data = this.persistenceAdapter.loadSync();
      return this.hydrateState(data);
    }
    return false;
  }

  async save() {
    if (!this.isPersistent || !this.persistenceAdapter) return false;
    return await this.persistenceAdapter.save(this.serializeState());
  }

  _restoreSnapshot(snapshot) {
    this.devices = new Map(Array.isArray(snapshot?.devices) ? snapshot.devices : []);
    this.sharedState = new Map(Array.isArray(snapshot?.sharedState) ? snapshot.sharedState : []);
    this.pendingDeliveries = new Map(Array.isArray(snapshot?.pendingDeliveries) ? snapshot.pendingDeliveries : []);
    this.revokedDevices = new Set(Array.isArray(snapshot?.revokedDevices) ? snapshot.revokedDevices : []);
  }

  _enqueueDurableOperation(operation) {
    const queued = this._durableStateQueue.then(operation, operation);
    this._durableStateQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async _persistDurableSnapshot(previousSnapshot) {
    let outcome = null;
    let failure = null;
    try {
      if (!this.persistenceAdapter || typeof this.persistenceAdapter.save !== "function") {
        failure = "DURABLE_PERSISTENCE_NOT_CONFIGURED";
      } else {
        outcome = await this.persistenceAdapter.save(this.serializeState());
      }
    } catch (error) {
      failure = error?.message || "DURABLE_PERSISTENCE_FAILED";
    }

    const durable = outcome?.success === true && outcome.cloudPersisted === true;
    if (durable) {
      return {
        success: true,
        backend: outcome.backend || "database",
        cloudPersisted: outcome.cloudPersisted === true
      };
    }

    this._restoreSnapshot(previousSnapshot);
    const restoreAdapter = this.persistenceAdapter?.fallbackAdapter || this.persistenceAdapter;
    try {
      if (typeof restoreAdapter?.save === "function") {
        await restoreAdapter.save(previousSnapshot);
      } else if (typeof restoreAdapter?.saveSync === "function") {
        restoreAdapter.saveSync(previousSnapshot);
      }
    } catch {}

    return {
      success: false,
      error: "CLOUD_PERSISTENCE_FAILED",
      backend: outcome?.backend || null,
      cloudPersisted: false,
      reason: failure || outcome?.warning || "PERSISTENCE_BACKEND_NOT_DURABLE"
    };
  }

  async _commitDurableMutation(mutation, errorCode = "STATE_PERSISTENCE_FAILED") {
    return this._enqueueDurableOperation(async () => {
      if (await this.ready === false) {
        return { success: false, error: "PERSISTENCE_INITIALIZATION_FAILED", cloudPersisted: false };
      }
      if (!this.isPersistent || !this.persistenceAdapter || this.persistenceAdapter instanceof FilePersistenceAdapter) {
        return { success: false, error: "DURABLE_PERSISTENCE_NOT_CONFIGURED", cloudPersisted: false };
      }

      const previousSnapshot = this.serializeState();
      let result;
      try {
        result = mutation();
      } catch (error) {
        this._restoreSnapshot(previousSnapshot);
        return { success: false, error: errorCode, message: String(error?.message || errorCode).slice(0, 300), cloudPersisted: false };
      }
      if (result?.success === false) {
        this._restoreSnapshot(previousSnapshot);
        return result;
      }

      const persisted = await this._persistDurableSnapshot(previousSnapshot);
      if (!persisted.success) {
        return {
          success: false,
          error: errorCode,
          cloudPersisted: false,
          persistenceBackend: persisted.backend || null,
          message: "The lifecycle change was rolled back because cloud persistence was not confirmed."
        };
      }

      return {
        ...(result && typeof result === "object" ? result : { value: result }),
        success: typeof result?.success === "boolean" ? result.success : true,
        cloudPersisted: true,
        persistenceBackend: persisted.backend
      };
    });
  }

  async _runDeviceCommandDurably(command) {
    return this._enqueueDurableOperation(async () => {
      if (await this.ready === false) {
        return { success: false, error: "PERSISTENCE_INITIALIZATION_FAILED", cloudPersisted: false };
      }
      if (!this.isPersistent || !this.persistenceAdapter || this.persistenceAdapter instanceof FilePersistenceAdapter) {
        return { success: false, error: "DURABLE_PERSISTENCE_NOT_CONFIGURED", cloudPersisted: false };
      }

      const previousSnapshot = this.serializeState();
      const result = await command();
      const actionApplied = Array.isArray(result?.devices) && result.devices.some(device => device.success === true);
      if (!actionApplied) return result;

      const persisted = await this._persistDurableSnapshot(previousSnapshot);
      if (!persisted.success) {
        return {
          ...result,
          success: false,
          error: "DEVICE_PERSISTENCE_FAILED",
          cloudPersisted: false,
          actionMayHaveExecuted: true,
          message: "A device acknowledged the command, but its resulting state could not be confirmed in cloud storage."
        };
      }
      return { ...result, cloudPersisted: true, persistenceBackend: persisted.backend };
    });
  }

  async registerDeviceDurably(deviceMeta = {}) {
    return this._commitDurableMutation(
      () => this.registerDevice(deviceMeta, { deferPersistence: true }),
      "DEVICE_PERSISTENCE_FAILED"
    );
  }

  async revokeDeviceDurably(deviceId, reason = "owner_revoked") {
    return this._commitDurableMutation(
      () => this.revokeDevice(deviceId, reason, { deferPersistence: true }),
      "DEVICE_PERSISTENCE_FAILED"
    );
  }

  async disconnectDeviceDurably(deviceId) {
    return this._commitDurableMutation(
      () => this.disconnectDevice(deviceId, { deferPersistence: true }),
      "DEVICE_PERSISTENCE_FAILED"
    );
  }

  async reconnectDeviceDurably(deviceId) {
    return this._commitDurableMutation(
      () => this.reconnectDevice(deviceId, { deferPersistence: true }),
      "DEVICE_PERSISTENCE_FAILED"
    );
  }

  async updateDevicePresenceDurably(deviceId, telemetry = {}) {
    return this._commitDurableMutation(
      () => this.updateDevicePresence(deviceId, telemetry, { deferPersistence: true }),
      "DEVICE_PERSISTENCE_FAILED"
    );
  }

  async clearSharedStateDurably(stateKey = null) {
    return this._commitDurableMutation(
      () => this.clearSharedState(stateKey, { deferPersistence: true }),
      "STATE_PERSISTENCE_FAILED"
    );
  }

  async syncSharedMemoryDurably({ memoryKey, memoryData, originDeviceId = null, ownerUserId = null, expectedVersion = null } = {}) {
    if (!memoryKey || typeof memoryKey !== "string") return { success: false, error: "MEMORY_KEY_REQUIRED" };
    return this.syncStateAcrossDevicesDurably({
      stateKey: "memory:" + memoryKey.trim(),
      payload: memoryData,
      originDeviceId,
      ownerUserId,
      expectedVersion
    });
  }

  async syncStateAcrossDevicesDurably(options = {}) {
    return this._enqueueDurableOperation(async () => {
      if (await this.ready === false) {
        return { success: false, error: "PERSISTENCE_INITIALIZATION_FAILED" };
      }
      if (!this.isPersistent || !this.persistenceAdapter) {
        return { success: false, error: "DURABLE_PERSISTENCE_NOT_CONFIGURED" };
      }

      const previousSnapshot = this.serializeState();
      const staged = this.syncStateAcrossDevices({ ...options, deferDispatch: true });
      if (!staged.success) return staged;

      const persisted = await this._persistDurableSnapshot(previousSnapshot);
      if (!persisted.success) {
        return {
          success: false,
          error: "CLOUD_PERSISTENCE_FAILED",
          message: "State and delivery queue were not committed to durable cloud storage; no devices were notified.",
          cloudPersisted: false,
          persistenceBackend: persisted.backend || null
        };
      }

      const locallyNotified = [];
      const websocketSent = [];
      for (const { targetDeviceId, event } of staged.deliveryEvents || []) {
        const subscribers = this.subscribers.get(targetDeviceId);
        if (subscribers && subscribers.size > 0) {
          let notified = false;
          for (const callback of subscribers) {
            try { callback(event); notified = true; } catch {}
          }
          if (notified) locallyNotified.push(targetDeviceId);
        }

        if (staged.ownerUserId && typeof this.deviceGateway?.dispatchStateSync === "function") {
          const result = this.deviceGateway.dispatchStateSync({
            ownerUserId: staged.ownerUserId,
            deviceIds: [targetDeviceId],
            event
          });
          if (result?.success && result.sentDeviceIds?.includes(targetDeviceId)) {
            websocketSent.push(targetDeviceId);
          }
        }
      }

      const { deliveryEvents: _deliveryEvents, ...publicResult } = staged;
      return {
        ...publicResult,
        locallyNotifiedDevices: locallyNotified,
        sentToDevices: websocketSent,
        sentCount: websocketSent.length,
        deliveredCount: 0,
        cloudPersisted: persisted.cloudPersisted,
        persistenceBackend: persisted.backend
      };
    });
  }

  async acknowledgeDeliveryDurably(deviceId, deliveryId) {
    return this._enqueueDurableOperation(async () => {
      if (await this.ready === false) {
        return { success: false, error: "PERSISTENCE_INITIALIZATION_FAILED" };
      }
      if (!deviceId || !deliveryId) return { success: false, error: "PARAMS_REQUIRED" };

      const queue = this.pendingDeliveries.get(deviceId);
      if (!queue) return { success: false, error: "NO_PENDING_QUEUE" };
      const updated = queue.filter(item => item.deliveryId !== deliveryId);
      if (updated.length === queue.length) {
        return {
          success: false,
          error: "DELIVERY_NOT_FOUND",
          acknowledged: false,
          remainingCount: queue.length
        };
      }

      const previousSnapshot = this.serializeState();
      this.pendingDeliveries.set(deviceId, updated);
      const persisted = await this._persistDurableSnapshot(previousSnapshot);
      if (!persisted.success) {
        return {
          success: false,
          error: "STATE_PERSISTENCE_FAILED",
          deviceId,
          acknowledged: false,
          cloudPersisted: false
        };
      }

      return {
        success: true,
        deviceId,
        acknowledgedDeliveryId: deliveryId,
        acknowledged: true,
        remainingCount: updated.length,
        cloudPersisted: persisted.cloudPersisted,
        persistenceBackend: persisted.backend
      };
    });
  }

  async load() {
    if (!this.isPersistent || !this.persistenceAdapter || typeof this.persistenceAdapter.load !== "function") return false;
    const data = await this.persistenceAdapter.load();
    return this.hydrateState(data);
  }

  setPersistenceAdapter(adapter) {
    this.persistenceAdapter = adapter;
    this.isPersistent = Boolean(adapter);
    this.initializationError = null;

    if (!adapter) {
      this.ready = Promise.resolve(true);
      return this.ready;
    }

    // Switching to a file adapter preserves the current in-memory state;
    // switching to a database adapter must load the cloud authority first.
    if (adapter instanceof FilePersistenceAdapter) {
      this.ready = Promise.resolve(true);
      return this.ready;
    }

    this.ready = this.load().then(() => {
      if (adapter instanceof DatabasePersistenceAdapter && adapter.lastLoadOutcome?.authoritative !== true) {
        throw new Error("CLOUD_STATE_LOAD_NOT_CONFIRMED");
      }
      return true;
    }).catch(error => {
      this.initializationError = error;
      return false;
    });
    return this.ready;
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
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter)) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use acknowledgeDeliveryDurably for database-backed persistence." };
    }
    const queue = this.pendingDeliveries.get(deviceId);
    if (!queue) return { success: false, error: "NO_PENDING_QUEUE" };
    const initialLen = queue.length;
    const updated = queue.filter(item => item.deliveryId !== deliveryId);
    if (initialLen === updated.length) {
      return {
        success: true,
        deviceId,
        acknowledgedDeliveryId: deliveryId,
        acknowledged: false,
        remainingCount: updated.length
      };
    }
    this.pendingDeliveries.set(deviceId, updated);
    if (this.isPersistent && !this.saveToDisk()) {
      this.pendingDeliveries.set(deviceId, queue);
      return {
        success: false,
        error: "STATE_PERSISTENCE_FAILED",
        deviceId,
        acknowledgedDeliveryId: deliveryId
      };
    }
    return {
      success: true,
      deviceId,
      acknowledgedDeliveryId: deliveryId,
      acknowledged: true,
      remainingCount: updated.length
    };
  }

  revokeDevice(deviceId, reason = "owner_revoked", { deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use revokeDeviceDurably for database-backed persistence." };
    }
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
    if (this.isPersistent && !deferPersistence && !this.saveToDisk()) {
      return {
        success: false,
        error: "DEVICE_PERSISTENCE_FAILED",
        deviceId,
        status: "revoked_in_memory",
        reason,
        revokedAt: dev.revokedAt
      };
    }
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

  registerDevice(deviceMeta = {}, { deferPersistence = false } = {}) {
    if (this.isPersistent && !this.isInitializing && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use registerDeviceDurably for database-backed persistence." };
    }
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
      lastSeenAt: deviceMeta.lastSeenAt || new Date().toISOString(),
      heartbeatTimeoutMs: deviceMeta.heartbeatTimeoutMs || 90_000,
      currentMedia: null
    };

    this.devices.set(id, entry);
    if (this.isPersistent && !this.isInitializing && !deferPersistence && !this.saveToDisk()) {
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

  isDeviceOnline(deviceOrId) {
    const dev = typeof deviceOrId === "string" ? this.devices.get(deviceOrId) : deviceOrId;
    if (!dev || this.revokedDevices.has(dev.id) || dev.status === "revoked") return false;
    if (dev.online !== true) return false;
    if (dev.lastSeenAt) {
      const elapsed = Date.now() - new Date(dev.lastSeenAt).getTime();
      const timeout = dev.heartbeatTimeoutMs || 90_000;
      if (elapsed > timeout) {
        dev.online = false;
        return false;
      }
    }
    return true;
  }

  listDevices(filter = {}) {
    let list = Array.from(this.devices.values()).filter(device =>
      !this.revokedDevices.has(device.id) && device.status !== "revoked"
    );
    for (const d of list) {
      d.online = this.isDeviceOnline(d);
    }
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
  async unlockMobileDevices({ deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return this._runDeviceCommandDurably(() => this.unlockMobileDevices({ deferPersistence: true }));
    }
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
    if (this.isPersistent && !deferPersistence && unlockedCount > 0 && !this.saveToDisk()) {
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED", targetedCount: mobileDevices.length, unlockedCount: 0, failedCount: mobileDevices.length, devices: results };
    }
    return {
      success: failedCount === 0 && unlockedCount > 0,
      targetedCount: mobileDevices.length, unlockedCount, failedCount, devices: results,
      ...(failedCount > 0 ? { error: "ANDROID_UNLOCK_PARTIAL_FAILURE" } : {})
    };
  }

  async lockMobileDevices({ deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return this._runDeviceCommandDurably(() => this.lockMobileDevices({ deferPersistence: true }));
    }
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
    if (this.isPersistent && !deferPersistence && lockedCount > 0 && !this.saveToDisk()) {
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED", targetedCount: mobileDevices.length, lockedCount: 0, failedCount: mobileDevices.length, devices: results };
    }
    return {
      success: failedCount === 0 && lockedCount > 0,
      targetedCount: mobileDevices.length, lockedCount, failedCount, devices: results,
      ...(failedCount > 0 ? { error: "ANDROID_LOCK_PARTIAL_FAILURE" } : {})
    };
  }

  async playMediaAcrossDevices({ mediaUrl = "", query = "favorite song", deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return this._runDeviceCommandDurably(() => this.playMediaAcrossDevices({ mediaUrl, query, deferPersistence: true }));
    }
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
    if (this.isPersistent && !deferPersistence && playingDevices > 0 && !this.saveToDisk()) {
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

  disconnectDevice(deviceId, { deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use disconnectDeviceDurably for database-backed persistence." };
    }
    const dev = this.devices.get(deviceId);
    if (!dev || this.revokedDevices.has(deviceId) || dev.status === "revoked") {
      return { success: false, error: this.revokedDevices.has(deviceId) ? "DEVICE_REVOKED" : "DEVICE_NOT_FOUND" };
    }
    dev.online = false;
    dev.lastSeenAt = new Date().toISOString();
    if (this.isPersistent && !deferPersistence && !this.saveToDisk()) return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
    return { success: true, deviceId, online: false };
  }

  reconnectDevice(deviceId, { deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use reconnectDeviceDurably for database-backed persistence." };
    }
    const dev = this.devices.get(deviceId);
    if (!dev || this.revokedDevices.has(deviceId) || dev.status === "revoked") {
      return { success: false, error: this.revokedDevices.has(deviceId) ? "DEVICE_REVOKED" : "DEVICE_NOT_FOUND" };
    }
    dev.online = true;
    dev.lastSeenAt = new Date().toISOString();
    if (this.isPersistent && !deferPersistence && !this.saveToDisk()) return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
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
  updateDevicePresence(deviceId, telemetry = {}, { deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use updateDevicePresenceDurably for database-backed persistence." };
    }
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
    if (this.isPersistent && !deferPersistence && !this.saveToDisk()) return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
    return { success: true, deviceId, online: dev.online, lastSeenAt: dev.lastSeenAt };
  }

  /**
   * Finds all devices matching a specific capability (e.g. screen_unlock, run_script, camera).
   */
  findEligibleDevices(capability, { onlineOnly = true, type = null } = {}) {
    const cleanCap = String(capability || "").toLowerCase().trim();
    let matches = Array.from(this.devices.values()).filter(d => !this.revokedDevices.has(d.id) && d.status !== "revoked");
    if (onlineOnly) {
      matches = matches.filter(d => this.isDeviceOnline(d));
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
  syncStateAcrossDevices({ stateKey, payload, originDeviceId = null, ownerUserId = null, expectedVersion = null, targetDevices = null, deferDispatch = false } = {}) {
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
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferDispatch) {
      return {
        success: false,
        error: "ASYNC_PERSISTENCE_REQUIRED",
        message: "Database-backed device synchronization must use syncStateAcrossDevicesDurably."
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
    if (this.isPersistent && !deferDispatch && !this.saveToDisk()) {
      if (existing) this.sharedState.set(cleanKey, existing);
      else this.sharedState.delete(cleanKey);
      for (const [targetId, evt] of eventsByTarget.entries()) {
        const queue = this.pendingDeliveries.get(targetId) || [];
        this.pendingDeliveries.set(targetId, queue.filter(item => item.deliveryId !== evt.deliveryId));
      }
      return { success: false, error: "STATE_PERSISTENCE_FAILED", message: "Shared state could not be durably recorded." };
    }

    const websocketSent = [];
    if (!deferDispatch) {
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
      ownerUserId: resolvedOwnerUserId,
      ...(deferDispatch ? {
        deliveryEvents: Array.from(eventsByTarget.entries()).map(([targetDeviceId, event]) => ({ targetDeviceId, event }))
      } : {})
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
  clearSharedState(stateKey = null, { deferPersistence = false } = {}) {
    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter) && !deferPersistence) {
      return { success: false, error: "ASYNC_PERSISTENCE_REQUIRED", message: "Use clearSharedStateDurably for database-backed persistence." };
    }
    const previous = new Map(this.sharedState);
    if (stateKey) {
      const key = String(stateKey).trim();
      const deleted = this.sharedState.delete(key);
      if (!deleted) return { success: false, stateKey: key };
      if (this.isPersistent && !deferPersistence && !this.saveToDisk()) {
        this.sharedState = previous;
        return { success: false, error: "STATE_PERSISTENCE_FAILED", stateKey: key };
      }
      return { success: true, stateKey: key };
    }
    this.sharedState.clear();
    if (this.isPersistent && !deferPersistence && !this.saveToDisk()) {
      this.sharedState = previous;
      return { success: false, error: "STATE_PERSISTENCE_FAILED" };
    }
    return { success: true, clearedAll: true };
  }

  /**
   * Binds this manager with a DeviceHub instance to auto-import paired devices.
   */
  bindWithDeviceHub(deviceHub) {
    this.deviceHub = deviceHub;
    if (!deviceHub || typeof deviceHub.listPairedDevices !== "function") {
      return { success: false, error: "DEVICE_HUB_UNAVAILABLE", importedCount: 0 };
    }

    if (this.isPersistent && !(this.persistenceAdapter instanceof FilePersistenceAdapter)) {
      return this._commitDurableMutation(
        () => this._importPairedDevicesInMemory(deviceHub, { deferPersistence: true }),
        "DEVICE_PERSISTENCE_FAILED"
      );
    }
    return this._importPairedDevicesInMemory(deviceHub);
  }

  _importPairedDevicesInMemory(deviceHub, { deferPersistence = false } = {}) {
    const paired = deviceHub.listPairedDevices();
    const importedDeviceIds = [];
    for (const dev of paired) {
      if (!dev?.id || this.devices.has(dev.id)) continue;
      let type = DEVICE_TYPES.GENERIC_COMPANION;
      if (dev.platform === "windows") type = DEVICE_TYPES.WINDOWS_PC;
      else if (dev.platform === "android") type = DEVICE_TYPES.ANDROID_SMARTPHONE;
      else if (dev.platform === "browser") type = DEVICE_TYPES.WEB_BROWSER;

      const registered = this.registerDevice({
        id: dev.id,
        name: dev.name,
        type,
        platform: dev.platform,
        capabilities: dev.capabilities ? Object.keys(dev.capabilities) : ["notifications", "telemetry"],
        online: dev.online ?? true,
        battery: dev.battery || { percent: 100, isCharging: false }
      }, { deferPersistence });

      if (registered?.success === false) {
        return { success: false, error: registered.error || "DEVICE_IMPORT_FAILED", importedDeviceIds };
      }
      importedDeviceIds.push(dev.id);
    }
    return { success: true, importedCount: importedDeviceIds.length, importedDeviceIds };
  }
}

// Real runtime starts with no fabricated online devices. Actual devices must pair
// and heartbeat before they can be selected for remote operations.
export const multiDeviceManager = new MultiDeviceManager({ seedDefaultFleet: false, persist: true, registerDeliveryAckHandler: true });

export {
  BaseMultiDevicePersistenceAdapter,
  FilePersistenceAdapter,
  DatabasePersistenceAdapter,
  createMultiDevicePersistenceAdapter
};
