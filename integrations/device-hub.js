/**
 * ULTRON AI — Android & Multi-Device Integration Hub
 *
 * Provides cryptographic device pairing, cross-device task submission,
 * real-time device telemetry, and remote notification dispatching.
 */

import crypto from "node:crypto";

export class DeviceHub {
  constructor(options = {}) {
    this.pairedDevices = new Map();
    this.pendingPairings = new Map();
    this.notifications = [];
    this.maxNotifications = 100;
  }

  /**
   * Generate a 6-digit pairing code with 5-minute expiry for a new companion device.
   */
  createPairingCode(deviceMeta = {}) {
    const code = crypto.randomInt(100000, 999999).toString();
    const entry = {
      code,
      deviceName: deviceMeta.name || "Android Phone",
      platform: deviceMeta.platform || "android",
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    };
    this.pendingPairings.set(code, entry);
    return { code, expiresAt: new Date(entry.expiresAt).toISOString(), deviceName: entry.deviceName };
  }

  /**
   * Complete device pairing using the pairing code.
   */
  verifyPairingCode(code, clientPublicKey = null) {
    const cleanCode = String(code).trim();
    const entry = this.pendingPairings.get(cleanCode);

    if (!entry) {
      return { success: false, error: "INVALID_PAIRING_CODE" };
    }

    if (Date.now() > entry.expiresAt) {
      this.pendingPairings.delete(cleanCode);
      return { success: false, error: "PAIRING_CODE_EXPIRED" };
    }

    const deviceId = "dev-" + crypto.randomUUID();
    const authToken = "ultron_dev_" + crypto.randomBytes(24).toString("hex");

    const device = {
      id: deviceId,
      name: entry.deviceName,
      platform: entry.platform,
      authToken,
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      battery: null,
      online: true,
      publicKey: clientPublicKey
    };

    this.pairedDevices.set(deviceId, device);
    this.pendingPairings.delete(cleanCode);

    return {
      success: true,
      deviceId,
      authToken,
      deviceName: device.name,
      platform: device.platform
    };
  }

  /**
   * Authenticate a device token.
   */
  authenticateDevice(deviceId, token) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return null;
    if (device.authToken !== token) return null;
    device.lastSeenAt = new Date().toISOString();
    return device;
  }

  /**
   * Update device telemetry (e.g. Android battery, network state).
   */
  updateDeviceTelemetry(deviceId, telemetry = {}) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return false;

    if (typeof telemetry.batteryPercent === "number") {
      device.battery = {
        percent: Math.max(0, Math.min(100, telemetry.batteryPercent)),
        isCharging: Boolean(telemetry.isCharging)
      };
    }
    if (typeof telemetry.online === "boolean") {
      device.online = telemetry.online;
    }
    device.lastSeenAt = new Date().toISOString();
    return true;
  }

  /**
   * Push a notification to a specific device or broadcast to all paired devices.
   */
  sendNotification({ deviceId, title, body, priority = "normal", type = "task_update" }) {
    const notification = {
      id: "notif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      targetDeviceId: deviceId || "broadcast",
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 500),
      priority,
      type,
      timestamp: new Date().toISOString(),
      delivered: true
    };

    this.notifications.unshift(notification);
    if (this.notifications.length > this.maxNotifications) {
      this.notifications.pop();
    }

    return notification;
  }

  listPairedDevices() {
    return Array.from(this.pairedDevices.values()).map(dev => ({
      id: dev.id,
      name: dev.name,
      platform: dev.platform,
      online: dev.online,
      battery: dev.battery,
      pairedAt: dev.pairedAt,
      lastSeenAt: dev.lastSeenAt
    }));
  }

  getNotifications(limit = 20) {
    return this.notifications.slice(0, limit);
  }

  unpairDevice(deviceId) {
    const deleted = this.pairedDevices.delete(deviceId);
    return { success: deleted, deviceId };
  }
}
