/**
 * ULTRON AI — Advanced Ethical Hacking & Cybersecurity System
 * Module: WEB & API SECURITY ASSESSMENT (security/cyber-web.js)
 *
 * Implements non-destructive web application and API security analysis:
 * - Security headers & CSP configuration audit
 * - CORS origin reflection & credentials analysis
 * - Cookie security flags (HttpOnly, Secure, SameSite)
 * - CSRF defense verification
 * - JWT token configuration & algorithm audit (alg: none, expiration)
 * - Rate-limit compliance verification
 */

import crypto from "node:crypto";
import { ultronGuardian } from "./ultron-guardian.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "./target-authorization-gateway.js";

export class CyberWebAuditor {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.auditHistory = [];
  }

  /**
   * Complete Web & API Security Assessment
   */
  async auditEndpoint(targetUrl, options = {}) {
    const cleanUrl = String(targetUrl || "").trim();
    if (!cleanUrl) {
      throw new Error("Audit failed: Target URL cannot be empty.");
    }

    // 1. Mandatory Scope Authorization Check
    const authRecord = this.authGateway.assertAuthorization(cleanUrl, PERMITTED_ACTIVITIES.WEB_API_AUDIT);

    const findings = [];
    const headers = options.headers && typeof options.headers === "object" ? options.headers : {};
    const cookies = Array.isArray(options.cookies) ? options.cookies : [];
    const jwtToken = typeof options.jwtToken === "string" ? options.jwtToken : null;
    const corsHeaders = options.corsHeaders && typeof options.corsHeaders === "object" ? options.corsHeaders : {};

    // This analyzer evaluates caller-supplied evidence; it does not fetch targetUrl.
    // Empty input means no captured response is available, not that controls are absent.
    const hasHeaderEvidence = Object.keys(headers).length > 0;
    const hasCookieEvidence = cookies.length > 0;
    const hasCorsEvidence = Object.keys(corsHeaders).length > 0;

    // 2. Security Headers & CSP Audit
    const headerFindings = hasHeaderEvidence ? this._auditHeaders(headers) : [];
    findings.push(...headerFindings);

    // 3. Cookie Flags Audit
    const cookieFindings = hasCookieEvidence ? this._auditCookies(cookies) : [];
    findings.push(...cookieFindings);

    // 4. CORS Configuration Audit
    const corsFindings = hasCorsEvidence ? this._auditCors(corsHeaders) : [];
    findings.push(...corsFindings);

    // 5. JWT Token Audit (if token supplied)
    if (jwtToken) {
      const jwtFindings = this.auditJwtToken(jwtToken);
      findings.push(...jwtFindings);
    }

    // 6. Rate Limiting Presence Verification
    const rateLimitFindings = hasHeaderEvidence ? this._auditRateLimiting(headers) : [];
    findings.push(...rateLimitFindings);

    const evidenceProvided = hasHeaderEvidence || hasCookieEvidence || hasCorsEvidence || Boolean(jwtToken);
    const evidenceFindings = findings.map(f => ({
      ...f,
      evidenceSource: "CALLER_SUPPLIED_INPUT",
      verificationStatus: "NOT_INDEPENDENTLY_VERIFIED"
    }));
    const maxCvss = evidenceFindings.reduce((max, f) => Math.max(max, f.cvssScore || 0), 0);
    const overallRisk = !evidenceProvided
      ? "NOT_ASSESSED"
      : maxCvss >= 9.0 ? "CRITICAL" : maxCvss >= 7.0 ? "HIGH" : maxCvss >= 4.0 ? "MEDIUM" : evidenceFindings.length > 0 ? "LOW" : "NO_FINDINGS_IN_SUPPLIED_EVIDENCE";

    const report = {
      auditId: "web-audit-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"),
      target: cleanUrl,
      scopeId: authRecord.scopeId,
      organization: authRecord.organization,
      timestamp: new Date().toISOString(),
      status: evidenceProvided ? "INPUT_ANALYSIS_ONLY" : "NOT_ASSESSED",
      evidenceMode: "CALLER_SUPPLIED_UNVERIFIED",
      verificationStatus: "NOT_INDEPENDENTLY_VERIFIED",
      findingsCount: evidenceFindings.length,
      overallRisk,
      maxCvss,
      findings: evidenceFindings
    };

    this.auditHistory.push(report);
    if (this.auditHistory.length > 50) this.auditHistory.shift();

    this.guardian.recordAudit("WEB_API_AUDIT_COMPLETED", "cyber-web", {
      target: cleanUrl,
      findingsCount: findings.length,
      overallRisk
    });

    return report;
  }

  /**
   * Internal: Audit HTTP Security Headers
   */
  _auditHeaders(headers = {}) {
    const findings = [];
    const norm = {};
    for (const [k, v] of Object.entries(headers)) norm[k.toLowerCase()] = String(v);

    // CSP
    if (!norm["content-security-policy"]) {
      findings.push({
        check: "Content-Security-Policy",
        severity: "MEDIUM",
        cvssScore: 6.1,
        title: "Missing Content-Security-Policy (CSP)",
        evidence: "Header not present",
        impact: "Browser is vulnerable to Cross-Site Scripting (XSS) and code injection attacks.",
        remediation: "Deploy strict CSP: default-src 'self'; script-src 'self'; object-src 'none';"
      });
    } else if (norm["content-security-policy"].includes("'unsafe-inline'") || norm["content-security-policy"].includes("'unsafe-eval'")) { // nosec: security auditor rule check
      findings.push({
        check: "CSP-Unsafe-Directives",
        severity: "MEDIUM",
        cvssScore: 5.4,
        title: "Weak CSP: Unsafe Inline/Eval Allowed",
        evidence: norm["content-security-policy"],
        impact: "Inline scripts can bypass XSS mitigations.",
        remediation: "Remove 'unsafe-inline' and 'unsafe-eval'; migrate to nonces or SHA-256 hashes."
      });
    }

    // HSTS
    if (!norm["strict-transport-security"]) {
      findings.push({
        check: "Strict-Transport-Security",
        severity: "HIGH",
        cvssScore: 7.5,
        title: "Missing Strict-Transport-Security (HSTS)",
        evidence: "Header not present",
        impact: "Users may be vulnerable to SSL stripping and man-in-the-middle attacks.",
        remediation: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains; preload"
      });
    }

    // X-Frame-Options
    if (!norm["x-frame-options"] && !norm["content-security-policy"]?.includes("frame-ancestors")) {
      findings.push({
        check: "X-Frame-Options",
        severity: "LOW",
        cvssScore: 3.8,
        title: "Missing Clickjacking Defense",
        evidence: "Neither X-Frame-Options nor CSP frame-ancestors detected",
        impact: "Site may be loaded inside hidden hostile iframes.",
        remediation: "Set X-Frame-Options: DENY or frame-ancestors 'none';"
      });
    }

    // X-Content-Type-Options
    if (norm["x-content-type-options"] !== "nosniff") {
      findings.push({
        check: "X-Content-Type-Options",
        severity: "LOW",
        cvssScore: 3.5,
        title: "Missing MIME Sniffing Defense",
        evidence: norm["x-content-type-options"] || "Header not present",
        impact: "Browser may treat text or image files as executable scripts.",
        remediation: "Set X-Content-Type-Options: nosniff"
      });
    }

    return findings;
  }

  /**
   * Internal: Audit Cookie Security Flags
   */
  _auditCookies(cookies = []) {
    const findings = [];
    const list = Array.isArray(cookies) ? cookies : [cookies];

    list.forEach(c => {
      const cookieStr = typeof c === "string" ? c : c.raw || "";
      const lower = cookieStr.toLowerCase();

      if (!lower.includes("httponly")) {
        findings.push({
          check: "Cookie-HttpOnly",
          severity: "MEDIUM",
          cvssScore: 5.3,
          title: "Cookie Missing HttpOnly Flag",
          evidence: cookieStr.slice(0, 40),
          impact: "Cookie can be accessed via client-side JavaScript, increasing risk of XSS token theft.",
          remediation: "Set the HttpOnly flag on sensitive session cookies."
        });
      }

      if (!lower.includes("secure")) {
        findings.push({
          check: "Cookie-Secure",
          severity: "HIGH",
          cvssScore: 7.4,
          title: "Cookie Missing Secure Flag",
          evidence: cookieStr.slice(0, 40),
          impact: "Cookie will be transmitted in unencrypted plaintext over HTTP.",
          remediation: "Ensure the Secure flag is set on all cookies."
        });
      }

      if (!lower.includes("samesite")) {
        findings.push({
          check: "Cookie-SameSite",
          severity: "LOW",
          cvssScore: 3.7,
          title: "Cookie Missing SameSite Attribute",
          evidence: cookieStr.slice(0, 40),
          impact: "Cookie may be attached to cross-origin requests, increasing CSRF risk.",
          remediation: "Configure SameSite=Strict or SameSite=Lax."
        });
      }
    });

    return findings;
  }

  /**
   * Internal: Audit CORS Configuration
   */
  _auditCors(corsHeaders = {}) {
    const findings = [];
    const allowOrigin = corsHeaders["access-control-allow-origin"] || "";
    const allowCredentials = corsHeaders["access-control-allow-credentials"] === "true" || corsHeaders["access-control-allow-credentials"] === true;

    if (allowOrigin === "*" && allowCredentials) {
      findings.push({
        check: "CORS-Wildcard-Credentials",
        severity: "CRITICAL",
        cvssScore: 9.1,
        title: "Insecure CORS: Wildcard Origin with Credentials",
        evidence: "Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true",
        impact: "Allows arbitrary external sites to read sensitive authenticated responses.",
        remediation: "Specify explicit authorized origins instead of wildcard when credentials are enabled."
      });
    } else if (allowOrigin === "null") {
      findings.push({
        check: "CORS-Null-Origin",
        severity: "HIGH",
        cvssScore: 7.5,
        title: "Insecure CORS: 'null' Origin Allowed",
        evidence: "Access-Control-Allow-Origin: null",
        impact: "Sandboxed iframes or local HTML files can execute cross-origin requests with credentials.",
        remediation: "Do not trust 'null' as a valid CORS origin."
      });
    }

    return findings;
  }

  /**
   * Audit JWT Token Configuration & Weakness
   */
  auditJwtToken(tokenString) {
    const findings = [];
    if (!tokenString || typeof tokenString !== "string" || !tokenString.includes(".")) {
      return findings;
    }

    try {
      const parts = tokenString.split(".");
      if (parts.length < 2) return findings;

      const header = JSON.parse(Buffer.from(parts[0], "base64").toString("utf8"));
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));

      // 1. Check Algorithm 'none'
      if (!header.alg || header.alg.toLowerCase() === "none") {
        findings.push({
          check: "JWT-None-Algorithm",
          severity: "CRITICAL",
          cvssScore: 9.8,
          title: "JWT Insecure 'none' Algorithm",
          evidence: `Header alg: ${header.alg}`,
          impact: "Allows attackers to forge tokens without signature validation.",
          remediation: "Enforce asymmetric algorithms (RS256, ES256) or strong HMAC (HS256) and reject 'none'."
        });
      }

      // 2. Check Expiration Claim
      if (!payload.exp) {
        findings.push({
          check: "JWT-Missing-Expiration",
          severity: "MEDIUM",
          cvssScore: 5.3,
          title: "JWT Missing Expiration (exp) Claim",
          evidence: "No exp claim found in payload",
          impact: "Token remains valid indefinitely, vulnerable to replay attacks if intercepted.",
          remediation: "Set an exp claim with appropriate lifespan (e.g., 15-60 minutes)."
        });
      } else if (payload.exp * 1000 < Date.now()) {
        findings.push({
          check: "JWT-Expired-Token",
          severity: "LOW",
          cvssScore: 3.1,
          title: "JWT Token Already Expired",
          evidence: `Expired at: ${new Date(payload.exp * 1000).toISOString()}`,
          impact: "Expired token present.",
          remediation: "Refresh token lifecycle."
        });
      }
    } catch (_) {}

    return findings;
  }

  /**
   * Internal: Verify Rate-Limiting Headers
   */
  _auditRateLimiting(headers = {}) {
    const findings = [];
    const hasRateLimit = Boolean(
      headers["ratelimit-remaining"] ||
      headers["x-ratelimit-remaining"] ||
      headers["retry-after"]
    );

    if (!hasRateLimit) {
      findings.push({
        check: "API-Rate-Limiting",
        severity: "LOW",
        cvssScore: 3.7,
        title: "No Rate-Limiting Headers Observed",
        evidence: "Missing RateLimit-Remaining or X-RateLimit headers",
        impact: "Endpoints may be susceptible to automated brute-force or denial of service.",
        remediation: "Implement express-rate-limit or reverse-proxy rate limiting."
      });
    }

    return findings;
  }
}

export const cyberWebAuditor = new CyberWebAuditor();
