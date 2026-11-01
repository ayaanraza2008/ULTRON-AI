/**
 * ULTRON AI — Sentinel Cybersecurity Division Frontend Client
 * Module: SENTINEL DASHBOARD (public/sentinel-dashboard.js)
 *
 * Implements the ULTRON SENTINEL command center HUD interface:
 * - 7-phase autonomous decision loop visualization
 * - Network discovery, open port enumeration, and asset inventory
 * - Network topology SVG graph rendering (Gateways, Hosts, Services)
 * - Security findings, CVSS v3.1 scoring, and verified remediation guidance
 * - Real-time controls: Start Safe Scan, Pause, Resume, Stop, Generate Report, Emergency Halt
 * - Hardware telemetry (AMD Ryzen 7 5700U, Pure CPU, 0 CUDA)
 *
 * SAFETY: 100% safe DOM element construction (CWE-79 / XSS immune).
 */

class UltronSentinelDashboard {
  constructor() {
    this.targetInput = null;
    this.startScanBtn = null;
    this.pauseBtn = null;
    this.resumeBtn = null;
    this.stopBtn = null;
    this.reportBtn = null;
    this.emergencyHaltBtn = null;
    this.currentScanId = null;
    this.isPolling = false;
  }

  async init() {
    this._bindElements();
    this._attachEvents();
    await this.refreshTelemetry();
  }

  _bindElements() {
    this.targetInput = document.getElementById("sentinelTargetInput");
    this.startScanBtn = document.getElementById("sentinelStartScanBtn");
    this.pauseBtn = document.getElementById("sentinelPauseBtn");
    this.resumeBtn = document.getElementById("sentinelResumeBtn");
    this.stopBtn = document.getElementById("sentinelStopBtn");
    this.reportBtn = document.getElementById("sentinelReportBtn");
    this.emergencyHaltBtn = document.getElementById("sentinelEmergencyHaltBtn");
  }

  _attachEvents() {
    this.startScanBtn?.addEventListener("click", () => this.startScan());
    this.pauseBtn?.addEventListener("click", () => this.pauseScan());
    this.resumeBtn?.addEventListener("click", () => this.resumeScan());
    this.stopBtn?.addEventListener("click", () => this.stopScan());
    this.reportBtn?.addEventListener("click", () => this.generateReport());
    this.emergencyHaltBtn?.addEventListener("click", () => this.toggleEmergencyHalt());
  }

  async refreshTelemetry() {
    try {
      const [statusRes, hwRes] = await Promise.all([
        fetch("/api/jarvis/sentinel/status"),
        fetch("/api/jarvis/sentinel/hardware")
      ]);

      const statusData = await statusRes.json();
      const hwData = await hwRes.json();

      if (statusData.success) {
        this._renderSystemStatus(statusData);
      }
      if (hwData.success) {
        this._renderHardwareProfile(hwData.profile);
      }
    } catch (err) {
      console.warn("[SENTINEL] Telemetry refresh deferred:", err.message);
    }
  }

  _renderSystemStatus(data) {
    const statusBadge = document.getElementById("sentinelStatusBadge");
    if (statusBadge) {
      statusBadge.textContent = data.status || "ONLINE_DEFENSIVE";
      statusBadge.style.color = data.status?.includes("HALTED") ? "#ef4444" : "#10b981";
      statusBadge.style.borderColor = data.status?.includes("HALTED") ? "rgba(239, 68, 68, 0.4)" : "rgba(16, 185, 129, 0.4)";
    }
    const scopesCountEl = document.getElementById("sentinelScopesCount");
    if (scopesCountEl) scopesCountEl.textContent = `${data.authorizedScopesCount || 1} Authorized`;
    const vulnCountEl = document.getElementById("sentinelActiveVulnsCount");
    if (vulnCountEl) vulnCountEl.textContent = `${data.activeVulnerabilitiesCount || 0} Open`;
  }

  _renderHardwareProfile(profile) {
    const hwEl = document.getElementById("sentinelHwTelemetry");
    if (!hwEl || !profile) return;

    hwEl.replaceChildren();
    const grid = document.createElement("div");
    grid.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px;";

    const makeStat = (label, val, valColor) => {
      const col = document.createElement("div");
      const lblSpan = document.createElement("span");
      lblSpan.style.color = "#64748b";
      lblSpan.textContent = label + ": ";
      const valStrong = document.createElement("strong");
      valStrong.style.color = valColor;
      valStrong.textContent = String(val);
      col.appendChild(lblSpan);
      col.appendChild(valStrong);
      return col;
    };

    grid.appendChild(makeStat("Platform", profile.platform, "#a855f7"));
    grid.appendChild(makeStat("Mode", "PURE_CPU (0 CUDA)", "#10b981"));
    grid.appendChild(makeStat("CPU", `${profile.cpuModel} (${profile.vCpuCount} vCPUs)`, "#cbd5e1"));
    grid.appendChild(makeStat("Memory", `${profile.totalMemoryMB} MB (${profile.memoryUtilizationPercent}% utilized)`, "#cbd5e1"));

    hwEl.appendChild(grid);
  }

  async startScan() {
    const target = this.targetInput?.value?.trim() || "localhost";
    const logEl = document.getElementById("sentinelActivityLog");

    if (logEl) {
      logEl.replaceChildren();
      const initEntry = document.createElement("div");
      initEntry.style.color = "#38bdf8";
      initEntry.textContent = `[INIT] Authorizing defensive assessment on: ${target}...`;
      logEl.appendChild(initEntry);
    }
    this._highlightPhase("DISCOVER");

    try {
      if (this.startScanBtn) this.startScanBtn.disabled = true;

      const res = await fetch("/api/jarvis/sentinel/scan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, options: { dryRun: false } })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Scan failed to initiate.");
      }

      const scan = data.scan;
      this.currentScanId = scan.scanId;

      this._renderScanResults(scan);
      await this.refreshTelemetry();
    } catch (err) {
      if (logEl) {
        const errEntry = document.createElement("div");
        errEntry.style.color = "#ef4444";
        errEntry.style.marginTop = "6px";
        errEntry.textContent = `[ERROR] ${err.message}`;
        logEl.appendChild(errEntry);
      }
    } finally {
      if (this.startScanBtn) this.startScanBtn.disabled = false;
    }
  }

  _renderScanResults(scan) {
    (scan.phasesExecuted || []).forEach(p => {
      this._highlightPhase(p.phase);
    });

    const logEl = document.getElementById("sentinelActivityLog");
    if (logEl) {
      logEl.replaceChildren();
      (scan.phasesExecuted || []).forEach(p => {
        const entry = document.createElement("div");
        entry.style.cssText = "padding: 4px 0; border-bottom: 1px dashed rgba(255, 255, 255, 0.05); font-size: 11px;";
        const phaseSpan = document.createElement("span");
        phaseSpan.style.color = "#a855f7";
        phaseSpan.style.fontWeight = "bold";
        phaseSpan.textContent = `[${p.phase}] `;
        const ratSpan = document.createElement("span");
        ratSpan.style.color = "#94a3b8";
        ratSpan.textContent = p.rationale;
        entry.appendChild(phaseSpan);
        entry.appendChild(ratSpan);
        logEl.appendChild(entry);
      });
      if (scan.executiveSummary) {
        const summary = document.createElement("div");
        summary.style.cssText = "margin-top: 8px; padding: 8px; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; font-size: 11px; color: #e2e8f0;";
        summary.textContent = scan.executiveSummary;
        logEl.appendChild(summary);
      }
    }

    if (scan.topology) {
      this._renderTopologyGraph(scan.topology);
    }
    this._renderAssetInventory(scan.assets);
    this._renderFindings(scan.findings);
  }

  _highlightPhase(activePhase) {
    const phases = ["DISCOVER", "INVENTORY", "ANALYZE", "IDENTIFY_RISKS", "PRIORITIZE", "RECOMMEND", "REPORT"];
    phases.forEach(p => {
      const el = document.getElementById(`sentinel-phase-${p.toLowerCase()}`);
      if (el) {
        if (p === activePhase) {
          el.style.background = "rgba(168, 85, 247, 0.3)";
          el.style.borderColor = "#c084fc";
          el.style.color = "#fff";
        } else {
          el.style.background = "rgba(15, 23, 42, 0.5)";
          el.style.borderColor = "#1e293b";
          el.style.color = "#64748b";
        }
      }
    });
  }

  _renderTopologyGraph(topology) {
    const container = document.getElementById("sentinelTopologyContainer");
    if (!container) return;

    container.replaceChildren();
    const width = 480;
    const height = 220;
    const nodes = topology.nodes || [];

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.cssText = "width: 100%; height: 220px; background: #070913; border-radius: 6px; border: 1px solid #1e293b;";

    const positions = new Map();
    positions.set("node-gateway", { x: 60, y: height / 2, color: "#38bdf8", label: "Gateway" });

    let assetIdx = 0;
    nodes.filter(n => n.type !== "GATEWAY" && n.type !== "SERVICE").forEach(n => {
      positions.set(n.id, { x: 220, y: 50 + (assetIdx * 60), color: "#a855f7", label: n.label });
      assetIdx++;
    });

    let svcIdx = 0;
    nodes.filter(n => n.type === "SERVICE").forEach(n => {
      positions.set(n.id, { x: 380, y: 35 + (svcIdx * 35), color: "#10b981", label: n.label });
      svcIdx++;
    });

    (topology.edges || []).forEach(e => {
      const p1 = positions.get(e.from);
      const p2 = positions.get(e.to);
      if (p1 && p2) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(p1.x));
        line.setAttribute("y1", String(p1.y));
        line.setAttribute("x2", String(p2.x));
        line.setAttribute("y2", String(p2.y));
        line.setAttribute("stroke", "rgba(168, 85, 247, 0.4)");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "3,3");
        svg.appendChild(line);
      }
    });

    for (const [, pos] of positions.entries()) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(pos.x));
      circle.setAttribute("cy", String(pos.y));
      circle.setAttribute("r", "12");
      circle.setAttribute("fill", "#0f172a");
      circle.setAttribute("stroke", pos.color);
      circle.setAttribute("stroke-width", "2");

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(pos.x));
      text.setAttribute("y", String(pos.y + 22));
      text.setAttribute("fill", "#e2e8f0");
      text.setAttribute("font-size", "9");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-family", "monospace");
      text.textContent = pos.label.slice(0, 14);

      g.appendChild(circle);
      g.appendChild(text);
      svg.appendChild(g);
    }

    container.appendChild(svg);
  }

  _renderAssetInventory(assets = []) {
    const container = document.getElementById("sentinelAssetsContainer");
    if (!container) return;

    container.replaceChildren();
    if (!assets.length) {
      const empty = document.createElement("span");
      empty.style.color = "#64748b";
      empty.style.fontSize = "11px";
      empty.textContent = "No active network assets discovered.";
      container.appendChild(empty);
      return;
    }

    assets.forEach(a => {
      const card = document.createElement("div");
      card.style.cssText = "padding: 8px; background: rgba(15, 23, 42, 0.8); border: 1px solid #1e293b; border-radius: 4px; font-size: 11px; margin-bottom: 6px;";

      const topRow = document.createElement("div");
      topRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;";
      const ipEl = document.createElement("strong");
      ipEl.style.color = "#38bdf8";
      ipEl.textContent = a.ip;
      const typeBadge = document.createElement("span");
      typeBadge.style.cssText = "background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 1px 6px; border-radius: 3px; font-size: 10px;";
      typeBadge.textContent = a.deviceType;
      topRow.appendChild(ipEl);
      topRow.appendChild(typeBadge);

      const hostRow = document.createElement("div");
      hostRow.style.cssText = "color: #94a3b8; font-size: 10px; margin-bottom: 4px;";
      hostRow.textContent = `Hostname: ${a.hostname || "no-rdns"}`;

      const portsRow = document.createElement("div");
      portsRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px;";
      if (a.openPorts && a.openPorts.length > 0) {
        a.openPorts.forEach(p => {
          const pBadge = document.createElement("span");
          pBadge.style.cssText = "background: #1e293b; color: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 10px; border-left: 2px solid #10b981;";
          pBadge.textContent = `${p.service.toUpperCase()}:${p.port}`;
          portsRow.appendChild(pBadge);
        });
      } else {
        const noPorts = document.createElement("span");
        noPorts.style.color = "#64748b";
        noPorts.textContent = "No open ports identified.";
        portsRow.appendChild(noPorts);
      }

      card.appendChild(topRow);
      card.appendChild(hostRow);
      card.appendChild(portsRow);
      container.appendChild(card);
    });
  }

  _renderFindings(findings = []) {
    const container = document.getElementById("sentinelFindingsContainer");
    if (!container) return;

    container.replaceChildren();
    if (!findings.length) {
      const cleanMsg = document.createElement("div");
      cleanMsg.style.cssText = "padding: 12px; text-align: center; color: #10b981; font-size: 11px;";
      cleanMsg.textContent = "✓ No high-confidence vulnerabilities matched against target baseline.";
      container.appendChild(cleanMsg);
      return;
    }

    findings.forEach(f => {
      const card = document.createElement("div");
      const sevColor = f.severity === "CRITICAL" ? "#ef4444" : f.severity === "HIGH" ? "#f97316" : f.severity === "MEDIUM" ? "#eab308" : "#3b82f6";
      card.style.cssText = `padding: 10px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-left: 3px solid ${sevColor}; border-radius: 4px; font-size: 11px; margin-bottom: 8px;`;

      const header = document.createElement("div");
      header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;";
      const titleEl = document.createElement("strong");
      titleEl.style.color = "#f1f5f9";
      titleEl.textContent = `${f.cveId}: ${f.title}`;
      const badge = document.createElement("span");
      badge.style.cssText = `background: ${sevColor}22; color: ${sevColor}; font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 10px;`;
      badge.textContent = `${f.severity} (CVSS ${f.cvssScore})`;
      header.appendChild(titleEl);
      header.appendChild(badge);

      const meta = document.createElement("div");
      meta.style.cssText = "color: #94a3b8; font-size: 10px; margin-bottom: 4px;";
      meta.textContent = `Matched: ${f.matchedService} on port ${f.port || "N/A"} | Version: ${f.detectedVersion}`;

      const sum = document.createElement("div");
      sum.style.cssText = "color: #cbd5e1; margin-bottom: 6px;";
      sum.textContent = f.summary;

      const rem = document.createElement("div");
      rem.style.cssText = "background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); padding: 6px; border-radius: 3px; color: #6ee7b7; font-size: 10px;";
      rem.textContent = `Remediation: ${f.remediation}`;

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(sum);
      card.appendChild(rem);
      container.appendChild(card);
    });
  }

  async pauseScan() {
    if (!this.currentScanId) return;
    try {
      const res = await fetch("/api/jarvis/sentinel/scan/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: this.currentScanId })
      });
      const data = await res.json();
      alert(`Scan paused: ${data.status}`);
    } catch (err) {
      alert(`Error pausing scan: ${err.message}`);
    }
  }

  async resumeScan() {
    if (!this.currentScanId) return;
    try {
      const res = await fetch("/api/jarvis/sentinel/scan/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: this.currentScanId })
      });
      const data = await res.json();
      alert(`Scan resumed: ${data.status}`);
    } catch (err) {
      alert(`Error resuming scan: ${err.message}`);
    }
  }

  async stopScan() {
    if (!this.currentScanId) return;
    try {
      const res = await fetch("/api/jarvis/sentinel/scan/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: this.currentScanId })
      });
      const data = await res.json();
      alert(`Scan stopped: ${data.status}`);
    } catch (err) {
      alert(`Error stopping scan: ${err.message}`);
    }
  }

  async generateReport() {
    if (!this.currentScanId) {
      alert("No active or recent scan available to generate report. Run a scan first.");
      return;
    }
    try {
      const res = await fetch("/api/jarvis/sentinel/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: this.currentScanId, format: "markdown" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Report generation failed");

      this._showReportModal(data.report.content);
    } catch (err) {
      alert(`Report error: ${err.message}`);
    }
  }

  _showReportModal(markdown) {
    let modal = document.getElementById("sentinelReportModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "sentinelReportModal";
      modal.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 9999; padding: 20px;";

      const inner = document.createElement("div");
      inner.style.cssText = "background: #0d1117; border: 1px solid #30363d; border-radius: 8px; width: 90%; max-width: 800px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;";

      const head = document.createElement("div");
      head.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #21262d;";
      const headTitle = document.createElement("strong");
      headTitle.style.cssText = "color: #c084fc; font-size: 13px;";
      headTitle.textContent = "SENTINEL SECURITY REPORT";
      const closeBtn = document.createElement("button");
      closeBtn.id = "closeSentinelReportModalBtn";
      closeBtn.style.cssText = "background: transparent; border: none; color: #fff; font-size: 18px; cursor: pointer;";
      closeBtn.textContent = "✕";
      head.appendChild(headTitle);
      head.appendChild(closeBtn);

      const pre = document.createElement("pre");
      pre.id = "sentinelReportContent";
      pre.style.cssText = "padding: 16px; overflow-y: auto; color: #e2e8f0; font-family: monospace; font-size: 11px; white-space: pre-wrap; margin: 0;";

      inner.appendChild(head);
      inner.appendChild(pre);
      modal.appendChild(inner);
      document.body.appendChild(modal);

      closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    const contentEl = document.getElementById("sentinelReportContent");
    if (contentEl) contentEl.textContent = markdown;
    modal.style.display = "flex";
  }

  async toggleEmergencyHalt() {
    if (!confirm("ENGAGE CYBERSECURITY EMERGENCY HALT?\n\nThis will instantly abort all scans, terminate background monitors, and freeze testing scopes.")) return;

    try {
      const res = await fetch("/api/jarvis/sentinel/emergency/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Manual Emergency Halt triggered by operator from SENTINEL HUD." })
      });
      const data = await res.json();
      alert(`Emergency halt engaged: ${data.emergencyStopEngaged}`);
      await this.refreshTelemetry();
    } catch (err) {
      alert(`Halt error: ${err.message}`);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const sentinel = new UltronSentinelDashboard();
  sentinel.init();
});
