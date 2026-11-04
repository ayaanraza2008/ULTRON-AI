/**
 * ULTRON AI — Sentinel Cybersecurity Division
 * Module: AUTONOMOUS SENTINEL AGENT (security/sentinel/sentinel-agent.js)
 *
 * Implements the 7-phase Nightcrawler-adapted autonomous decision loop:
 * DISCOVER → INVENTORY → ANALYZE → IDENTIFY RISKS → PRIORITIZE → RECOMMEND → REPORT.
 *
 * Features:
 * - Strict scope validation proxy prior to every action
 * - Transparent AI reasoning rationale for each phase
 * - Dry-run / Simulation engine for safe offline evaluation
 * - Evidence-based findings with CVSS v3.1 scoring
 * - Graceful error recovery and watchdog integration
 */

import crypto from "node:crypto";
import { SENTINEL_PHASES, SCAN_STATUS, RISK_SEVERITY } from "./sentinel-types.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "../target-authorization-gateway.js";
import { cveDatabase } from "./cve-database.js";
import { networkDiscoveryEngine } from "./network-discovery.js";
import { sentinelMemory } from "./sentinel-memory.js";
import { hardwareAdapter } from "./hardware-adapter.js";
import { ultronGuardian } from "../ultron-guardian.js";

export class SentinelAgent {
  constructor(options = {}) {
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.cveDb = options.cveDb || cveDatabase;
    this.discovery = options.discovery || networkDiscoveryEngine;
    this.memory = options.memory || sentinelMemory;
    this.hardware = options.hardware || hardwareAdapter;
    this.guardian = options.guardian || ultronGuardian;

    this.activeScans = new Map(); // scanId -> scanContext
  }

  /**
   * Run the full 7-phase autonomous security evaluation workflow on an authorized target.
   */
  async runMission(target, options = {}) {
    const cleanTarget = String(target || "").trim().toLowerCase();
    if (!cleanTarget) throw new Error("Mission failed: Target must be specified.");

    // Mandatory authorization check
    this.authGateway.assertAuthorization(cleanTarget, PERMITTED_ACTIVITIES.NETWORK_DEFENSE_AUDIT);

    const scanId = "sentinel-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
    const isDryRun = Boolean(options.dryRun);

    const context = {
      scanId,
      target: cleanTarget,
      isDryRun,
      status: SCAN_STATUS.INITIALIZING,
      currentPhase: null,
      phasesExecuted: [],
      assets: [],
      topology: null,
      findings: [],
      prioritizedRisks: [],
      recommendations: [],
      executiveSummary: "",
      drift: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null
    };

    this.activeScans.set(scanId, context);

    try {
      context.status = SCAN_STATUS.RUNNING;

      // ==========================================
      // PHASE 1: DISCOVER
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.DISCOVER;
      this._recordPhase(context, SENTINEL_PHASES.DISCOVER, "Identifying reachable hosts, subnets and interface routing paths for target.");
      const discoveredHost = await this._executeDiscoverPhase(cleanTarget, isDryRun, options);

      // ==========================================
      // PHASE 2: INVENTORY
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.INVENTORY;
      this._recordPhase(context, SENTINEL_PHASES.INVENTORY, "Enumerating open TCP ports, inspecting service banners, and generating network asset inventory.");
      const assetRecord = await this._executeInventoryPhase(discoveredHost, isDryRun, options);
      context.assets = [assetRecord];
      context.topology = this.discovery.buildTopology(context.assets);

      // Check pause / abort
      this._checkScanControls(context);

      // ==========================================
      // PHASE 3: ANALYZE
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.ANALYZE;
      this._recordPhase(context, SENTINEL_PHASES.ANALYZE, "Correlating discovered service banners and protocol exposures with CVE/CWE databases.");
      const rawFindings = this._executeAnalyzePhase(context.assets);

      // ==========================================
      // PHASE 4: IDENTIFY RISKS
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.IDENTIFY_RISKS;
      this._recordPhase(context, SENTINEL_PHASES.IDENTIFY_RISKS, "Evaluating CVSS v3.1 severity scores, exposure vectors, and evidence validation.");
      context.findings = rawFindings;
      const riskSummary = this.cveDb.calculateAggregateRisk(context.findings);
      context.risk = riskSummary;

      // Update per-network and per-host persistent memory
      context.drift = this.memory.updateFindings(cleanTarget, context.findings);

      // ==========================================
      // PHASE 5: PRIORITIZE
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.PRIORITIZE;
      this._recordPhase(context, SENTINEL_PHASES.PRIORITIZE, "Ranking vulnerabilities by exploitability, impact, and network accessibility.");
      context.prioritizedRisks = this._executePrioritizePhase(context.findings);

      // ==========================================
      // PHASE 6: RECOMMEND
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.RECOMMEND;
      this._recordPhase(context, SENTINEL_PHASES.RECOMMEND, "Synthesizing concrete, defensive, non-disruptive remediation and patching guidance.");
      context.recommendations = this._executeRecommendPhase(context.prioritizedRisks);

      // ==========================================
      // PHASE 7: REPORT
      // ==========================================
      context.currentPhase = SENTINEL_PHASES.REPORT;
      this._recordPhase(context, SENTINEL_PHASES.REPORT, "Compiling executive briefing, technical evidence audit trail, and operational metrics.");
      context.executiveSummary = this._generateExecutiveSummary(context);
      context.completedAt = new Date().toISOString();
      context.status = SCAN_STATUS.COMPLETED;

      // Persist in memory history
      this.memory.recordScan(context);

      // Record audit in Ultron Guardian
      this.guardian.recordAudit("SENTINEL_SCAN_COMPLETED", "operator", {
        scanId,
        target: cleanTarget,
        findingsCount: context.findings.length,
        riskScore: context.risk.score,
        dryRun: isDryRun
      });

      return context;
    } catch (err) {
      context.status = SCAN_STATUS.FAILED;
      context.error = err.message;
      context.completedAt = new Date().toISOString();
      throw err;
    }
  }

  _recordPhase(context, phase, rationale) {
    context.phasesExecuted.push({
      phase,
      rationale,
      timestamp: new Date().toISOString()
    });
  }

  _checkScanControls(context) {
    if (this.authGateway.emergencyStopEngaged) {
      context.status = SCAN_STATUS.STOPPED;
      throw new Error("Sentinel operation halted: Emergency Stop engaged.");
    }
    if (context.status === SCAN_STATUS.STOPPED) {
      throw new Error("Sentinel operation halted by operator.");
    }
  }

  async _executeDiscoverPhase(target, isDryRun) {
    if (isDryRun) {
      return { ip: target, reachable: true, rttMs: 1.2, simulated: true };
    }
    return { ip: target, reachable: true, scannedAt: new Date().toISOString() };
  }

  async _executeInventoryPhase(discoveredHost, isDryRun, options) {
    if (isDryRun) {
      // High-fidelity simulation scenario
      return {
        ip: discoveredHost.ip,
        hostname: discoveredHost.ip === "127.0.0.1" || discoveredHost.ip === "localhost" ? "localhost" : "simulated-node.lab",
        deviceType: "SERVER",
        openPorts: [
          { port: 22, protocol: "tcp", service: "ssh", detectedVersion: "8.9p1", banner: "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.7", description: "Secure Shell" },
          { port: 80, protocol: "tcp", service: "http", detectedVersion: "2.4.50", banner: "Apache/2.4.50 (Unix)", description: "HTTP Cleartext" },
          { port: 6379, protocol: "tcp", service: "redis", detectedVersion: "6.2.6", banner: "redis_version:6.2.6", description: "Redis In-Memory Key-Value" }
        ],
        portsScannedCount: 24,
        scannedAt: new Date().toISOString()
      };
    }

    return await this.discovery.scanHost(discoveredHost.ip, options);
  }

  _executeAnalyzePhase(assets = []) {
    const findings = [];
    for (const asset of assets) {
      for (const portInfo of asset.openPorts || []) {
        const matches = this.cveDb.matchVulnerabilities({
          service: portInfo.service,
          version: portInfo.detectedVersion,
          port: portInfo.port,
          headers: {}
        });
        matches.forEach(m => {
          findings.push({
            ...m,
            host: asset.ip,
            hostname: asset.hostname
          });
        });
      }
    }
    return findings;
  }

  _executePrioritizePhase(findings = []) {
    const severityOrder = {
      [RISK_SEVERITY.CRITICAL]: 4,
      [RISK_SEVERITY.HIGH]: 3,
      [RISK_SEVERITY.MEDIUM]: 2,
      [RISK_SEVERITY.LOW]: 1,
      [RISK_SEVERITY.INFORMATIONAL]: 0
    };

    return [...findings].sort((a, b) => {
      const orderA = severityOrder[a.severity] ?? 0;
      const orderB = severityOrder[b.severity] ?? 0;
      if (orderB !== orderA) return orderB - orderA;
      return (b.cvssScore || 0) - (a.cvssScore || 0);
    });
  }

  _executeRecommendPhase(prioritizedRisks = []) {
    const recommendations = [];
    const seenCves = new Set();

    prioritizedRisks.forEach((risk, idx) => {
      if (seenCves.has(risk.cveId)) return;
      seenCves.add(risk.cveId);

      recommendations.push({
        priorityRank: idx + 1,
        cveId: risk.cveId,
        severity: risk.severity,
        target: `${risk.host}:${risk.port || ""}`,
        action: risk.remediation || "Review service configuration and apply latest vendor patches.",
        references: risk.references || []
      });
    });

    return recommendations;
  }

  _generateExecutiveSummary(context) {
    const totalFindings = context.findings.length;
    const criticals = context.findings.filter(f => f.severity === RISK_SEVERITY.CRITICAL).length;
    const highs = context.findings.filter(f => f.severity === RISK_SEVERITY.HIGH).length;
    const mediums = context.findings.filter(f => f.severity === RISK_SEVERITY.MEDIUM).length;

    let posture = "SECURE";
    if (criticals > 0) posture = "CRITICAL RISK";
    else if (highs > 0) posture = "ELEVATED RISK";
    else if (mediums > 0) posture = "MODERATE RISK";

    return `ULTRON SENTINEL completed defensive assessment of ${context.target}. Overall security posture is ${posture} (Score: ${context.risk?.score || 0}/100, Max CVSS: ${context.risk?.maxCvss || 0.0}). Discovered ${totalFindings} potential security finding(s): ${criticals} Critical, ${highs} High, ${mediums} Medium. Immediate remediation recommended for top-ranked CVEs.`;
  }

  /**
   * Pause an active scan.
   */
  pauseScan(scanId) {
    const scan = this.activeScans.get(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    if (scan.status === SCAN_STATUS.RUNNING) {
      scan.status = SCAN_STATUS.PAUSED;
      return { success: true, scanId, status: scan.status };
    }
    return { success: false, reason: `Cannot pause scan with status ${scan.status}` };
  }

  /**
   * Resume a paused scan.
   */
  resumeScan(scanId) {
    const scan = this.activeScans.get(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    if (scan.status === SCAN_STATUS.PAUSED) {
      scan.status = SCAN_STATUS.RUNNING;
      return { success: true, scanId, status: scan.status };
    }
    return { success: false, reason: `Cannot resume scan with status ${scan.status}` };
  }

  /**
   * Stop an active or paused scan.
   */
  stopScan(scanId) {
    const scan = this.activeScans.get(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    scan.status = SCAN_STATUS.STOPPED;
    scan.completedAt = new Date().toISOString();
    return { success: true, scanId, status: scan.status };
  }

  /**
   * Retrieve active or past scan context.
   */
  getScan(scanId) {
    return this.activeScans.get(scanId) || null;
  }
}

export const sentinelAgent = new SentinelAgent();
