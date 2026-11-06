/**
 * ULTRON AI — Android & Multi-Device Integration Hub
 *
 * Provides cryptographic device pairing, cross-device task submission,
 * real-time device telemetry, remote notification dispatching, and
 * durable owner-scoped device persistence.
 *
 * Non-Negotiable Security Invariants:
 * 1. Plaintext device tokens are NEVER persisted to disk or database.
 * 2. Device authentication looks up by SHA-256 token hash and compares
 *    using constant-time crypto.timingSafeEqual.
 * 3. Pairing codes are 6-digit numeric, single-use, with a strict 5-minute expiry.
 * 4. Tokens are AES-256-GCM encrypted for HMAC signature recovery across restarts.
 * 5. Device operations are owner-scoped and support immediate revocation.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeTimingCompare(aHex, bHex) {
  if (!aHex || !bHex) return false;
  try {
    const a = Buffer.from(String(aHex), "hex");
    const b = Buffer.from(String(bHex), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function deriveEncryptionKey(masterSecret = "") {
  const secret = String(masterSecret || "").trim();
  // Persistent token encryption must use a dedicated, high-entropy secret.
  // Never fall back to a public constant or reuse the Supabase service-role key.
  if (secret.length < 32) return null;
  return crypto.createHash("sha256").update("ULTRON_DEVICE_STORE_V1:").update(secret).digest();
}

function encryptToken(token, masterKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  let encrypted = cipher.update(String(token), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decryptToken(encryptedData, masterKey) {
  if (!encryptedData || typeof encryptedData !== "string" || !encryptedData.includes(":")) return null;
  try {
    const [ivHex, authTagHex, cipherHex] = encryptedData.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}


export const APPROVED_REMOTE_ACTIONS = new Set([
  "launch_app",
  "close_app",
  "lock_workstation",
  "unlock_workstation",
  "set_volume",
  "screen_capture",
  "get_system_vitals",
  "sandboxed_file_list",
  "sandboxed_file_read",
  "media_playback",
  "wake_device",
  "notify",
  "open_folder",
  "find_file",
  "inspect_task",
  "stop_task",
  "get_task_output",
  "emergency_stop"
]);

export const APPROVED_REMOTE_APPS = new Set([
  "chrome",
  "msedge",
  "edge",
  "code",
  "vscode",
  "notepad",
  "calculator",
  "calc",
  "explorer",
  "terminal",
  "cmd",
  "spotify"
]);

export class DeviceHub {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.pairedDevices = new Map();
    this.revokedDevices = new Set();
    this.pendingPairings = new Map();
    this.commandQueue = new Map();
    this.notifications = [];
    this.maxNotifications = 100;
    this.taskHistory = [];
    this.sharedConversations = [];
    this.idempotencyIndex = new Map();
    this.eventListeners = new Set();

    const defaultStoreDir = path.resolve(process.cwd(), ".local", "device-hub");
    this.durableStoragePath = options.durableStoragePath || this.env.ULTRON_DEVICE_STORE_PATH || path.join(defaultStoreDir, "paired-devices.json");
    const persistenceRequested = Boolean(options.durableStoragePath || this.env.ULTRON_DEVICE_STORE_PATH || options.persistent === true);
    const configuredSecret = options.masterSecret || this.env.ULTRON_DEVICE_SIGNING_SECRET || "";
    this.masterKey = deriveEncryptionKey(configuredSecret);
    this.isPersistent = persistenceRequested && Boolean(this.masterKey);
    this.persistenceError = persistenceRequested && !this.masterKey
      ? "ULTRON_DEVICE_SIGNING_SECRET_REQUIRED_MIN_32_CHARS"
      : null;

    // In-memory development pairing may use a process-only random key. It is
    // deliberately unusable after restart and is never represented as durable.
    if (!this.masterKey) this.masterKey = crypto.randomBytes(32);

    if (this.isPersistent) {
      this.loadFromDisk();
    }
  }

  /**
   * Hydrates a device already verified against the durable Supabase registry.
   * The DB remains authoritative; this is only an in-process command cache.
   */
  importPairedDevice(record = {}) {
    const id = String(record.id || "").trim();
    const ownerUserId = String(record.ownerUserId || record.owner_user_id || "").trim();
    const authToken = String(record.authToken || "").trim();
    if (!id || !ownerUserId || !/^ultron_dev_[a-f0-9]{64}$/i.test(authToken) ||
        record.status === "revoked" || this.revokedDevices.has(id)) return null;

    const previous = this.pairedDevices.get(id);
    const platform = String(record.platform || previous?.platform || "unknown").toLowerCase();
    const incomingTokenHash = hashToken(authToken);
    const maxStaleMs = platform === "android" ? 35 * 60 * 1000 : 90 * 1000;
    // Preserve only a fresh, already-authenticated in-process session for the
    // same owner and credential. DB identity/timestamps alone never restore it.
    const previousSessionIsLive = Boolean(
      previous &&
      previous.ownerUserId === ownerUserId &&
      previous.tokenHash === incomingTokenHash &&
      previous.status !== "revoked" &&
      this.isDeviceOnline(id, maxStaleMs)
    );
    const now = new Date().toISOString();
    const device = {
      ...(previous || {}),
      id,
      name: String(record.name || record.device_name || previous?.name || "Companion Device").slice(0, 120),
      platform,
      authToken,
      tokenHash: incomingTokenHash,
      tokenPrefix: authToken.slice(0, 20),
      ownerUserId,
      status: "active",
      pairedAt: record.pairedAt || record.paired_at || previous?.pairedAt || now,
      lastSeenAt: previousSessionIsLive
        ? previous.lastSeenAt
        : (record.lastSeenAt || record.last_seen_at || previous?.lastSeenAt || null),
      battery: previous?.battery || null,
      // A durable pairing record proves identity, not current connectivity.
      // Only a still-fresh authenticated in-process heartbeat/socket is trusted.
      online: previousSessionIsLive,
      source: "supabase"
    };
    this.pairedDevices.set(id, device);
    return device;
  }

  /**
   * Loads durable paired devices from encrypted disk registry.
   */
  loadFromDisk() {
    try {
      if (!fs.existsSync(this.durableStoragePath)) return false;
      const raw = fs.readFileSync(this.durableStoragePath, "utf8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data.devices)) return false;

      for (const item of data.devices) {
        if (!item.id || !item.tokenHash) continue;
        const decryptedAuthToken = decryptToken(item.encryptedAuthToken, this.masterKey);
        if (item.status === "revoked") this.revokedDevices.add(item.id);
        this.pairedDevices.set(item.id, {
          id: item.id,
          name: item.name,
          platform: item.platform,
          tokenHash: item.tokenHash,
          tokenPrefix: item.tokenPrefix || "ultron_dev_",
          authToken: decryptedAuthToken,
          encryptedAuthToken: item.encryptedAuthToken,
          ownerUserId: item.ownerUserId || "operator",
          status: item.status || "active",
          capabilities: item.capabilities || {},
          pairedAt: item.pairedAt || new Date().toISOString(),
          lastSeenAt: item.lastSeenAt || new Date().toISOString(),
          battery: item.battery || null,
          online: false,
          revokedAt: item.revokedAt || null
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely writes durable paired device registry to disk atomically.
   */
  saveToDisk() {
    if (!this.isPersistent) return false;
    try {
      const dir = path.dirname(this.durableStoragePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const devices = Array.from(this.pairedDevices.values()).map(dev => ({
        id: dev.id,
        name: dev.name,
        platform: dev.platform,
        tokenHash: dev.tokenHash,
        tokenPrefix: dev.tokenPrefix,
        encryptedAuthToken: dev.encryptedAuthToken || (dev.authToken ? encryptToken(dev.authToken, this.masterKey) : null),
        ownerUserId: dev.ownerUserId,
        status: dev.status || "active",
        capabilities: dev.capabilities || {},
        pairedAt: dev.pairedAt,
        lastSeenAt: dev.lastSeenAt,
        revokedAt: dev.revokedAt || null
      }));

      const payload = JSON.stringify({
        version: "2.0.0",
        updatedAt: new Date().toISOString(),
        deviceCount: devices.length,
        devices
      }, null, 2);

      const tmpPath = `${this.durableStoragePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmpPath, this.durableStoragePath);
      return true;
    } catch {
      return false;
    }
  }

  _persistOrRollback(rollback) {
    if (this.persistenceError) {
      rollback();
      return { success: false, error: "DEVICE_PERSISTENCE_NOT_CONFIGURED", reason: this.persistenceError };
    }
    if (!this.isPersistent || this.saveToDisk()) return { success: true };
    rollback();
    return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
  }

  /**
   * Generate a 6-digit pairing code with 5-minute expiry for a new companion device.
   */
  createPairingCode(deviceMeta = {}) {
    const code = crypto.randomInt(100000, 999999).toString();
    const entry = {
      code,
      deviceName: deviceMeta.name || "Companion Device",
      platform: deviceMeta.platform || "windows",
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    };
    this.pendingPairings.set(code, entry);
    return { code, expiresAt: new Date(entry.expiresAt).toISOString(), deviceName: entry.deviceName };
  }

  /**
   * Complete device pairing using the pairing code.
   */
  verifyPairingCode(code, clientPublicKey = null, ownerUserId = "operator") {
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
    const authToken = "ultron_dev_" + crypto.randomBytes(32).toString("hex");
    const tokenDigest = hashToken(authToken);
    const encrypted = encryptToken(authToken, this.masterKey);

    const device = {
      id: deviceId,
      name: entry.deviceName,
      platform: entry.platform,
      authToken,
      tokenHash: tokenDigest,
      tokenPrefix: authToken.slice(0, 15),
      encryptedAuthToken: encrypted,
      ownerUserId: String(ownerUserId || "operator"),
      status: "active",
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      battery: null,
      // Pairing completes authorization; it does not prove the client is connected.
      online: false,
      publicKey: clientPublicKey,
      capabilities: entry.capabilities || {}
    };

    this.pairedDevices.set(deviceId, device);
    this.pendingPairings.delete(cleanCode);
    const persisted = this._persistOrRollback(() => {
      this.pairedDevices.delete(deviceId);
      this.pendingPairings.set(cleanCode, entry);
    });
    if (!persisted.success) return persisted;

    return {
      success: true,
      deviceId,
      authToken,
      deviceName: device.name,
      platform: device.platform
    };
  }

  /**
   * Approve a pending pairing code (owner action).
   */
  approvePairingCode(code, ownerUserId = "operator") {
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
    const deviceToken = "ultron_dev_" + crypto.randomBytes(32).toString("hex");
    const tokenDigest = hashToken(deviceToken);
    const encrypted = encryptToken(deviceToken, this.masterKey);

    const device = {
      id: deviceId,
      name: entry.deviceName,
      platform: entry.platform,
      authToken: deviceToken,
      tokenHash: tokenDigest,
      tokenPrefix: deviceToken.slice(0, 15),
      encryptedAuthToken: encrypted,
      ownerUserId: String(ownerUserId || "operator"),
      status: "active",
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      battery: null,
      // Approval/claim does not prove the companion has connected yet.
      online: false,
      publicKey: null,
      capabilities: {}
    };

    const previousEntry = { ...entry };
    this.pairedDevices.set(deviceId, device);
    entry.approved = true;
    entry.deviceId = deviceId;
    entry.deviceToken = deviceToken;
    const persisted = this._persistOrRollback(() => {
      this.pairedDevices.delete(deviceId);
      for (const key of Object.keys(entry)) delete entry[key];
      Object.assign(entry, previousEntry);
    });
    if (!persisted.success) return persisted;

    return {
      success: true,
      deviceId,
      deviceToken,
      deviceName: device.name,
      platform: device.platform
    };
  }

  /**
   * Claim an approved pairing code (companion device action).
   */
  claimPairingCode(code) {
    const cleanCode = String(code).trim();
    const entry = this.pendingPairings.get(cleanCode);
    if (!entry) {
      return { success: false, error: "INVALID_PAIRING_CODE" };
    }
    if (Date.now() > entry.expiresAt) {
      this.pendingPairings.delete(cleanCode);
      return { success: false, error: "PAIRING_CODE_EXPIRED" };
    }
    if (!entry.approved) {
      return { success: false, error: "PAIRING_NOT_YET_APPROVED" };
    }

    const result = {
      success: true,
      deviceId: entry.deviceId,
      deviceToken: entry.deviceToken,
      deviceName: entry.deviceName,
      platform: entry.platform
    };

    this.pendingPairings.delete(cleanCode);
    return result;
  }

  /**
   * Look up a paired device by its token (hashes token and compares in constant time).
   */
  findDeviceByToken(token) {
    if (!token || typeof token !== "string") return null;
    const incomingHash = hashToken(token);

    for (const dev of this.pairedDevices.values()) {
      if (dev.status === "revoked") continue;
      if (safeTimingCompare(dev.tokenHash, incomingHash) || (dev.authToken && dev.authToken === token)) {
        dev.lastSeenAt = new Date().toISOString();
        return dev;
      }
    }
    return null;
  }

  /**
   * Authenticate a device token against device ID.
   */
  authenticateDevice(deviceId, token) {
    const device = this.pairedDevices.get(deviceId);
    if (!device || device.status === "revoked") return null;

    const incomingHash = hashToken(token);
    const isMatch = safeTimingCompare(device.tokenHash, incomingHash) || (device.authToken && device.authToken === token);
    if (!isMatch) return null;

    device.lastSeenAt = new Date().toISOString();
    return device;
  }

  /**
   * Revoke a paired device.
   */
  revokeDevice(deviceId, ownerUserId, { authoritativeExternal = false } = {}) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return { success: false, error: "DEVICE_NOT_FOUND" };
    if (ownerUserId && device.ownerUserId !== ownerUserId) {
      return { success: false, error: "ACCESS_DENIED_NOT_DEVICE_OWNER" };
    }

    const previousDevice = { ...device };
    const previousQueue = this.commandQueue.get(deviceId);
    device.status = "revoked";
    device.revokedAt = new Date().toISOString();
    this.revokedDevices.add(deviceId);
    this.commandQueue.delete(deviceId);
    const persisted = !this.isPersistent || this.saveToDisk();
    if (!persisted && !authoritativeExternal) {
      Object.assign(device, previousDevice);
      this.revokedDevices.delete(deviceId);
      if (previousQueue) this.commandQueue.set(deviceId, previousQueue);
      return { success: false, error: "DEVICE_PERSISTENCE_FAILED" };
    }
    this.emitEvent({ type: "DEVICE_REVOKED", deviceId, ownerUserId: device.ownerUserId });

    return {
      success: true,
      deviceId,
      status: "revoked",
      ...(!persisted ? { localPersistenceWarning: "AUTHORITATIVE_EXTERNAL_REVOCATION_APPLIED" } : {})
    };
  }

  /**
   * Rotate a device's authentication token.
   */
  rotateDeviceToken(deviceId, ownerUserId) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return { success: false, error: "DEVICE_NOT_FOUND" };
    if (ownerUserId && device.ownerUserId !== ownerUserId) {
      return { success: false, error: "ACCESS_DENIED_NOT_DEVICE_OWNER" };
    }

    const previousDevice = { ...device };
    const wasRevoked = this.revokedDevices.has(deviceId);
    const newToken = "ultron_dev_" + crypto.randomBytes(32).toString("hex");
    device.authToken = newToken;
    device.tokenHash = hashToken(newToken);
    device.tokenPrefix = newToken.slice(0, 15);
    device.encryptedAuthToken = encryptToken(newToken, this.masterKey);
    device.status = "active";
    device.revokedAt = null;
    device.online = false;
    device.lastSeenAt = null;
    this.revokedDevices.delete(deviceId);
    const persisted = this._persistOrRollback(() => {
      Object.assign(device, previousDevice);
      if (wasRevoked) this.revokedDevices.add(deviceId);
    });
    if (!persisted.success) return persisted;
    this.emitEvent({ type: "DEVICE_CREDENTIALS_ROTATED", deviceId, ownerUserId: device.ownerUserId });

    return { success: true, deviceId, newDeviceToken: newToken };
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
  sendNotification({ ownerUserId = null, deviceId, title, body, priority = "normal", type = "task_update" }) {
    const notification = {
      id: "notif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      ownerUserId,
      targetDeviceId: deviceId || "broadcast",
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 500),
      priority,
      type,
      timestamp: new Date().toISOString(),
      delivered: false,
      deliveryStatus: "NOT_DISPATCHED"
    };

    this.notifications.unshift(notification);
    if (this.notifications.length > this.maxNotifications) {
      this.notifications.pop();
    }

    return notification;
  }

  listPairedDevices(ownerUserId = null) {
    let list = Array.from(this.pairedDevices.values());
    if (ownerUserId) {
      list = list.filter(dev => dev.ownerUserId === ownerUserId);
    }
    return list.map(dev => ({
      id: dev.id,
      ownerUserId: dev.ownerUserId,
      name: dev.name,
      platform: dev.platform,
      status: dev.status || "active",
      online: this.isDeviceOnline(dev.id),
      battery: dev.battery,
      pairedAt: dev.pairedAt,
      lastSeenAt: dev.lastSeenAt,
      tokenPrefix: dev.tokenPrefix || "ultron_dev_..."
    }));
  }

  getNotifications(limit = 20, filter = {}) {
    const list = filter.ownerUserId
      ? this.notifications.filter(notification => notification.ownerUserId === filter.ownerUserId)
      : this.notifications;
    return list.slice(0, Math.max(0, Math.min(100, Number(limit) || 20)));
  }

  unpairDevice(deviceId) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return { success: false, deviceId };
    const previousQueue = this.commandQueue.get(deviceId);
    this.pairedDevices.delete(deviceId);
    this.commandQueue.delete(deviceId);
    const persisted = this._persistOrRollback(() => {
      this.pairedDevices.set(deviceId, device);
      if (previousQueue) this.commandQueue.set(deviceId, previousQueue);
    });
    if (!persisted.success) return persisted;
    return { success: true, deviceId };
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
      return safeTimingCompare(expected, signature);
    } catch {
      return false;
    }
  }

  /**
   * Enqueue a signed remote command for a paired companion device.
   */
  enqueueCommand(deviceId, action, payload = {}) {
    const device = this.pairedDevices.get(deviceId);
    if (!device || device.status === "revoked") {
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

    const token = device.authToken || decryptToken(device.encryptedAuthToken, this.masterKey);
    if (!token) {
      return { success: false, error: "SIGNING_KEY_UNAVAILABLE" };
    }

    const signature = this.signPayload(token, rawPayload);

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

    const task = this.taskHistory.find(t => t.id === commandId);
    if (task) {
      task.status = cmd.status;
      task.result = result;
      task.completedAt = new Date().toISOString();
    }
    const scopedIdempotencyKey = cmd.payload?.idempotencyKey
      ? `${device.ownerUserId}:${cmd.payload.idempotencyKey}`
      : null;
    if (scopedIdempotencyKey && this.idempotencyIndex.has(scopedIdempotencyKey)) {
      this.idempotencyIndex.set(scopedIdempotencyKey, {
        command: cmd,
        status: cmd.status,
        result
      });
    }

    this.emitEvent({
      type: "COMMAND_COMPLETE",
      deviceId,
      commandId,
      status: cmd.status,
      result
    });

    return { success: true, commandId, status: cmd.status };
  }

  /**
   * Generates a QR-code pairing payload for instant mobile camera pairing.
   */
  generatePairingQr(deviceMeta = {}, baseUrl = "") {
    const pairing = this.createPairingCode(deviceMeta);
    const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
    const qrPayload = `ultron://pair?code=${pairing.code}&server=${encodeURIComponent(cleanBase)}&platform=${deviceMeta.platform || "windows"}&expiresAt=${pairing.expiresAt}`;
    return {
      success: true,
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      deviceName: pairing.deviceName,
      platform: deviceMeta.platform || "windows",
      qrPayload,
      pairingUrl: `${cleanBase}/api/devices/pairings/claim`
    };
  }

  /**
   * Updates device presence via heartbeat ping.
   */
  heartbeat(deviceId, authToken, telemetry = {}) {
    const device = this.authenticateDevice(deviceId, authToken);
    if (!device) return { success: false, error: "AUTHENTICATION_FAILED" };
    device.online = true;
    device.lastSeenAt = new Date().toISOString();
    if (typeof telemetry.batteryPercent === "number") {
      device.battery = {
        percent: Math.max(0, Math.min(100, telemetry.batteryPercent)),
        isCharging: Boolean(telemetry.isCharging)
      };
    }
    if (telemetry.vitals) {
      device.vitals = telemetry.vitals;
    }
    this.emitEvent({
      type: "HEARTBEAT",
      deviceId,
      platform: device.platform,
      online: true,
      lastSeenAt: device.lastSeenAt,
      battery: device.battery
    });
    return { success: true, deviceId, online: true, lastSeenAt: device.lastSeenAt };
  }

  /**
   * Checks whether a device is currently active and has communicated recently.
   * If the last contact exceeds maxStaleMs, the device is marked OFFLINE.
   */
  isDeviceOnline(deviceId, maxStaleMs = null) {
    const device = this.pairedDevices.get(deviceId);
    if (!device || device.status === "revoked" || this.revokedDevices.has(deviceId)) return false;
    if (device.online !== true) return false;
    const platformWindow = device.platform === "android" ? 35 * 60 * 1000 : 90 * 1000;
    const freshnessWindow = Number.isFinite(maxStaleMs) && maxStaleMs >= 0 ? maxStaleMs : platformWindow;
    const lastSeen = Date.parse(device.lastSeenAt || "");
    const ageMs = Date.now() - lastSeen;
    const isFresh = Number.isFinite(lastSeen) && ageMs >= 0 && ageMs <= freshnessWindow;
    if (!isFresh) {
      device.online = false;
      return false;
    }
    return true;
  }

  /**
   * Retrieves device presence status.
   */
  getDevicePresence(deviceId) {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return { exists: false, online: false };
    const online = this.isDeviceOnline(deviceId);
    return {
      exists: true,
      id: device.id,
      name: device.name,
      platform: device.platform,
      online,
      lastSeenAt: device.lastSeenAt,
      battery: device.battery,
      status: device.status
    };
  }

  /**
   * Routes a remote command from a caller device (e.g. Android) to a target device (e.g. Windows PC).
   * Verifies authentication, presence, permission allowlists, and idempotency.
   * NEVER claims execution if the target device is offline.
   */
  routeCommand({
    callerDeviceId = null,
    callerToken = null,
    callerUserId = "operator",
    targetDeviceId = null,
    targetPlatform = null,
    action,
    payload = {},
    idempotencyKey = null
  }) {
    // 1. Caller verification
    if (callerDeviceId && callerToken) {
      const caller = this.authenticateDevice(callerDeviceId, callerToken);
      if (!caller) {
        return { success: false, error: "CALLER_AUTHENTICATION_FAILED", message: "Calling device authentication failed." };
      }
      callerUserId = caller.ownerUserId || callerUserId;
    }

    // 2. Validate action against allowlist
    const cleanAction = String(action || "").toLowerCase().trim();
    if (!APPROVED_REMOTE_ACTIONS.has(cleanAction)) {
      return {
        success: false,
        error: "ACTION_NOT_APPROVED",
        message: `Action '${action}' is not in the approved remote action allowlist. Arbitrary shell execution is forbidden.`
      };
    }

    // Special validation for launch_app
    if (cleanAction === "launch_app") {
      const app = String(payload.app || payload.appKey || payload.name || "").toLowerCase().trim();
      if (!app || !APPROVED_REMOTE_APPS.has(app)) {
        return {
          success: false,
          error: "APP_NOT_ALLOWLISTED",
          message: `Application '${app}' is not in the approved remote launch allowlist (${Array.from(APPROVED_REMOTE_APPS).join(", ")}).`
        };
      }
    }

    // 3. Resolve target device
    let target = null;
    if (targetDeviceId) {
      target = this.pairedDevices.get(targetDeviceId);
    } else if (targetPlatform) {
      const normPlatform = targetPlatform.toLowerCase().trim();
      for (const dev of this.pairedDevices.values()) {
        if (dev.status === "active" && (dev.platform === normPlatform || (normPlatform === "windows" && dev.platform === "windows_pc"))) {
          if (callerUserId && dev.ownerUserId === callerUserId) {
            target = dev;
            break;
          }
        }
      }
    }

    if (!target) {
      return {
        success: false,
        error: "TARGET_DEVICE_NOT_FOUND",
        message: `No paired target device found matching ${targetDeviceId || targetPlatform}.`
      };
    }

    // A caller must never operate a device owned by another account. This check
    // also protects explicit targetDeviceId requests, not only platform searches.
    if (!callerUserId || !target.ownerUserId || target.ownerUserId !== callerUserId) {
      return {
        success: false,
        error: "ACCESS_DENIED_NOT_DEVICE_OWNER",
        message: "The requested device belongs to a different ULTRON account."
      };
    }

    // 4. Strict presence check: Windows PC must report offline status when disconnected or powered off.
    // NEVER pretend a remote task executed when the PC is unavailable.
    if (!this.isDeviceOnline(target.id)) {
      return {
        success: false,
        error: "TARGET_DEVICE_OFFLINE",
        message: `Target device '${target.name}' is currently OFFLINE or unreachable. Remote task was not dispatched.`,
        targetDevice: {
          id: target.id,
          name: target.name,
          platform: target.platform,
          online: false,
          lastSeenAt: target.lastSeenAt
        }
      };
    }

    // Idempotency keys are private to an owner; another account may reuse a key.
    const scopedIdempotencyKey = idempotencyKey ? `${callerUserId}:${idempotencyKey}` : null;
    // 5. Check idempotency to prevent duplicate execution upon reconnect
    if (scopedIdempotencyKey) {
      const existing = this.idempotencyIndex.get(scopedIdempotencyKey);
      if (existing) {
        return {
          success: true,
          deduplicated: true,
          command: existing.command,
          status: existing.status,
          result: existing.result
        };
      }
    }

    // 6. Enqueue command for target device
    const enqResult = this.enqueueCommand(target.id, cleanAction, {
      ...payload,
      idempotencyKey,
      callerDeviceId: callerDeviceId || null,
      callerUserId
    });

    if (!enqResult.success) return enqResult;

    // 7. Track in shared task history
    const taskEntry = {
      id: enqResult.command.id,
      idempotencyKey: idempotencyKey || null,
      action: cleanAction,
      payload,
      callerDeviceId: callerDeviceId || "operator",
      callerUserId,
      ownerUserId: target.ownerUserId,
      targetDeviceId: target.id,
      targetDeviceName: target.name,
      targetPlatform: target.platform,
      status: "dispatched",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null
    };

    this.recordSharedTask(taskEntry);

    if (scopedIdempotencyKey) {
      this.idempotencyIndex.set(scopedIdempotencyKey, {
        command: enqResult.command,
        status: "dispatched",
        result: null
      });
    }

    // 8. Emit real-time event for WebSocket / SSE subscribers
    this.emitEvent({
      type: "COMMAND_DISPATCH",
      targetDeviceId: target.id,
      command: enqResult.command
    });

    return {
      success: true,
      routed: true,
      commandId: enqResult.command.id,
      command: enqResult.command,
      targetDevice: {
        id: target.id,
        name: target.name,
        platform: target.platform,
        online: true
      }
    };
  }

  /**
   * Records a task in the shared cross-device task history.
   */
  recordSharedTask(task) {
    this.taskHistory.unshift(task);
    if (this.taskHistory.length > 200) this.taskHistory.pop();
    return task;
  }

  /**
   * Retrieves shared cross-device task history.
   */
  getSharedTasks(limit = 50, filter = {}) {
    let list = this.taskHistory;
    if (filter.ownerUserId) list = list.filter(t => t.ownerUserId === filter.ownerUserId);
    if (filter.targetDeviceId) list = list.filter(t => t.targetDeviceId === filter.targetDeviceId);
    if (filter.callerUserId) list = list.filter(t => t.callerUserId === filter.callerUserId);
    return list.slice(0, limit);
  }

  /**
   * Records a message in the shared cross-device conversation context.
   */
  recordSharedMessage(message) {
    const entry = {
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      source: message.source || "user",
      platform: message.platform || "unknown",
      role: message.role || "user",
      ownerUserId: message.ownerUserId || null,
      content: String(message.content || "").slice(0, 4000),
      timestamp: new Date().toISOString()
    };
    this.sharedConversations.push(entry);
    if (this.sharedConversations.length > 500) this.sharedConversations.shift();
    this.emitEvent({ type: "MESSAGE", message: entry });
    return entry;
  }

  /**
   * Retrieves shared conversation history.
   */
  getSharedMessages(limit = 50) {
    return this.sharedConversations.slice(-limit);
  }

  /**
   * Registers a real-time event listener (used by WebSocket gateway and SSE).
   */
  registerEventListener(listener) {
    if (typeof listener === "function") {
      this.eventListeners.add(listener);
      return () => this.eventListeners.delete(listener);
    }
    return () => {};
  }

  /**
   * Broadcasts an event to all registered real-time listeners.
   */
  emitEvent(event) {
    for (const listener of this.eventListeners) {
      try { listener(event); } catch {}
    }
  }

}

export const deviceHub = new DeviceHub();
