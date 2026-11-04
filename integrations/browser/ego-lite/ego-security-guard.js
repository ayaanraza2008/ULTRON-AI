/**
 * ULTRON AI — Ego Lite Security Guard
 * Module: integrations/browser/ego-lite/ego-security-guard.js
 *
 * Enforces URL safety (SSRF protection, private network blocking),
 * untrusted web content / prompt injection defense, and autonomy boundaries
 * (Level 1-2 autonomous vs Level 3-4 user confirmation / handoff).
 */

import { PERMISSION_LEVELS } from "./ego-constants.js";

export class EgoSecurityGuard {
  /**
   * @param {Object} options
   * @param {boolean} [options.allowLocal=false] - Allow localhost/internal network in dev
   * @param {Array<string>} [options.blockedDomains]
   * @param {Array<string>} [options.allowedDomains]
   * @param {number} [options.autonomyLevel=2] - Maximum autonomous execution level
   */
  constructor(options = {}) {
    this.allowLocal = Boolean(options.allowLocal);
    this.blockedDomains = new Set(
      (options.blockedDomains || []).map((d) => d.toLowerCase())
    );
    this.allowedDomains = options.allowedDomains
      ? new Set(options.allowedDomains.map((d) => d.toLowerCase()))
      : null;
    this.autonomyLevel = options.autonomyLevel ?? PERMISSION_LEVELS.LEVEL_2_INTERACT;

    this.emergencyStopEngaged = false;
    this.emergencyStopReason = null;
    this.abortController = new AbortController();
  }

  /**
   * Validate URL against SSRF and protocol policies
   * @param {string} urlString
   * @returns {{ allowed: boolean, reason?: string }}
   */
  validateUrl(urlString) {
    if (this.emergencyStopEngaged) {
      return { allowed: false, reason: `Emergency Stop is engaged: ${this.emergencyStopReason}` };
    }

    if (!urlString || typeof urlString !== "string") {
      return { allowed: false, reason: "URL must be a non-empty string" };
    }

    if (urlString === "about:blank") {
      return { allowed: true };
    }

    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return { allowed: false, reason: "Malformed URL format" };
    }

    // Protocol check
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { allowed: false, reason: `Disallowed protocol: '${parsed.protocol}'. Only http: and https: are permitted.` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check explicit blocklist
    if (this.blockedDomains.has(hostname)) {
      return { allowed: false, reason: `Domain '${hostname}' is in blocked domains list` };
    }

    // Check explicit allowlist if configured
    if (this.allowedDomains && !this.allowedDomains.has(hostname)) {
      let allowed = false;
      for (const domain of this.allowedDomains) {
        if (domain.startsWith("*.") && (hostname === domain.slice(2) || hostname.endsWith(`.${domain.slice(2)}`))) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return { allowed: false, reason: `Domain '${hostname}' is not in allowed domains list` };
      }
    }

    // SSRF / Localhost / Private IP checks
    if (!this.allowLocal) {
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "0.0.0.0" ||
        hostname === "::1" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local")
      ) {
        return { allowed: false, reason: "Access to loopback/localhost is blocked for security" };
      }

      // Cloud metadata IP
      if (hostname === "169.254.169.254") {
        return { allowed: false, reason: "Access to cloud metadata service is strictly blocked" };
      }

      // Private RFC 1918 subnets
      if (this._isPrivateIp(hostname)) {
        return { allowed: false, reason: "Access to private internal network IP is blocked" };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if an IPv4 is within private RFC 1918 ranges
   * @private
   */
  _isPrivateIp(hostname) {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (!match) return false;

    const octets = match.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return false;

    // 10.0.0.0/8
    if (octets[0] === 10) return true;
    // 172.16.0.0/12 (172.16 - 172.31)
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    // 192.168.0.0/16
    if (octets[0] === 192 && octets[1] === 168) return true;

    return false;
  }

  /**
   * Screen untrusted web content for prompt injection patterns
   * @param {string} text
   * @param {string} sourceUrl
   * @returns {{ hasSuspiciousContent: boolean, flags: Array<string>, sanitizedText: string }}
   */
  screenWebText(text, sourceUrl) {
    if (!text || typeof text !== "string") {
      return { hasSuspiciousContent: false, flags: [], sanitizedText: text || "" };
    }

    const injectionPatterns = [
      { pattern: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i, name: "IGNORE_PREVIOUS_INSTRUCTIONS" },
      { pattern: /disregard\s+(all\s+)?(previous|prior)\s+directions/i, name: "DISREGARD_DIRECTIONS" },
      { pattern: /you\s+are\s+now\s+in\s+dan\s+mode/i, name: "DAN_JAILBREAK" },
      { pattern: /system\s*prompt\s*override/i, name: "SYSTEM_PROMPT_OVERRIDE" },
      { pattern: /new\s+system\s+instruction:/i, name: "NEW_SYSTEM_INSTRUCTION" },
      { pattern: /<script[\s>]/i, name: "RAW_SCRIPT_TAG" }
    ];

    const flags = [];
    let sanitized = text;

    for (const item of injectionPatterns) {
      if (item.pattern.test(text)) {
        flags.push(item.name);
        sanitized = sanitized.replace(item.pattern, `[REDACTED_INJECTION_PATTERN_${item.name}]`);
      }
    }

    // Wrap in explicit untrusted content boundaries
    const boundText = `--- BEGIN UNTRUSTED WEB CONTENT (${sourceUrl}) ---\n${sanitized}\n--- END UNTRUSTED WEB CONTENT ---`;

    return {
      hasSuspiciousContent: flags.length > 0,
      flags,
      sanitizedText: boundText
    };
  }

  /**
   * Check if action is permitted under current autonomy level
   * @param {string} actionName
   * @param {Object} target
   * @param {number} requiredLevel
   * @returns {{ allowed: boolean, requiresConfirmation: boolean, reason?: string }}
   */
  checkActionPermission(actionName, target, requiredLevel = PERMISSION_LEVELS.LEVEL_2_INTERACT) {
    if (this.emergencyStopEngaged) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Emergency Stop is engaged: ${this.emergencyStopReason}`
      };
    }

    if (requiredLevel > this.autonomyLevel) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Action '${actionName}' requires Level ${requiredLevel} permission (current autonomy: Level ${this.autonomyLevel}). User confirmation required.`
      };
    }

    return { allowed: true, requiresConfirmation: false };
  }

  /**
   * Trigger emergency stop
   * @param {string} reason
   */
  triggerEmergencyStop(reason = "Emergency stop initiated by user or supervisor") {
    this.emergencyStopEngaged = true;
    this.emergencyStopReason = reason;
    this.abortController.abort(new Error(reason));
    return {
      emergencyStopEngaged: true,
      reason
    };
  }

  /**
   * Reset emergency stop
   */
  resetEmergencyStop() {
    this.emergencyStopEngaged = false;
    this.emergencyStopReason = null;
    this.abortController = new AbortController();
    return { emergencyStopEngaged: false };
  }

  getAbortSignal() {
    return this.abortController.signal;
  }
}
