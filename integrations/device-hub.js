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
    this.commandQueue = new Map();
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
    this.commandQueue.delete(deviceId);
    return { success: deleted, deviceId };
  }

  /**
   * Cryptographically signs a command payload using the device's auth token as HMAC key.
   */
  signPayload(authToken, payload) {
    const canonical = typeof payload === "string" ? payload : JSON.stringify(payload);
    return crypto.createHmac("sha256", authToken).update(canonical).digest("hex");
  }

  /**
   * Verifies an HMAC-SHA256 signature against the device's auth token.
   */
  verifySignature(authToken, payload, signature) {
    if (!authToken || !signature) return false;
    try {
      const expected = this.signPayload(authToken, payload);
      const expectedBuf = Buffer.from(expected, "hex");
      const sigBuf = Buffer.from(signature, "hex");
      if (expectedBuf.length !== sigBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch {
      return false;
    }
  }

  /**
   * Enqueue a signed remote command for a paired companion device.
   */
  enqueueCommand(deviceId, action, payload = {}) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) {
      return { success: false, error: "DEVICE_NOT_FOUND" };
    }

    const commandId = "cmd-" + crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + 5 * 60 * 1000; // 5-minute expiry

    const rawPayload = {
      id: commandId,
      deviceId,
      action: String(action),
      payload,
      createdAt,
      expiresAt
    };

    const signature = this.signPayload(device.authToken, rawPayload);

    const command = {
      ...rawPayload,
      signature,
      status: "pending",
      result: null
    };

    const list = this.commandQueue.get(deviceId) || [];
    list.push(command);
    // Retain only latest 50 commands per device
    if (list.length > 50) list.shift();
    this.commandQueue.set(deviceId, list);

    return { success: true, command };
  }

  /**
   * Companion device polls for pending commands with bearer token authentication.
   */
  pollPendingCommands(deviceId, authToken) {
    const device = this.authenticateDevice(deviceId, authToken);
    if (!device) {
      return { success: false, error: "AUTHENTICATION_FAILED", commands: [] };
    }

    const list = this.commandQueue.get(deviceId) || [];
    const now = Date.now();
    const pending = [];

    for (const cmd of list) {
      if (cmd.status === "pending") {
        if (now > cmd.expiresAt) {
          cmd.status = "expired";
        } else {
          cmd.status = "dispatched";
          cmd.dispatchedAt = now;
          pending.push(cmd);
        }
      }
    }

    return { success: true, commands: pending };
  }

  /**
   * Companion device reports task completion with signed result payload.
   */
  completeCommand(deviceId, commandId, authToken, result = {}) {
    const device = this.authenticateDevice(deviceId, authToken);
    if (!device) {
      return { success: false, error: "AUTHENTICATION_FAILED" };
    }

    const list = this.commandQueue.get(deviceId) || [];
    const cmd = list.find(c => c.id === commandId);
    if (!cmd) {
      return { success: false, error: "COMMAND_NOT_FOUND" };
    }

    cmd.status = result.error ? "failed" : "completed";
    cmd.result = result;
    cmd.completedAt = Date.now();

    return { success: true, commandId, status: cmd.status };
  }
}
