/**
 * ULTRON AI — Mobile Device Registry & Discovery Service
 *
 * Central registry tracking all connected mobile devices across Android and iOS.
 * Periodically polls connectivity, normalizes device metadata, evaluates device capabilities,
 * and maintains real-time connection status with event emission.
 */

import { EventEmitter } from "node:events";
import { adbBridge } from "./adb-bridge.js";

export const DEVICE_PLATFORMS = {
  ANDROID: "android",
  IOS: "ios"
};

export const DEVICE_STATES = {
  ONLINE: "online",
  OFFLINE: "offline",
  UNAUTHORIZED: "unauthorized",
  DISCONNECTED: "disconnected"
};

export class MobileDeviceRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.adb = options.adbBridge || adbBridge;
    this.pollIntervalMs = options.pollIntervalMs || 10000;
    this.devices = new Map();
    this.selectedDeviceId = null;
    this.isPolling = false;
    this._pollTimer = null;
    this.lastScanTime = null;
  }

  /**
   * Scan for all available devices across ADB and local transports.
   */
  async scanDevices() {
    this.lastScanTime = Date.now();
    const discovered = new Map();

    // 1. Android discovery via ADB Bridge
    const adbAvail = await this.adb.checkAvailability();
    if (adbAvail.available) {
      const listRes = await this.adb.listDevices();
      if (listRes.success && Array.isArray(listRes.devices)) {
        for (const raw of listRes.devices) {
          const deviceRecord = {
            id: raw.id,
            name: raw.name || raw.id,
            platform: DEVICE_PLATFORMS.ANDROID,
            type: raw.type, // 'real' | 'emulator'
            connectionType: raw.connectionType, // 'usb' | 'wifi' | 'emulator'
            state: raw.ready ? DEVICE_STATES.ONLINE : (raw.state === "unauthorized" ? DEVICE_STATES.UNAUTHORIZED : DEVICE_STATES.OFFLINE),
            ready: Boolean(raw.ready || raw.state === "online" || raw.state === "device"),
            model: raw.model,
            product: raw.product,
            transportId: raw.transportId,
            capabilities: {
              touch: raw.ready,
              screenCapture: raw.ready,
              accessibilityTree: raw.ready,
              keyEvents: raw.ready,
              appManagement: raw.ready,
              urlOpen: raw.ready,
              deepLink: raw.ready
            },
            lastSeen: Date.now()
          };
          discovered.set(raw.id, deviceRecord);
        }
      }
    }

    // 2. Identify newly connected or disconnected devices
    for (const [id, dev] of discovered.entries()) {
      if (!this.devices.has(id)) {
        this.emit("device_connected", dev);
      } else {
        const old = this.devices.get(id);
        if (old.state !== dev.state) {
          this.emit("device_state_changed", { device: dev, previousState: old.state });
        }
      }
    }

    for (const [id, dev] of this.devices.entries()) {
      if (!discovered.has(id)) {
        dev.state = DEVICE_STATES.DISCONNECTED;
        this.emit("device_disconnected", dev);
      }
    }

    this.devices = discovered;

    // Auto-select device if only one device is connected and none currently selected
    if (this.devices.size === 1 && !this.selectedDeviceId) {
      this.selectedDeviceId = Array.from(this.devices.keys())[0];
    } else if (this.selectedDeviceId && !this.devices.has(this.selectedDeviceId)) {
      this.selectedDeviceId = this.devices.size > 0 ? Array.from(this.devices.keys())[0] : null;
    }

    return Array.from(this.devices.values());
  }

  /**
   * Get all registered devices.
   */
  getDevices() {
    return Array.from(this.devices.values());
  }

  /**
   * Get currently selected default device.
   */
  getSelectedDevice() {
    if (!this.selectedDeviceId) return null;
    return this.devices.get(this.selectedDeviceId) || null;
  }

  /**
   * Explicitly select an active device by ID.
   */
  selectDevice(deviceId) {
    if (!deviceId) {
      this.selectedDeviceId = null;
      return null;
    }
    const dev = this.devices.get(deviceId);
    if (!dev) {
      throw new Error(`Device '${deviceId}' is not registered or connected.`);
    }
    this.selectedDeviceId = deviceId;
    this.emit("device_selected", dev);
    return dev;
  }

  /**
   * Get detailed device information including telemetry and screen bounds.
   */
  async getDeviceDetails(deviceId) {
    const id = deviceId || this.selectedDeviceId;
    if (!id) {
      throw new Error("No device specified and no default device selected.");
    }

    const dev = this.devices.get(id);
    if (!dev) {
      throw new Error(`Device '${id}' not found in registry.`);
    }

    if (dev.platform === DEVICE_PLATFORMS.ANDROID && dev.state === DEVICE_STATES.ONLINE) {
      const details = await this.adb.getDeviceDetails(id);
      const fg = await this.adb.getForegroundApp(id);
      return {
        ...dev,
        ...details,
        foregroundApp: fg
      };
    }

    return dev;
  }

  /**
   * Platform diagnostics for UI and release audits.
   */
  async getPlatformDiagnostics() {
    const isWindows = process.platform === "win32";
    const adbAvail = await this.adb.checkAvailability();

    return {
      hostPlatform: process.platform,
      hostArch: process.arch,
      android: {
        supported: true,
        adbAvailable: adbAvail.available,
        adbPath: adbAvail.path,
        adbVersion: adbAvail.version,
        error: adbAvail.error || null,
        connectedDevices: Array.from(this.devices.values()).filter(d => d.platform === DEVICE_PLATFORMS.ANDROID).length
      },
      ios: {
        supported: !isWindows,
        simulatorSupported: process.platform === "darwin",
        reason: isWindows
          ? "iOS device and simulator control requires macOS with Xcode or Linux with compiled go-ios. Unavailable on Windows host."
          : "macOS environment detected.",
        connectedDevices: 0
      }
    };
  }

  /**
   * Start background polling for hot-plugged devices.
   */
  startPolling(intervalMs) {
    if (this.isPolling) return;
    this.isPolling = true;
    const interval = intervalMs || this.pollIntervalMs;
    this.scanDevices().catch(() => {});
    this._pollTimer = setInterval(() => {
      this.scanDevices().catch(() => {});
    }, interval);
  }

  /**
   * Stop background polling.
   */
  stopPolling() {
    this.isPolling = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}

export const mobileDeviceRegistry = new MobileDeviceRegistry();
