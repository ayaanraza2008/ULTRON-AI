/**
 * ULTRON AI — Mobile Permission, Safety & User Control Engine
 *
 * Implements strict per-device authorization, 4-tier permission hierarchy,
 * single-use confirmation token generation with replay prevention,
 * sensitive app shields, URL sanitization, and tamper-resistant audit logging.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export const MOBILE_PERMISSION_LEVELS = {
  LEVEL_1_READ: 1,      // Read-only inspection, screen dimensions, accessibility tree
  LEVEL_2_INTERACTION: 2,// Non-destructive UI interaction (tap, scroll, type, launch allowed app)
  LEVEL_3_SENSITIVE: 3,  // App termination, data clearing, clipboard access, location changes
  LEVEL_4_CRITICAL: 4    // Package install/uninstall, messages, calls, payments, security settings
};

// Map tool actions to permission tiers
export const ACTION_PERMISSION_TIERS = {
  // Level 1: Read-only
  mobile_list_available_devices: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_get_screen_size: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_list_elements_on_screen: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_take_screenshot: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_save_screenshot: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_get_orientation: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_get_foreground_app: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_list_apps: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_get_device_logs: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_list_crashes: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,
  mobile_get_crash: MOBILE_PERMISSION_LEVELS.LEVEL_1_READ,

  // Level 2: Standard UI Interaction
  mobile_click_on_screen_at_coordinates: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_double_tap_on_screen: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_long_press_on_screen_at_coordinates: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_swipe_on_screen: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_type_keys: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_press_button: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_open_url: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_launch_app: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,
  mobile_batch_commands: MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION,

  // Level 3: Sensitive operations
  mobile_terminate_app: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_clear_app_data: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_clipboard: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_set_location: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_set_orientation: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_fold_device: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_start_screen_recording: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
  mobile_stop_screen_recording: MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE,

  // Level 4: Critical operations requiring explicit human confirmation
  mobile_install_app: MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL,
  mobile_uninstall_app: MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL,
  mobile_send_message: MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL,
  mobile_make_call: MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL,
  mobile_make_payment: MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL
};

// Packages requiring heightened scrutiny (finance, payments, messaging, security settings)
export const SENSITIVE_PACKAGES = [
  "com.android.settings",
  "com.google.android.apps.walletnfcrel", // Google Wallet
  "com.paypal.android.p2pmobile",
  "com.whatsapp",
  "org.telegram.messenger",
  "org.thoughtcrime.securesms", // Signal
  "com.google.android.apps.messaging",
  "com.android.mms",
  "com.google.android.apps.authenticator2"
];

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableSerialize).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableSerialize(value[key])).join(",") + "}";
}

const PRIVATE_SUBNETS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // Link-local and cloud metadata
  /^::1$/,
  /^fc00:/,
  /^fe80:/
];

export class MobilePermissionEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.deviceAuthorizations = new Map(); // deviceId -> { authorized: boolean, maxLevel: number }
    this.pendingConfirmations = new Map(); // token -> { action, params, deviceId, expiresAt, userId }
    this.auditLogs = [];
    this.maxAuditLogs = options.maxAuditLogs || 2000;
    this.tokenTtlMs = options.tokenTtlMs || 60000; // 60s confirmation window
  }

  /**
   * Authorize a mobile device for operation.
   */
  authorizeDevice(deviceId, maxLevel = MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION, userId = null) {
    const ownerId = typeof userId === "string" ? userId.trim() : "";
    const level = Number(maxLevel);
    if (typeof deviceId !== "string" || !deviceId.trim()) throw new Error("Device ID is required for authorization.");
    if (!ownerId) throw new Error("An authenticated owner ID is required to authorize a device.");
    if (!Number.isInteger(level) || level < MOBILE_PERMISSION_LEVELS.LEVEL_1_READ || level > MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION) {
      throw new Error("Persistent device authorization is limited to read and ordinary interaction. Sensitive actions require one-time confirmation.");
    }
    this.deviceAuthorizations.set(deviceId, {
      authorized: true,
      maxLevel: level,
      authorizedAt: Date.now(),
      authorizedBy: ownerId
    });

    this._recordAudit({
      type: "DEVICE_AUTHORIZED",
      deviceId,
      userId: ownerId,
      maxLevel: level,
      status: "GRANTED"
    });
    return { success: true, deviceId, maxLevel: level, authorizedBy: ownerId };
  }

  /**
   * Revoke device authorization.
   */
  revokeDevice(deviceId, userId = null) {
    const ownerId = typeof userId === "string" ? userId.trim() : "";
    const existing = this.deviceAuthorizations.get(deviceId);
    if (!ownerId || !existing || existing.authorizedBy !== ownerId) {
      throw new Error("Only the authenticated device owner can revoke this authorization.");
    }
    this.deviceAuthorizations.delete(deviceId);
    this._recordAudit({
      type: "DEVICE_REVOKED",
      deviceId,
      userId: ownerId,
      status: "REVOKED"
    });
    return { success: true, deviceId, revokedBy: ownerId };
  }

  /**
   * Check action against autonomy levels, sensitive app rules, and URL safety.
   */
  checkAction(action, context = {}) {
    const actionName = action.startsWith("mobile_") ? action : `mobile_${action}`;
    const requiredLevel = ACTION_PERMISSION_TIERS[actionName] || ACTION_PERMISSION_TIERS[action] || MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION;
    const targetPkg = context.package || context.packageName;

    if (targetPkg && SENSITIVE_PACKAGES.includes(targetPkg)) {
      return {
        allowed: false,
        requiresConfirmation: true,
        level: MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL,
        reason: `Interaction with sensitive application '${targetPkg}' requires explicit user confirmation.`
      };
    }

    if (context.url) {
      const urlCheck = this.sanitizeUrl(context.url);
      if (!urlCheck.safe) {
        return {
          allowed: false,
          requiresConfirmation: false,
          level: requiredLevel,
          reason: urlCheck.reason
        };
      }
    }

    const autonomyLevel = context.autonomyLevel ?? 2;
    if (requiredLevel > autonomyLevel || requiredLevel >= MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE) {
      return {
        allowed: false,
        requiresConfirmation: true,
        level: requiredLevel,
        reason: `Level ${requiredLevel} action requires confirmation.`
      };
    }

    return {
      allowed: true,
      requiresConfirmation: false,
      level: requiredLevel
    };
  }

  /**
   * Request confirmation token for an action.
   */
  requestConfirmation(action, params = {}, reason = "", userId = null) {
    const ownerId = typeof userId === "string" ? userId.trim() : "";
    if (!ownerId) throw new Error("An authenticated owner ID is required to request action confirmation.");
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + this.tokenTtlMs;
    const deviceId = params.device || params.deviceId || null;
    const req = {
      token,
      action,
      params: JSON.parse(JSON.stringify(params)),
      deviceId,
      userId: ownerId,
      reason,
      expiresAt,
      requestedAt: Date.now()
    };
    this.pendingConfirmations.set(token, req);
    this._recordAudit({
      type: "CONFIRMATION_REQUESTED",
      action,
      token,
      status: "PENDING_CONFIRMATION",
      reason
    });
    return req;
  }

  /**
   * Consume and invalidate a single-use confirmation token.
   */
  consumeConfirmation(token, action = null) {
    if (!token || !this.pendingConfirmations.has(token)) {
      return { valid: false, reason: "Confirmation token not found or already consumed (anti-replay)." };
    }
    const req = this.pendingConfirmations.get(token);
    this.pendingConfirmations.delete(token);

    if (Date.now() > req.expiresAt) {
      return { valid: false, reason: "Confirmation token has expired." };
    }
    if (action && req.action !== action && req.action !== `mobile_${action}` && `mobile_${req.action}` !== action) {
      return { valid: false, reason: `Action mismatch for token: expected ${req.action}, got ${action}` };
    }
    return { valid: true, request: req };
  }

  /**
   * Check whether a requested action on a device is permitted.
   */
  async checkPermission(actionName, params = {}, deviceId, userId = null, confirmationToken = null, approvalVerified = false) {
    userId = typeof userId === "string" ? userId.trim() : "";
    if (!userId) {
      return { permitted: false, reason: "An authenticated user identity is required for mobile control.", code: "AUTHENTICATED_USER_REQUIRED" };
    }
    let requiredLevel = ACTION_PERMISSION_TIERS[actionName] || MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE;

    // 1. Device Authorization Check — pairing is owner-bound, not global.
    const auth = this.deviceAuthorizations.get(deviceId);
    if (!auth || !auth.authorized || auth.authorizedBy !== userId) {
      this._recordAudit({
        type: "PERMISSION_CHECK",
        action: actionName,
        deviceId,
        userId,
        status: "DENIED",
        reason: "DEVICE_NOT_AUTHORIZED"
      });
      return {
        permitted: false,
        reason: `Device '${deviceId}' is not authorized. Explicit pairing or authorization required.`,
        code: "DEVICE_UNAUTHORIZED"
      };
    }

    // 2. Sensitive Package Inspection (Guard financial and messaging apps)
    const targetPkg = params.package || params.packageName || params.app;
    if (targetPkg && SENSITIVE_PACKAGES.includes(targetPkg)) {
      if (requiredLevel < MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL) {
        // Upgrade to critical if interacting with sensitive application
        requiredLevel = MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL;
      }
    }

    // 3. URL Scheme & SSRF Protection
    if (actionName === "mobile_open_url" && params.url) {
      const urlCheck = this.sanitizeUrl(params.url);
      if (!urlCheck.safe) {
        this._recordAudit({
          type: "SECURITY_BLOCKED",
          action: actionName,
          deviceId,
          userId,
          status: "BLOCKED",
          reason: urlCheck.reason
        });
        return {
          permitted: false,
          reason: `Unsafe URL rejected: ${urlCheck.reason}`,
          code: "UNSAFE_URL_BLOCKED"
        };
      }
    }

    // 4. Sensitive and critical actions require a fresh owner-bound approval,
    // unless a trusted server-side tool invocation has already consumed its own
    // action-bound approval proof at the ToolRegistry boundary.
    if (!approvalVerified && (requiredLevel >= MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE || auth.maxLevel < requiredLevel)) {
      if (!confirmationToken) {
        const reason = (targetPkg && SENSITIVE_PACKAGES.includes(targetPkg))
          ? `Interaction with sensitive application '${targetPkg}' requires explicit user confirmation.`
          : `Action '${actionName}' is classified as Critical (Level 4) and requires human authorization.`;
        return this._requireConfirmation(actionName, params, deviceId, userId, reason);
      }

      // Validate single-use confirmation token
      const tokenVerification = this.verifyConfirmationToken(confirmationToken, actionName, deviceId, userId, params);
      if (!tokenVerification.valid) {
        this._recordAudit({
          type: "CONFIRMATION_FAILED",
          action: actionName,
          deviceId,
          userId,
          status: "DENIED",
          reason: tokenVerification.reason
        });
        return {
          permitted: false,
          reason: tokenVerification.reason,
          code: "INVALID_CONFIRMATION_TOKEN"
        };
      }
    }

    // Permission Granted
    this._recordAudit({
      type: "PERMISSION_CHECK",
      action: actionName,
      deviceId,
      userId,
      status: "GRANTED",
      level: requiredLevel
    });

    return { permitted: true, requiredLevel };
  }

  /**
   * Internal: Generate single-use confirmation token and register pending request.
   */
  _requireConfirmation(actionName, params, deviceId, userId, reason) {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + this.tokenTtlMs;

    this.pendingConfirmations.set(token, {
      token,
      action: actionName,
      params: JSON.parse(JSON.stringify(params)),
      deviceId,
      userId,
      expiresAt,
      createdAt: Date.now()
    });

    this._recordAudit({
      type: "CONFIRMATION_REQUESTED",
      action: actionName,
      deviceId,
      userId,
      token,
      status: "PENDING_CONFIRMATION",
      reason
    });

    return {
      permitted: false,
      requiresConfirmation: true,
      confirmationToken: token,
      expiresAt,
      reason,
      code: "CONFIRMATION_REQUIRED"
    };
  }

  /**
   * Verify and consume a single-use confirmation token.
   */
  verifyConfirmationToken(token, expectedAction, expectedDeviceId, expectedUserId, expectedParams) {
    if (!token || !this.pendingConfirmations.has(token)) {
      return { valid: false, reason: "Confirmation token not found or already consumed (anti-replay)." };
    }

    const pending = this.pendingConfirmations.get(token);
    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(token);
      return { valid: false, reason: "Confirmation token has expired." };
    }
    if (!expectedUserId || pending.userId !== expectedUserId) {
      return { valid: false, reason: "Confirmation token belongs to a different authenticated user." };
    }
    if (pending.action !== expectedAction) {
      return { valid: false, reason: `Token action mismatch: expected '${expectedAction}', found '${pending.action}'` };
    }
    if (pending.deviceId && pending.deviceId !== expectedDeviceId) {
      return { valid: false, reason: `Token device mismatch: expected '${expectedDeviceId}', found '${pending.deviceId}'` };
    }
    if (stableSerialize(pending.params) !== stableSerialize(expectedParams)) {
      return { valid: false, reason: "Confirmation token parameters do not match the originally approved action." };
    }

    // Consume only after all identity, action, device, and parameter bindings have been validated.
    this.pendingConfirmations.delete(token);
    return { valid: true, pending };
  }

  /**
   * Validate and sanitize mobile URLs.
   */
  sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
      return { safe: false, reason: "URL must be a non-empty string" };
    }

    try {
      const parsed = new URL(rawUrl);
      const protocol = parsed.protocol.toLowerCase();

      if (protocol !== "http:" && protocol !== "https:") {
        return { safe: false, reason: `Protocol '${protocol}' is not allowed. Only http: and https: are permitted.` };
      }

      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return { safe: false, reason: "Navigation to localhost is blocked for security." };
      }

      for (const regex of PRIVATE_SUBNETS) {
        if (regex.test(hostname)) {
          return { safe: false, reason: `Navigation to private subnet '${hostname}' is blocked.` };
        }
      }

      return { safe: true, url: parsed.toString() };
    } catch (err) {
      return { safe: false, reason: `Invalid URL format: ${err.message}` };
    }
  }

  /**
   * Internal: Append to audit log buffer.
   */
  _recordAudit(entry) {
    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      ...entry
    };

    this.auditLogs.push(record);
    if (this.auditLogs.length > this.maxAuditLogs) {
      this.auditLogs.shift();
    }
    this.emit("audit", record);
  }

  /**
   * Query recent audit logs with optional device filter.
   */
  getAuditLogs(deviceId = null, limit = 100) {
    let logs = this.auditLogs;
    if (deviceId) {
      logs = logs.filter(l => l.deviceId === deviceId);
    }
    return logs.slice(-limit);
  }
}

export const mobilePermissionEngine = new MobilePermissionEngine();
