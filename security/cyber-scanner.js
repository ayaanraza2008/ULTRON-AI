/**
 * ULTRON AI — Advanced Ethical Hacking & Cybersecurity System
 * Module: VULNERABILITY SCANNER (security/cyber-scanner.js)
 *
 * Implements non-destructive vulnerability assessment, CWE/CVE mapping,
 * CVSS v3.1 base scoring, and remediation guidance.
 */

import crypto from "node:crypto";
import { ultronGuardian } from "./ultron-guardian.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "./target-authorization-gateway.js";

export class CyberVulnerabilityScanner {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.scanHistory = [];
  }

  /**
   * Run authorized vulnerability scan on target.
   */
  async runVulnerabilityScan(target, options = {}) {
    const cleanTarget = String(target || "").trim().toLowerCase();
    if (!cleanTarget) throw new Error("Vulnerability scan failed: Target cannot be empty.");

    // Mandatory Scope Check
    const authRecord = this.authGateway.assertAuthorization(cleanTarget, PERMITTED_ACTIVITIES.VULNERABILITY_SCAN);

    const findings = [];
    const openPorts = Array.isArray(options.openPorts) ? options.openPorts : [];
    const headers = options.headers && typeof options.headers === "object" ? options.headers : {};
    const config = options.config && typeof options.config === "object" ? options.config : {};
    const reportedPorts = [...new Set(openPorts.filter(port => Number.isInteger(port) && port >= 1 && port <= 65535))];
    const evidenceProvided = reportedPorts.length > 0
      || Object.keys(headers).length > 0
      || Object.keys(config).length > 0
      || typeof options.tlsVersion === "string";

    // 1. Port & Insecure Service Inspection
    if (openPorts.includes(21)) {
      findings.push({
        id: "VULN-FTP-01",
        cwe: "CWE-319",
        title: "Cleartext FTP Service Detected",
        severity: "HIGH",
        cvss: 7.5,
        confidence: 0.95,
        affectedAsset: `${cleanTarget}:21`,
        exploitability: "Network accessible cleartext credentials",
        businessImpact: "Credentials transmitted in plaintext may be intercepted by network adversaries.",
        remediation: "Disable unencrypted FTP and migrate to SFTP (SSH File Transfer Protocol)."
      });
    }

    if (openPorts.includes(23)) {
      findings.push({
        id: "VULN-TELNET-01",
        cwe: "CWE-319",
        title: "Legacy Telnet Service Exposed",
        severity: "CRITICAL",
        cvss: 9.8,
        confidence: 0.98,
        affectedAsset: `${cleanTarget}:23`,
        exploitability: "Unencrypted remote administration channel",
        businessImpact: "Complete administrative credential compromise via passive network sniffing.",
        remediation: "Shut down Telnet daemon; enforce SSHv2 with public key authentication."
      });
    }

    // 2. Debug / Verbose Stack Traces
    if (config.debugMode === true || headers["x-debug-mode"] === "true") {
      findings.push({
        id: "VULN-DEBUG-01",
        cwe: "CWE-209",
        title: "Debug Mode Active in Target Environment",
        severity: "MEDIUM",
        cvss: 5.3,
        confidence: 0.90,
        affectedAsset: cleanTarget,
        exploitability: "Information disclosure via verbose error messages",
        businessImpact: "Detailed system internals and stack traces assist attackers in tailoring exploits.",
        remediation: "Disable NODE_ENV=development and debug flags in production environments."
      });
    }

    // 3. Outdated TLS configuration check
    if (options.tlsVersion === "TLSv1.0" || options.tlsVersion === "TLSv1.1") {
      findings.push({
        id: "VULN-TLS-01",
        cwe: "CWE-326",
        title: "Deprecated TLS Version (TLS 1.0/1.1)",
        severity: "HIGH",
        cvss: 7.4,
        confidence: 0.95,
        affectedAsset: `${cleanTarget}:443`,
        exploitability: "Known cryptographic downgrade vulnerabilities (POODLE, BEAST)",
        businessImpact: "Encrypted communications can be decrypted by position-capable attackers.",
        remediation: "Enforce TLS 1.2 or TLS 1.3 exclusively across all web endpoints."
      });
    }

    // Inputs are supplied by the caller; no socket or TLS probe is performed here.
    const evidenceFindings = findings.map(f => ({
      ...f,
      confidence: 0.5,
      evidenceSource: "CALLER_SUPPLIED_OPTIONS",
      verificationStatus: "NOT_INDEPENDENTLY_VERIFIED"
    }));
    const maxCvss = evidenceFindings.reduce((max, f) => Math.max(max, f.cvss), 0);
    const overallRisk = !evidenceProvided
      ? "NOT_ASSESSED"
      : maxCvss >= 9.0 ? "CRITICAL" : maxCvss >= 7.0 ? "HIGH" : maxCvss >= 4.0 ? "MEDIUM" : evidenceFindings.length > 0 ? "LOW" : "NO_FINDINGS_IN_SUPPLIED_EVIDENCE";

    const report = {
      scanId: "scan-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"),
      target: cleanTarget,
      scopeId: authRecord.scopeId,
      organization: authRecord.organization,
      timestamp: new Date().toISOString(),
      status: evidenceProvided ? "INPUT_ANALYSIS_ONLY" : "NOT_ASSESSED",
      evidenceMode: "CALLER_SUPPLIED_UNVERIFIED",
      verificationStatus: "NOT_INDEPENDENTLY_VERIFIED",
      reportedOpenPorts: reportedPorts,
      findingsCount: evidenceFindings.length,
      overallRisk,
      maxCvss,
      findings: evidenceFindings
    };

    this.scanHistory.push(report);
    if (this.scanHistory.length > 50) this.scanHistory.shift();

    this.guardian.recordAudit("VULNERABILITY_SCAN_COMPLETED", "cyber-scanner", {
      target: cleanTarget,
      findingsCount: findings.length,
      overallRisk
    });

    return report;
  }
}

export const cyberVulnerabilityScanner = new CyberVulnerabilityScanner();
