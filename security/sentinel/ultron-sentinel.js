/**
 * ULTRON AI — Sentinel Cybersecurity Division
 * Module: ULTRON SENTINEL UNIFIED FACADE (security/sentinel/ultron-sentinel.js)
 *
 * Central operational gateway for the ULTRON SENTINEL cybersecurity division.
 * Integrates network discovery, CVE matching, autonomous agent workflow,
 * persistent memory, platform hardware adaptation, and defensive monitoring.
 */

import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "../target-authorization-gateway.js";
import { cveDatabase } from "./cve-database.js";
import { networkDiscoveryEngine } from "./network-discovery.js";
import { sentinelAgent } from "./sentinel-agent.js";
import { sentinelMemory } from "./sentinel-memory.js";
import { sentinelMonitor } from "./sentinel-monitor.js";
import { hardwareAdapter } from "./hardware-adapter.js";
import { SCAN_STATUS, RISK_SEVERITY, SENTINEL_PHASES } from "./sentinel-types.js";

export class UltronSentinel {
  constructor(options = {}) {
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.cveDb = options.cveDb || cveDatabase;
    this.discovery = options.discovery || networkDiscoveryEngine;
    this.agent = options.agent || sentinelAgent;
    this.memory = options.memory || sentinelMemory;
    this.monitor = options.monitor || sentinelMonitor;
    this.hardware = options.hardware || hardwareAdapter;
  }

  /**
   * System overview and division telemetry.
   */
  getStatus() {
    const hw = this.hardware.getHardwareProfile();
    const activeVulns = this.memory.getActiveVulnerabilities();
    const monitorStatus = this.monitor.getStatus();

    return {
      name: "ULTRON SENTINEL",
      division: "Autonomous Cybersecurity & Network Intelligence Division",
      version: "1.0.0",
      status: this.authGateway.emergencyStopEngaged ? "HALTED_EMERGENCY" : "ONLINE_DEFENSIVE",
      platform: hw.platform,
      executionMode: hw.executionMode,
      cudaAvailable: hw.cudaAvailable,
      hardware: {
        cpuModel: hw.cpuModel,
        vCpuCount: hw.vCpuCount,
        totalMemoryMB: hw.totalMemoryMB,
        freeMemoryMB: hw.freeMemoryMB,
        memoryUtilizationPercent: hw.memoryUtilizationPercent
      },
      authorizedScopesCount: this.authGateway.activeScopes.size,
      activeVulnerabilitiesCount: activeVulns.length,
      monitorRunning: monitorStatus.running,
      totalScansRecorded: this.memory.scanHistory.length
    };
  }

  /**
   * Start an autonomous scan on an authorized target.
   */
  async startScan(target, options = {}) {
    return await this.agent.runMission(target, options);
  }

  /**
   * Pause an ongoing scan.
   */
  pauseScan(scanId) {
    return this.agent.pauseScan(scanId);
  }

  /**
   * Resume a paused scan.
   */
  resumeScan(scanId) {
    return this.agent.resumeScan(scanId);
  }

  /**
   * Stop an active scan.
   */
  stopScan(scanId) {
    return this.agent.stopScan(scanId);
  }

  /**
   * Emergency stop all security operations.
   */
  emergencyStop(reason = "Operator requested emergency halt") {
    this.authGateway.engageEmergencyStop(reason);
    this.monitor.stop();
    return {
      success: true,
      emergencyStopEngaged: true,
      reason,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Resume operations from emergency stop.
   */
  emergencyResume(operatorKey) {
    this.authGateway.disengageEmergencyStop(operatorKey);
    return {
      success: true,
      emergencyStopEngaged: false,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get active and past vulnerability findings with filtering.
   */
  getFindings(filter = {}) {
    let vulns = this.memory.getActiveVulnerabilities();
    if (filter.severity) {
      const targetSev = String(filter.severity).toUpperCase();
      vulns = vulns.filter(v => v.severity === targetSev);
    }
    if (filter.host) {
      vulns = vulns.filter(v => v.host.includes(filter.host.toLowerCase()));
    }
    return vulns;
  }

  /**
   * Get historical scans and topology records.
   */
  getHistory() {
    return {
      scanHistory: this.memory.scanHistory,
      activeVulnerabilities: this.memory.getActiveVulnerabilities()
    };
  }

  /**
   * Generate formatted security assessment report (Markdown or JSON).
   */
  generateReport(scanId, format = "markdown") {
    const scan = this.agent.getScan(scanId) || (this.memory.scanHistory.find(s => s.scanId === scanId));
    if (!scan) throw new Error(`Report generation failed: Scan '${scanId}' not found.`);

    if (format === "json") {
      return { format: "json", data: scan };
    }

    // Markdown format
    const md = [
      `# ULTRON SENTINEL — CYBERSECURITY ASSESSMENT REPORT`,
      `**Target:** \`${scan.target || "Unknown"}\`  `,
      `**Scan ID:** \`${scan.scanId || scanId}\`  `,
      `**Status:** \`${scan.status || "COMPLETED"}\`  `,
      `**Generated At:** \`${new Date().toISOString()}\`  `,
      `**Platform:** \`${this.hardware.getHardwareProfile().platform}\` | **Mode:** \`PURE_CPU_LIGHTWEIGHT (0 CUDA)\``,
      ``,
      `---`,
      ``,
      `## 1. EXECUTIVE SUMMARY`,
      scan.executiveSummary || `Defensive assessment completed with ${scan.findingsCount || scan.findings?.length || 0} findings recorded.`,
      ``,
      `## 2. RISK POSTURE & METRICS`,
      `- **Overall Risk Score:** ${scan.risk?.score ?? scan.riskScore ?? 0}/100`,
      `- **Max CVSS v3.1:** ${scan.risk?.maxCvss ?? 0.0}`,
      `- **Severity Tier:** ${scan.risk?.severity || "INFORMATIONAL"}`,
      `- **Total Findings:** ${scan.findings?.length || scan.findingsCount || 0}`,
      ``,
      `## 3. ASSET INVENTORY & DISCOVERED SERVICES`
    ];

    if (scan.assets && scan.assets.length > 0) {
      scan.assets.forEach(asset => {
        md.push(`### Host: \`${asset.ip}\` (${asset.hostname || "no-rdns"}) - ${asset.deviceType}`);
        if (asset.openPorts && asset.openPorts.length > 0) {
          md.push(`| Port | Protocol | Service | Detected Version | Description |`);
          md.push(`| :--- | :--- | :--- | :--- | :--- |`);
          asset.openPorts.forEach(p => {
            md.push(`| ${p.port} | ${p.protocol} | ${p.service} | ${p.detectedVersion || "N/A"} | ${p.description || "Active Port"} |`);
          });
        } else {
          md.push(`*No open ports identified during safe probe.*`);
        }
        md.push(``);
      });
    } else {
      md.push(`*Asset telemetry retained in active memory store.*`);
      md.push(``);
    }

    md.push(`## 4. SECURITY FINDINGS & CVE CORRELATION`);
    if (scan.findings && scan.findings.length > 0) {
      scan.findings.forEach(f => {
        md.push(`### [${f.severity}] ${f.cveId}: ${f.title}`);
        md.push(`- **CVSS Score:** ${f.cvssScore} (${f.cweId})`);
        md.push(`- **Affected Service:** \`${f.matchedService}\` on port \`${f.port || "N/A"}\``);
        md.push(`- **Detected Version:** \`${f.detectedVersion}\``);
        md.push(`- **Summary:** ${f.summary}`);
        md.push(`- **Remediation:** ${f.remediation}`);
        if (f.references && f.references.length > 0) {
          md.push(`- **References:** ${f.references.join(", ")}`);
        }
        md.push(``);
      });
    } else {
      md.push(`*No high-confidence vulnerabilities matched against catalog.*`);
      md.push(``);
    }

    md.push(`## 5. ACTIONABLE REMEDIATION ROADMAP`);
    if (scan.recommendations && scan.recommendations.length > 0) {
      scan.recommendations.forEach(r => {
        md.push(`${r.priorityRank}. **[${r.severity}] ${r.cveId}** on \`${r.target}\`: ${r.action}`);
      });
    } else {
      md.push(`*Maintain current baseline and continue scheduled defensive monitoring.*`);
    }

    md.push(``);
    md.push(`---`);
    md.push(`*ULTRON SENTINEL Security Engine — Zero Offensive Exploitation — 100% Defensive Scope Verification*`);

    return {
      format: "markdown",
      content: md.join("\n")
    };
  }

  /**
   * Search offline CVE database.
   */
  searchCveDatabase(query) {
    return this.cveDb.search(query);
  }
}

export const ultronSentinel = new UltronSentinel();
export {
  SENTINEL_PHASES,
  SCAN_STATUS,
  RISK_SEVERITY
};
