/**
 * ULTRON AI — Ego Lite Security Guard
 * Module: integrations/browser/ego-lite/ego-security-guard.js
 *
 * Enforces URL safety (SSRF protection, private network blocking),
 * untrusted web content / prompt injection defense, and autonomy boundaries
 * (Level 1-2 autonomous vs Level 3-4 user confirmation / handoff).
 */

import { PERMISSION_LEVELS } from "./ego-constants.js";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipv4IsNonPublic(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 88 && c === 99) || (b === 0 && c === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

function ipv6Groups(address) {
  let value = String(address).toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1);
    if (!isIP(ipv4) || isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = value.slice(0, lastColon + 1) + high + ":" + low;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map(part => Number.parseInt(part || "0", 16));
  return groups.length === 8 && groups.every(part => Number.isInteger(part) && part >= 0 && part <= 0xffff) ? groups : null;
}

function ipv6IsNonPublic(address) {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const allZero = groups.every(part => part === 0);
  const loopback = groups.slice(0, 7).every(part => part === 0) && groups[7] === 1;
  if (allZero || loopback) return true;

  // IPv4-mapped and IPv4-compatible IPv6 addresses inherit the IPv4 policy.
  const mapped = groups.slice(0, 5).every(part => part === 0) && groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every(part => part === 0);
  if (mapped || compatible) {
    const offset = mapped ? 6 : 6;
    const a = groups[offset] >> 8, b = groups[offset] & 0xff;
    const d = groups[offset + 1] >> 8, e = groups[offset + 1] & 0xff;
    return ipv4IsNonPublic([a, b, d, e].join("."));
  }

  const first = groups[0];
  return (first & 0xfe00) === 0xfc00 || // Unique-local fc00::/7
    (first & 0xffc0) === 0xfe80 ||     // Link-local fe80::/10
    (first & 0xff00) === 0xff00 ||     // Multicast ff00::/8
    (first === 0x2001 && groups[1] === 0x0db8) || // Documentation 2001:db8::/32
    first === 0x2002 || // 6to4 can embed unroutable IPv4 endpoints
    (first === 0x0064 && groups[1] === 0xff9b) || // Well-known NAT64 prefix
    (first === 0x0100 && groups.slice(1, 4).every(part => part === 0)); // Discard-only 100::/64
}

function isNonPublicAddress(address) {
  const family = isIP(String(address || "").split("%")[0]);
  if (family === 4) return ipv4IsNonPublic(address);
  if (family === 6) return ipv6IsNonPublic(address);
  return true;
}

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
    this.dnsLookup = typeof options.dnsLookup === "function" ? options.dnsLookup : dnsLookup;
    this.approvalVerifier = typeof options.approvalVerifier === "function" ? options.approvalVerifier : null;
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
   * Resolve and validate every DNS answer before an outbound browser navigation.
   * The driver must additionally enforce this callback for each redirect/request.
   */
  async validateUrlAsync(urlString) {
    const basic = this.validateUrl(urlString);
    if (!basic.allowed || urlString === "about:blank") return basic;

    let parsed;
    try { parsed = new URL(urlString); }
    catch { return { allowed: false, reason: "Malformed URL format" }; }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const family = isIP(hostname);
    if (family) {
      if (!this.allowLocal && isNonPublicAddress(hostname)) {
        return { allowed: false, reason: "Access to non-public IP destinations is blocked" };
      }
      return { allowed: true, addresses: [hostname] };
    }

    let records;
    try {
      records = await this.dnsLookup(hostname, { all: true, verbatim: true });
    } catch {
      return { allowed: false, reason: "Destination hostname could not be resolved safely" };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return { allowed: false, reason: "Destination hostname returned no address records" };
    }
    const addresses = records.map(record => record?.address).filter(value => typeof value === "string");
    if (addresses.length !== records.length || (!this.allowLocal && addresses.some(isNonPublicAddress))) {
      return { allowed: false, reason: "DNS resolution includes a private, loopback, link-local, metadata, or reserved destination" };
    }
    return { allowed: true, addresses };
  }

  /**
   * Verify an authenticated, action-bound, one-time owner approval. The injected
   * verifier must consume the token atomically and return true only once.
   */
  async verifySensitiveActionApproval({ actionName, target, actorId, approvalToken } = {}) {
    if (this.emergencyStopEngaged || !this.approvalVerifier ||
        typeof actorId !== "string" || !actorId.trim() ||
        typeof approvalToken !== "string" || !approvalToken) return false;
    try {
      const result = await this.approvalVerifier({
        actionName,
        target,
        actorId: actorId.trim(),
        approvalToken
      });
      return result === true || result?.approved === true;
    } catch {
      return false;
    }
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

    if (parsed.username || parsed.password) {
      return { allowed: false, reason: "URLs containing embedded credentials are blocked" };
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

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
      if (isIP(hostname) && isNonPublicAddress(hostname)) {
        return { allowed: false, reason: "Access to private, loopback, link-local, metadata, or reserved IP space is blocked" };
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
