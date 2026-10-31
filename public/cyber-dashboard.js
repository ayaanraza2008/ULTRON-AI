/**
 * ULTRON AI — Cybersecurity Command Center Frontend
 * Module: CYBER DASHBOARD CLIENT (public/cyber-dashboard.js)
 *
 * Implements Cybersecurity Command Center UI:
 * - 13 Specialist Cyber Agent network telemetry
 * - Target Authorization Scope manager
 * - Mission Executor (Recon -> Scan -> Web -> Code -> AI Red-Team -> Report)
 * - SAST Code Shield & Remediation patch preview
 * - Web/API security auditor
 * - AI Red-Team vulnerability evaluator
 * - Emergency Stop engagement and recovery
 */

class UltronCyberDashboard {
  constructor() {
    this.agentsListEl = null;
    this.scopesListEl = null;
    this.targetInput = null;
    this.runMissionBtn = null;
    this.missionResultEl = null;
    this.sastCodeInput = null;
    this.sastScanBtn = null;
    this.sastResultEl = null;
    this.webUrlInput = null;
    this.webAuditBtn = null;
    this.webResultEl = null;
    this.aiRedTeamBtn = null;
    this.aiRedTeamResultEl = null;
    this.emergencyStopBtn = null;
    this.emergencyResumeBtn = null;
  }

  async init() {
    this._bindElements();
    this._attachEvents();
    await this.refreshStatus();
  }

  _bindElements() {
    this.agentsListEl = document.getElementById("cyberAgentsList");
    this.scopesListEl = document.getElementById("cyberScopesList");
    this.targetInput = document.getElementById("cyberTargetInput");
    this.runMissionBtn = document.getElementById("cyberRunMissionBtn");
    this.missionResultEl = document.getElementById("cyberMissionResult");
    this.sastCodeInput = document.getElementById("cyberSastInput");
    this.sastScanBtn = document.getElementById("cyberSastBtn");
    this.sastResultEl = document.getElementById("cyberSastResult");
    this.webUrlInput = document.getElementById("cyberWebInput");
    this.webAuditBtn = document.getElementById("cyberWebBtn");
    this.webResultEl = document.getElementById("cyberWebResult");
    this.aiRedTeamBtn = document.getElementById("cyberAiRedTeamBtn");
    this.aiRedTeamResultEl = document.getElementById("cyberAiRedTeamResult");
    this.emergencyStopBtn = document.getElementById("cyberEmergencyStopBtn");
    this.emergencyResumeBtn = document.getElementById("cyberEmergencyResumeBtn");
  }

  _attachEvents() {
    this.runMissionBtn?.addEventListener("click", () => this.runComprehensiveMission());
    this.sastScanBtn?.addEventListener("click", () => this.runSastScan());
    this.webAuditBtn?.addEventListener("click", () => this.runWebAudit());
    this.aiRedTeamBtn?.addEventListener("click", () => this.runAiRedTeam());

    this.emergencyStopBtn?.addEventListener("click", () => this.toggleEmergencyStop(true));
    this.emergencyResumeBtn?.addEventListener("click", () => this.toggleEmergencyStop(false));

    // Register Scope Form
    document.getElementById("cyberRegisterScopeBtn")?.addEventListener("click", () => this.registerNewScope());
  }

  async refreshStatus() {
    try {
      const res = await fetch("/api/jarvis/cyber/status");
      const data = await res.json();
      if (!data.success) return;

      // Render Cyber Agents
      if (this.agentsListEl && data.agents) {
        this.agentsListEl.innerHTML = data.agents.map(a => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid #1e293b; border-radius: 4px; font-size: 11px;">
            <strong style="color: #00f0ff;">${a.name}</strong>
            <span style="color: #94a3b8;">${a.role}</span>
            <span style="color: ${a.status.includes('ONLINE') ? '#10b981' : '#ef4444'}; font-weight: bold;">● ${a.status}</span>
          </div>
        `).join("");
      }

      // Render Scopes
      if (this.scopesListEl && data.scopes) {
        this.scopesListEl.innerHTML = data.scopes.map(s => `
          <div style="padding: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid #1e293b; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">
            <div style="display: flex; justify-content: space-between;">
              <strong style="color: #f1f5f9;">${s.organization}</strong>
              <span style="color: ${s.isActive ? '#10b981' : '#ef4444'}; font-weight: bold;">${s.isActive ? 'AUTHORIZED' : 'EXPIRED'}</span>
            </div>
            <div style="color: #38bdf8; margin: 2px 0;">Targets: ${s.targets.join(', ')}</div>
            <div style="color: #94a3b8; font-size: 10px;">Valid until: ${new Date(s.validUntil).toLocaleString()} | Proof: ${s.authorizationProof}</div>
          </div>
        `).join("");
      }
    } catch (err) {
      console.warn("[CyberDashboard] Failed to refresh status:", err.message);
    }
  }

  async runComprehensiveMission() {
    const target = this.targetInput?.value.trim() || "localhost";
    if (this.missionResultEl) {
      this.missionResultEl.innerHTML = `<div style="color: #00f0ff; padding: 12px;">🛡️ Running full multi-agent cybersecurity mission against ${target}...</div>`;
    }

    try {
      const res = await fetch("/api/jarvis/cyber/mission/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          options: {
            includeAiRedTeam: true,
            webHeaders: { "server": "Express" }
          }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Mission execution failed.");
      }

      this._renderMissionReport(data);
    } catch (err) {
      if (this.missionResultEl) {
        this.missionResultEl.innerHTML = `<div style="color: #ef4444; padding: 12px;">❌ Error: ${err.message}</div>`;
      }
    }
  }

  _renderMissionReport(data) {
    if (!this.missionResultEl) return;

    const riskColor = data.overallRisk === "CRITICAL" ? "#ef4444" : data.overallRisk === "HIGH" ? "#f59e0b" : "#10b981";

    this.missionResultEl.innerHTML = `
      <div style="background: rgba(17, 22, 34, 0.95); border: 1px solid #1e293b; border-radius: 6px; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 10px;">
          <div>
            <h3 style="margin: 0; color: #00f0ff;">Security Mission Report: ${data.target}</h3>
            <span style="font-size: 11px; color: #94a3b8;">Scope: ${data.scopeId} | Org: ${data.organization}</span>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 14px; font-weight: bold; color: ${riskColor}; border: 1px solid ${riskColor}; padding: 4px 10px; border-radius: 4px;">
              ${data.overallRisk} RISK (CVSS: ${data.maxCvss.toFixed(1)})
            </span>
          </div>
        </div>

        <div style="margin-top: 12px; font-size: 12px; color: #f1f5f9;">
          <strong>Total Findings:</strong> ${data.totalFindings} | <strong>Execution Time:</strong> ${data.executionTimeMs}ms
        </div>

        <!-- Findings List -->
        <div style="margin-top: 12px; max-height: 250px; overflow-y: auto;">
          ${(data.scanner?.findings || []).concat(data.web?.findings || []).map(f => `
            <div style="background: rgba(15, 23, 42, 0.7); border-left: 3px solid ${f.severity === 'CRITICAL' ? '#ef4444' : f.severity === 'HIGH' ? '#f59e0b' : '#38bdf8'}; padding: 8px; margin-bottom: 6px; border-radius: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 12px;">
                <strong style="color: #f1f5f9;">[${f.severity}] ${f.title || f.name}</strong>
                <span style="color: #94a3b8;">CVSS ${f.cvss || f.cvssScore || 'N/A'}</span>
              </div>
              <div style="font-size: 11px; color: #94a3b8; margin: 4px 0;">${f.impact || f.businessImpact || f.description}</div>
              <div style="font-size: 11px; color: #10b981;"><strong>Remediation:</strong> ${f.remediation}</div>
            </div>
          `).join("")}
        </div>

        <!-- Download Reports -->
        <div style="margin-top: 14px; display: flex; gap: 8px;">
          <button class="btn btn-sm btn-primary" id="cyberDownloadMdBtn">📥 Download Markdown Report</button>
        </div>
      </div>
    `;

    document.getElementById("cyberDownloadMdBtn")?.addEventListener("click", () => {
      const blob = new Blob([data.reports.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ULTRON_SECURITY_REPORT_${data.target}.md`;
      a.click();
    });
  }

  async runSastScan() {
    const code = this.sastCodeInput?.value || "";
    if (this.sastResultEl) {
      this.sastResultEl.innerHTML = `<div style="color: #00f0ff;">Scanning source code with Code Shield SAST...</div>`;
    }

    try {
      const res = await fetch("/api/jarvis/cyber/sast/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCode: code, target: "localhost" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "SAST scan failed.");

      this.sastResultEl.innerHTML = `
        <div style="padding: 10px; background: rgba(15, 23, 42, 0.7); border-radius: 4px; font-size: 12px;">
          <div>Status: <strong>${data.isSecure ? '✅ SECURE (0 Findings)' : `⚠️ VULNERABLE (${data.findingsCount} Findings)`}</strong></div>
          ${data.findings.map(f => `
            <div style="margin-top: 6px; padding: 6px; background: rgba(0,0,0,0.3); border-left: 2px solid #ef4444;">
              <div><strong>[${f.severity}] ${f.title} (${f.cwe})</strong> at line ${f.lineNumber}</div>
              <div style="color: #94a3b8; font-family: monospace;">${f.snippet}</div>
              <div style="color: #10b981; margin-top: 2px;">Fix: ${f.remediation}</div>
            </div>
          `).join("")}
        </div>
      `;
    } catch (err) {
      if (this.sastResultEl) this.sastResultEl.innerHTML = `<div style="color: #ef4444;">${err.message}</div>`;
    }
  }

  async runWebAudit() {
    const url = this.webUrlInput?.value || "http://localhost:3000";
    if (this.webResultEl) this.webResultEl.innerHTML = `<div style="color: #00f0ff;">Auditing web endpoint...</div>`;

    try {
      const res = await fetch("/api/jarvis/cyber/web/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl: url })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Web audit failed.");

      this.webResultEl.innerHTML = `
        <div style="padding: 10px; background: rgba(15, 23, 42, 0.7); border-radius: 4px; font-size: 12px;">
          <div>Risk: <strong>${data.overallRisk}</strong> (${data.findingsCount} findings)</div>
          ${data.findings.map(f => `
            <div style="margin-top: 6px; padding: 4px; border-left: 2px solid #f59e0b;">
              <strong>${f.title}</strong> - ${f.remediation}
            </div>
          `).join("")}
        </div>
      `;
    } catch (err) {
      if (this.webResultEl) this.webResultEl.innerHTML = `<div style="color: #ef4444;">${err.message}</div>`;
    }
  }

  async runAiRedTeam() {
    if (this.aiRedTeamResultEl) this.aiRedTeamResultEl.innerHTML = `<div style="color: #00f0ff;">Running AI Red-Team Evaluation probes...</div>`;

    try {
      const res = await fetch("/api/jarvis/cyber/ai/redteam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "localhost" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "AI Red-Team failed.");

      this.aiRedTeamResultEl.innerHTML = `
        <div style="padding: 10px; background: rgba(15, 23, 42, 0.7); border-radius: 4px; font-size: 12px;">
          <div style="color: #10b981; font-weight: bold;">AI Defense Status: ${data.status} (${data.resistanceScore}% Resistance)</div>
          <div style="color: #94a3b8; font-size: 11px;">Defended: ${data.defendedCount}/${data.totalProbes} probes | Vulnerabilities: ${data.vulnerabilityCount}</div>
          <div style="margin-top: 8px;">
            ${data.results.map(r => `
              <div style="font-size: 11px; margin-top: 4px;">
                <span style="color: ${r.status === 'DEFENDED' ? '#10b981' : '#ef4444'};">● ${r.status}</span>: ${r.name}
              </div>
            `).join("")}
          </div>
        </div>
      `;
    } catch (err) {
      if (this.aiRedTeamResultEl) this.aiRedTeamResultEl.innerHTML = `<div style="color: #ef4444;">${err.message}</div>`;
    }
  }

  async toggleEmergencyStop(engage) {
    const endpoint = engage ? "/api/jarvis/cyber/emergency/stop" : "/api/jarvis/cyber/emergency/resume";
    const body = engage
      ? { reason: "Operator manual cyber halt" }
      : { operatorKey: "ULTRON_OPERATOR_MASTER_KEY_SECRET" };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      alert(data.message || (data.success ? "Success" : "Failed"));
      await this.refreshStatus();
    } catch (err) {
      alert(`Emergency Stop action error: ${err.message}`);
    }
  }

  async registerNewScope() {
    const org = prompt("Enter Authorized Organization Name:");
    if (!org) return;
    const target = prompt("Enter Target Domain, IP or URL (e.g. localhost, myapp.test):");
    if (!target) return;
    const proof = prompt("Enter Authorization Proof Ref (e.g. WRITTEN_SECURITY_ENGAGEMENT_LETTER):");
    if (!proof) return;

    try {
      const res = await fetch("/api/jarvis/cyber/scopes/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: org,
          targets: [target],
          ownerApproved: true,
          authorizationProof: proof
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Registration failed");
      alert(`Scope registered: ${data.scope.scopeId}`);
      await this.refreshStatus();
    } catch (err) {
      alert(`Scope registration error: ${err.message}`);
    }
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    window.ultronCyberDashboard = new UltronCyberDashboard();
    window.ultronCyberDashboard.init();
  });
}
