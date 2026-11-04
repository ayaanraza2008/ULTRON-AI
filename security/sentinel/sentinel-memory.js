/**
 * ULTRON AI — Sentinel Cybersecurity Division
 * Module: SENTINEL MEMORY & DRIFT TRACKER (security/sentinel/sentinel-memory.js)
 *
 * Implements persistent per-network and per-host security intelligence,
 * tracking historical findings, vulnerability lifecycles (OPEN, REMEDIATED),
 * and network topology drift (newly exposed ports, closed ports, version changes).
 */

import fs from "node:fs";
import path from "node:path";

export class SentinelMemory {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "sentinel-memory.json");
    this.networks = new Map(); // networkId -> { networkId, name, assets: Map, lastScanned }
    this.vulnerabilities = new Map(); // vulnKey -> { vulnKey, cveId, host, port, status, firstSeen, lastSeen }
    this.scanHistory = [];
    this._load();
  }

  /**
   * Safe persistence loader.
   */
  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.scanHistory)) {
          this.scanHistory = data.scanHistory.slice(-50);
        }
        if (Array.isArray(data.vulnerabilities)) {
          data.vulnerabilities.forEach(v => this.vulnerabilities.set(v.vulnKey, v));
        }
      }
    } catch {
      // Degrade gracefully to in-memory state on read error
    }
  }

  /**
   * Safe persistence flush.
   */
  _save() {
    try {
      const data = {
        savedAt: new Date().toISOString(),
        scanHistory: this.scanHistory.slice(-50),
        vulnerabilities: Array.from(this.vulnerabilities.values())
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf8");
    } catch {
      // In-memory fallback if disk is read-only or restricted
    }
  }

  /**
   * Record scan completion in historical timeline.
   */
  recordScan(scanRecord) {
    if (!scanRecord) return;
    this.scanHistory.push({
      scanId: scanRecord.scanId,
      target: scanRecord.target,
      completedAt: new Date().toISOString(),
      findingsCount: scanRecord.findings?.length || 0,
      riskScore: scanRecord.risk?.score || 0,
      status: scanRecord.status || "COMPLETED"
    });
    this._save();
  }

  /**
   * Track findings, detect new vs previously seen issues, and compute drift.
   */
  updateFindings(targetHost, newFindings = []) {
    const now = new Date().toISOString();
    const drift = {
      newVulnerabilities: [],
      recurringVulnerabilities: [],
      resolvedVulnerabilities: []
    };

    const activeKeysOnHost = new Set();

    for (const f of newFindings) {
      const key = `${targetHost}:${f.port || "sys"}:${f.cveId}`;
      activeKeysOnHost.add(key);

      if (this.vulnerabilities.has(key)) {
        const existing = this.vulnerabilities.get(key);
        existing.lastSeen = now;
        existing.status = "OPEN";
        existing.timesDetected = (existing.timesDetected || 1) + 1;
        drift.recurringVulnerabilities.push(existing);
      } else {
        const record = {
          vulnKey: key,
          host: targetHost,
          port: f.port || null,
          cveId: f.cveId,
          title: f.title,
          severity: f.severity,
          cvssScore: f.cvssScore,
          status: "OPEN",
          firstSeen: now,
          lastSeen: now,
          timesDetected: 1
        };
        this.vulnerabilities.set(key, record);
        drift.newVulnerabilities.push(record);
      }
    }

    // Check for resolved vulnerabilities on this specific host
    for (const [key, v] of this.vulnerabilities.entries()) {
      if (v.host === targetHost && v.status === "OPEN" && !activeKeysOnHost.has(key)) {
        v.status = "RESOLVED";
        v.resolvedAt = now;
        drift.resolvedVulnerabilities.push(v);
      }
    }

    this._save();
    return drift;
  }

  /**
   * Detect port changes on an asset between previous scans and current scan.
   */
  computeAssetDrift(host, previousPorts = [], currentPorts = []) {
    const prevSet = new Set((previousPorts || []).map(p => p.port || p));
    const currSet = new Set((currentPorts || []).map(p => p.port || p));

    const openedPorts = [];
    const closedPorts = [];

    currSet.forEach(p => {
      if (!prevSet.has(p)) openedPorts.push(p);
    });

    prevSet.forEach(p => {
      if (!currSet.has(p)) closedPorts.push(p);
    });

    return {
      host,
      hasDrift: openedPorts.length > 0 || closedPorts.length > 0,
      openedPorts,
      closedPorts,
      totalCurrentPorts: currSet.size
    };
  }

  /**
   * Get all active (unresolved) vulnerabilities across all targets.
   */
  getActiveVulnerabilities() {
    return Array.from(this.vulnerabilities.values()).filter(v => v.status === "OPEN");
  }

  /**
   * Clear memory (primarily for isolated test fixtures).
   */
  clear() {
    this.networks.clear();
    this.vulnerabilities.clear();
    this.scanHistory = [];
    try {
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath);
      }
    } catch {
      // Ignore
    }
  }
}

export const sentinelMemory = new SentinelMemory();
