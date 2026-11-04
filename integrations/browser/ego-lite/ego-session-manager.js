/**
 * ULTRON AI — Ego Lite Authenticated Session & Privacy Manager
 * Module: integrations/browser/ego-lite/ego-session-manager.js
 *
 * Implements safe, privacy-preserving integration with user-authorized
 * browser sessions:
 * 1. Zero cookie extraction.
 * 2. Zero password export.
 * 3. Never copies raw session tokens into ULTRON memory or prompt context.
 * 4. Never exposes browser storage to LLMs.
 * 5. Detects session expiration and requests human re-authentication.
 * 6. Enforces that access to a logged-in browser does NOT grant blanket approval
 *    to perform consequential external actions.
 */

import { EGO_BROWSER_STATE, PERMISSION_LEVELS } from "./ego-constants.js";

const LOGIN_PAGE_INDICATORS = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/auth\b/i,
  /\/session\/new\b/i,
  /\/users\/sign_in\b/i
];

const SESSION_EXPIRED_PATTERNS = [
  /session expired/i,
  /please sign in again/i,
  /log in to continue/i,
  /your session has timed out/i,
  /authentication required/i
];

export class EgoSessionManager {
  constructor(options = {}) {
    /** @type {Map<string, Map<string, Object>>} spaceId -> (domain -> { authorized, lastVerified }) */
    this.spaceDomainMap = new Map();
    /** @type {Map<string, Object>} global fallback: domain -> { authorized, lastVerified } */
    this.sessionStatusMap = new Map();
  }

  /**
   * Assesses whether a target domain is an authorized authenticated session.
   * Can be called as isDomainAuthorized(spaceId, domain) or isDomainAuthorized(domain).
   */
  isDomainAuthorized(spaceIdOrDomain, domain) {
    if (!spaceIdOrDomain) return false;

    if (domain) {
      const spaceId = spaceIdOrDomain;
      const cleanDomain = domain.toLowerCase().replace(/^www\./, "");
      const spaceMap = this.spaceDomainMap.get(spaceId);
      return spaceMap?.get(cleanDomain)?.authorized ?? false;
    }

    const cleanDomain = spaceIdOrDomain.toLowerCase().replace(/^www\./, "");
    return this.sessionStatusMap.get(cleanDomain)?.authorized ?? false;
  }

  /**
   * Authorizes use of a logged-in domain context (explicitly granted by user).
   * Can be called as authorizeDomain(spaceId, domain, options) or authorizeDomain(domain, options).
   */
  authorizeDomain(spaceIdOrDomain, domainOrOptions, options = {}) {
    if (typeof domainOrOptions === "string") {
      const spaceId = spaceIdOrDomain;
      const cleanDomain = domainOrOptions.toLowerCase().replace(/^www\./, "");
      if (!this.spaceDomainMap.has(spaceId)) {
        this.spaceDomainMap.set(spaceId, new Map());
      }
      const spaceMap = this.spaceDomainMap.get(spaceId);
      spaceMap.set(cleanDomain, {
        authorized: true,
        lastVerified: new Date().toISOString(),
        options
      });
      return { spaceId, domain: cleanDomain, authorized: true };
    }

    const cleanDomain = spaceIdOrDomain.toLowerCase().replace(/^www\./, "");
    this.sessionStatusMap.set(cleanDomain, {
      authorized: true,
      lastVerified: new Date().toISOString(),
      options: domainOrOptions || {}
    });
    return { domain: cleanDomain, authorized: true };
  }

  /**
   * Alias for authorizeDomain
   */
  authorizeDomainSession(domain, options = {}) {
    return this.authorizeDomain(domain, options);
  }

  /**
   * List authorized domains for a space
   */
  listAuthorizedDomains(spaceId) {
    if (!spaceId) {
      return Array.from(this.sessionStatusMap.keys());
    }
    const spaceMap = this.spaceDomainMap.get(spaceId);
    return spaceMap ? Array.from(spaceMap.keys()) : [];
  }

  /**
   * Inspects page metadata and DOM structure to detect whether an active session
   * has expired or redirected to a login gate.
   */
  detectSessionExpiration(url, pageTitle = "", snapshotText = "") {
    const isLoginUrl = LOGIN_PAGE_INDICATORS.some((pattern) => pattern.test(url));
    const titleExpired = SESSION_EXPIRED_PATTERNS.some((p) => p.test(pageTitle));
    const bodyExpired = SESSION_EXPIRED_PATTERNS.some((p) => p.test(snapshotText.slice(0, 2000)));

    const expired = isLoginUrl || titleExpired || bodyExpired;

    return {
      expired,
      reason: isLoginUrl
        ? "Redirected to login/authentication endpoint."
        : titleExpired || bodyExpired
          ? "Session expiration message detected on page."
          : null,
      state: expired ? EGO_BROWSER_STATE.WAITING_FOR_USER : EGO_BROWSER_STATE.READY,
      requiresReauth: expired
    };
  }

  /**
   * Privacy Guard: Strips sensitive credentials, cookies, tokens, and authorization
   * headers before any observation payload is surfaced to higher-level agents.
   */
  sanitizeObservationPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;

    const sanitized = { ...payload };

    // 1. Redact cookies, tokens, passwords, and authorization headers
    if (sanitized.cookie !== undefined) sanitized.cookie = "[REDACTED - POLICY]";
    if (sanitized.cookies !== undefined) sanitized.cookies = "[REDACTED - POLICY]";
    if (sanitized.authorization !== undefined) sanitized.authorization = "[REDACTED - POLICY]";
    if (sanitized.password !== undefined) sanitized.password = "[REDACTED - POLICY]";
    if (sanitized.token !== undefined) sanitized.token = "[REDACTED - POLICY]";

    delete sanitized.localStorage;
    delete sanitized.sessionStorage;
    if (sanitized.headers) {
      const headers = { ...sanitized.headers };
      if (headers.cookie) headers.cookie = "[REDACTED - POLICY]";
      if (headers.authorization) headers.authorization = "[REDACTED - POLICY]";
      sanitized.headers = headers;
    }

    // 2. Redact password inputs or tokens in snapshot text
    if (typeof sanitized.text === "string") {
      sanitized.text = sanitized.text
        .replace(/(?:password|passwd|pwd)\s*[:=]\s*[^\s\n]+/gi, "password: [REDACTED]")
        .replace(/(?:bearer|token)\s+[a-zA-Z0-9_.-]{20,}/gi, "token [REDACTED]");
    }

    return sanitized;
  }

  /**
   * Alias for sanitizeObservationPayload
   */
  sanitizeObservationData(payload) {
    return this.sanitizeObservationPayload(payload);
  }

  /**
   * Action Privilege Check: Verifies whether an action on an authenticated session
   * requires explicit human confirmation.
   */
  evaluateSessionActionRisk(action, details = {}) {
    const isSensitive = [
      "send_message",
      "post",
      "comment",
      "publish",
      "purchase",
      "buy",
      "checkout",
      "transfer",
      "delete",
      "remove",
      "change_password",
      "update_settings"
    ].includes(action);

    if (isSensitive) {
      return {
        allowed: false,
        permissionLevel: PERMISSION_LEVELS.LEVEL_4_CRITICAL,
        requiresApproval: true,
        reason: `Consequential action '${action}' on authenticated session requires explicit human confirmation.`
      };
    }

    return {
      allowed: true,
      permissionLevel: PERMISSION_LEVELS.LEVEL_2_INTERACT,
      requiresApproval: false
    };
  }
}
