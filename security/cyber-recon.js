/**
 * ULTRON AI — Advanced Ethical Hacking & Cybersecurity System
 * Module: PASSIVE CYBER RECONNAISSANCE (security/cyber-recon.js)
 *
 * Implements passive security reconnaissance and external exposure analysis:
 * - Domain and DNS record resolution
 * - Technology stack fingerprinting from caller-supplied HTTP headers
 * - DNS resolution and explicit, unverified asset hints
 * - No active port scan or TLS handshake is performed by this passive module
 */

import crypto from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { ultronGuardian } from "./ultron-guardian.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "./target-authorization-gateway.js";

export class CyberReconEngine {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.reconHistory = [];
  }

  /**
   * Run authorized passive reconnaissance against an asset.
   */
  async performRecon(target, options = {}) {
    const cleanTarget = String(target || "").trim().toLowerCase();
    if (!cleanTarget) throw new Error("Recon target cannot be empty.");

    // Mandatory Scope Check
    const authRecord = this.authGateway.assertAuthorization(cleanTarget, PERMITTED_ACTIVITIES.PASSIVE_RECON);

    // 1. Technology & Header Fingerprinting
    const headers = options.headers || {};
    const fingerprint = this._fingerprintTechnology(headers);

    // 2. DNS & Asset Resolution
    const dnsSummary = await this._analyzeDns(cleanTarget);

    // 3. Attack Surface Mapping (Passively identifies explicitly authorized services)
    const attackSurface = this._mapAttackSurface(cleanTarget, options.openPorts || []);

    // 4. TLS & Certificate Check
    const tlsStatus = this._evaluateTls(cleanTarget, options.tlsCert);

    const report = {
      reconId: "recon-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"),
      target: cleanTarget,
      scopeId: authRecord.scopeId,
      organization: authRecord.organization,
      timestamp: new Date().toISOString(),
      fingerprint,
      dnsSummary,
      attackSurface,
      tlsStatus
    };

    this.reconHistory.push(report);
    if (this.reconHistory.length > 50) this.reconHistory.shift();

    this.guardian.recordAudit("PASSIVE_RECON_COMPLETED", "cyber-recon", {
      target: cleanTarget,
      scopeId: authRecord.scopeId,
      technologiesIdentified: fingerprint.detectedStack
    });

    return report;
  }

  _fingerprintTechnology(headers = {}) {
    const detected = [];
    const serverHeader = headers["server"] || headers["Server"] || "";
    const poweredBy = headers["x-powered-by"] || headers["X-Powered-By"] || "";

    if (serverHeader) detected.push(`Server: ${serverHeader}`);
    if (poweredBy) detected.push(`Framework: ${poweredBy}`);
    if (headers["x-aspnet-version"]) detected.push("Platform: ASP.NET");
    if (headers["set-cookie"]?.includes("connect.sid")) detected.push("Session: Express.js");

    return {
      serverHeader: serverHeader || "Hidden (Best Practice)",
      poweredBy: poweredBy || "Hidden (Best Practice)",
      detectedStack: detected.length > 0 ? detected : ["Hardened / Concealed Headers"]
    };
  }

  async _analyzeDns(target) {
    const hostname = target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    if (!hostname) return { hostname: target, status: "INVALID_HOSTNAME", ip: null };
    try {
      const res = await dnsLookup(hostname);
      return {
        hostname,
        status: "RESOLVED",
        ip: res.address,
        family: res.family === 6 ? "IPv6" : "IPv4",
        recordTypes: ["A", "AAAA"]
      };
    } catch (err) {
      return {
        hostname,
        status: "UNRESOLVED",
        error: err.code || err.message,
        ip: null
      };
    }
  }

  _mapAttackSurface(target, ports = []) {
    // Caller-supplied port numbers are hints, not observations. This passive
    // module does not open sockets or claim that an endpoint is reachable.
    const reportedPorts = Array.isArray(ports)
      ? [...new Set(ports.filter(port => Number.isInteger(port) && port >= 1 && port <= 65535))]
      : [];

    return {
      target,
      status: reportedPorts.length ? "UNVERIFIED_INPUT" : "NOT_SCANNED",
      exposedEndpointsCount: 0,
      reportedEndpointsCount: reportedPorts.length,
      identifiedServices: reportedPorts.map(port => ({
        port,
        state: "UNVERIFIED",
        evidenceSource: "CALLER_SUPPLIED"
      }))
    };
  }

  _evaluateTls(target, tlsCert = null) {
    // No TLS handshake or certificate-chain validation is performed here.
    // Even a caller-supplied object is not proof until a verifier inspects it.
    return {
      target,
      status: tlsCert ? "UNVERIFIED_INPUT" : "NOT_CHECKED",
      tlsVersion: null,
      cipherSuite: null,
      certificateStatus: "NOT_VERIFIED",
      validUntil: null,
      evidenceProvided: Boolean(tlsCert)
    };
  }
}

export const cyberReconEngine = new CyberReconEngine();
