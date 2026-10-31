/**
 * ULTRON AI — Advanced Ethical Hacking & Cybersecurity System
 * Module: ULTRON CYBER CORE (security/cyber-core.js)
 *
 * Central Cybersecurity Intelligence Orchestrator.
 * Coordinates 13 specialized cybersecurity agents:
 * - CYBER-RECON: Passive & authorized reconnaissance
 * - CYBER-SCANNER: Vulnerability assessment
 * - CYBER-PENTEST: Controlled penetration testing
 * - CYBER-WEB: Web & API security
 * - CYBER-NETWORK: Defensive network analysis
 * - CYBER-CODE: SAST, dependency & secret scanning
 * - CYBER-CLOUD: Cloud & deployment configuration review
 * - CYBER-IDENTITY: Authentication & access auditing
 * - CYBER-AI: AI red-team & prompt-injection evaluation
 * - CYBER-THREAT: Threat intelligence feeds & advisory correlation
 * - CYBER-INCIDENT: Incident response & timeline reconstruction
 * - CYBER-REMEDIATION: Automated safe remediation patch generation
 * - CYBER-AUDITOR: Independent result verification & cryptographic audit logs
 */

import crypto from "node:crypto";
import { ultronGuardian, PERMISSION_SCOPES } from "./ultron-guardian.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES, TARGET_TYPES } from "./target-authorization-gateway.js";
import { codeShield } from "./code-shield.js";
import { cyberWebAuditor } from "./cyber-web.js";
import { cyberReconEngine } from "./cyber-recon.js";
import { cyberVulnerabilityScanner } from "./cyber-scanner.js";
import { aiRedTeamEvaluator } from "./cyber-ai-redteam.js";
import { cyberIncidentAssistant } from "./cyber-incident.js";
import { cyberReporter } from "./cyber-reporter.js";
import { ultronCore } from "../core/ultron-core.js";

export const CYBER_AGENTS = {
  CYBER_RECON: { id: "cyber-recon", name: "CYBER-RECON", role: "Authorized Reconnaissance" },
  CYBER_SCANNER: { id: "cyber-scanner", name: "CYBER-SCANNER", role: "Vulnerability Assessment" },
  CYBER_PENTEST: { id: "cyber-pentest", name: "CYBER-PENTEST", role: "Controlled Penetration Testing" },
  CYBER_WEB: { id: "cyber-web", name: "CYBER-WEB", role: "Web & API Security" },
  CYBER_NETWORK: { id: "cyber-network", name: "CYBER-NETWORK", role: "Network Defense" },
  CYBER_CODE: { id: "cyber-code", name: "CYBER-CODE", role: "Code Security & SAST" },
  CYBER_CLOUD: { id: "cyber-cloud", name: "CYBER-CLOUD", role: "Cloud & Infra Security" },
  CYBER_IDENTITY: { id: "cyber-identity", name: "CYBER-IDENTITY", role: "Authentication & Access Review" },
  CYBER_AI: { id: "cyber-ai", name: "CYBER-AI", role: "AI Red-Team Security" },
  CYBER_THREAT: { id: "cyber-threat", name: "CYBER-THREAT", role: "Threat Intelligence" },
  CYBER_INCIDENT: { id: "cyber-incident", name: "CYBER-INCIDENT", role: "Incident Investigation" },
  CYBER_REMEDIATION: { id: "cyber-remediation", name: "CYBER-REMEDIATION", role: "Security Remediation" },
  CYBER_AUDITOR: { id: "cyber-auditor", name: "CYBER-AUDITOR", role: "Independent Verification" }
};

export class UltronCyberCore {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.codeShield = options.codeShield || codeShield;
    this.webAuditor = options.webAuditor || cyberWebAuditor;
    this.reconEngine = options.reconEngine || cyberReconEngine;
    this.scanner = options.scanner || cyberVulnerabilityScanner;
    this.aiRedTeam = options.aiRedTeam || aiRedTeamEvaluator;
    this.incidentAssistant = options.incidentAssistant || cyberIncidentAssistant;
    this.reporter = options.reporter || cyberReporter;
    this.ultronCore = options.ultronCore || ultronCore;

    this.missionHistory = [];
  }

  /**
   * Status of all 13 specialized cybersecurity agents
   */
  getAgentsStatus() {
    return Object.values(CYBER_AGENTS).map(agent => ({
      ...agent,
      status: this.authGateway.emergencyStopEngaged ? "HALTED" : "ONLINE_ARMED",
      lastActive: new Date().toISOString()
    }));
  }

  /**
   * Execute an End-to-End Comprehensive Security Mission
   * Workflow: RECON -> SCAN -> WEB/CODE -> AI EVAL -> REPORT -> REMEDIATE
   */
  async executeComprehensiveMission(target, options = {}) {
    const cleanTarget = String(target || "").trim().toLowerCase();
    if (!cleanTarget) throw new Error("Mission failed: Target must be specified.");

    // Mandatory authorization check
    const authRecord = this.authGateway.assertAuthorization(cleanTarget, PERMITTED_ACTIVITIES.VULNERABILITY_SCAN);

    const missionId = "mission-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
    const t0 = performance.now();

    const allFindings = [];

    // Step 1: CYBER-RECON
    const reconReport = await this.reconEngine.performRecon(cleanTarget, options);

    // Step 2: CYBER-SCANNER
    const scanReport = await this.scanner.runVulnerabilityScan(cleanTarget, options);
    allFindings.push(...scanReport.findings);

    // Step 3: CYBER-WEB (if web/API headers or cookies provided)
    let webReport = null;
    if (options.webHeaders || options.url || cleanTarget.startsWith("http") || cleanTarget.includes("localhost")) {
      webReport = await this.webAuditor.auditEndpoint(cleanTarget, {
        headers: options.webHeaders || {},
        cookies: options.cookies || [],
        jwtToken: options.jwtToken || null,
        corsHeaders: options.corsHeaders || {}
      });
      allFindings.push(...webReport.findings);
    }

    // Step 4: CYBER-CODE (if source code provided)
    let codeReport = null;
    if (options.sourceCode) {
      codeReport = this.codeShield.scanSourceCode(options.sourceCode, { target: cleanTarget });
      allFindings.push(...codeReport.findings);
    }

    // Step 5: CYBER-AI Red-Team Evaluation (if target is AI Core or local)
    let aiRedTeamReport = null;
    if (options.includeAiRedTeam || cleanTarget === "localhost") {
      aiRedTeamReport = await this.aiRedTeam.runRedTeamSuite({ target: cleanTarget });
    }

    // Calculate aggregated metrics
    const maxCvss = allFindings.reduce((max, f) => Math.max(max, f.cvss || f.cvssScore || 0), 0);
    const overallRisk = maxCvss >= 9.0 ? "CRITICAL" : maxCvss >= 7.0 ? "HIGH" : maxCvss >= 4.0 ? "MEDIUM" : allFindings.length > 0 ? "LOW" : "SECURE";

    // Step 6: CYBER-REMEDIATION (Propose patches for top findings)
    const proposedRemediations = allFindings.slice(0, 5).map(f => this.codeShield.proposeRemediation(f));

    // Step 7: CYBER-REPORTER (Generate professional Markdown & HTML reports)
    const reportData = {
      title: `ULTRON CYBER CORE — SECURITY MISSION REPORT (${cleanTarget.toUpperCase()})`,
      target: cleanTarget,
      organization: authRecord.organization,
      scopeId: authRecord.scopeId,
      findings: allFindings,
      overallRisk,
      maxCvss
    };

    const markdownReport = this.reporter.generateMarkdownReport(reportData);
    const htmlReport = this.reporter.generateHtmlReport(reportData);

    const executionTimeMs = Math.round(performance.now() - t0);

    const missionResult = {
      missionId,
      target: cleanTarget,
      scopeId: authRecord.scopeId,
      organization: authRecord.organization,
      status: "COMPLETED",
      executionTimeMs,
      timestamp: new Date().toISOString(),
      overallRisk,
      maxCvss,
      totalFindings: allFindings.length,
      recon: reconReport,
      scanner: scanReport,
      web: webReport,
      code: codeReport,
      aiRedTeam: aiRedTeamReport,
      remediations: proposedRemediations,
      reports: {
        markdown: markdownReport,
        html: htmlReport
      }
    };

    this.missionHistory.push(missionResult);
    if (this.missionHistory.length > 20) this.missionHistory.shift();

    this.guardian.recordAudit("COMPREHENSIVE_SECURITY_MISSION_COMPLETED", "cyber-core", {
      missionId,
      target: cleanTarget,
      overallRisk,
      totalFindings: allFindings.length
    });

    return missionResult;
  }
}

export const ultronCyberCore = new UltronCyberCore();
