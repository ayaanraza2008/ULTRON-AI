/**
 * ULTRON AI — Sentinel Cybersecurity Division
 * Module: CONTINUOUS DEFENSIVE MONITOR & WATCHDOG (security/sentinel/sentinel-monitor.js)
 *
 * Implements periodic passive security audits, topology drift detection,
 * proactive event notifications, and fail-safe watchdog recovery.
 */

import { EventEmitter } from "node:events";
import { SENTINEL_EVENTS } from "./sentinel-types.js";
import { sentinelAgent } from "./sentinel-agent.js";
import { targetAuthorizationGateway } from "../target-authorization-gateway.js";

export class SentinelMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.agent = options.agent || sentinelAgent;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.intervalMs = options.intervalMs || 60_000; // Default: check every 60 seconds
    this.timer = null;
    this.isRunning = false;
    this.monitoredTargets = new Set(["localhost"]);
    this.lastCheckAt = null;
    this.eventHistory = [];
  }

  /**
   * Start continuous defensive monitoring.
   */
  start(targets = ["localhost"], intervalMs = this.intervalMs) {
    if (this.isRunning) return { running: true, message: "Monitor already active." };

    targets.forEach(t => this.monitoredTargets.add(String(t).toLowerCase().trim()));
    this.intervalMs = Math.max(intervalMs, 10_000); // Enforce min 10s interval to prevent rate-limit exhaustion
    this.isRunning = true;

    this.timer = setInterval(async () => {
      await this.runAuditCycle();
    }, this.intervalMs);

    this.emitEvent(SENTINEL_EVENTS.SCAN_STARTED, { targets: Array.from(this.monitoredTargets) });
    return { running: true, intervalMs: this.intervalMs, targets: Array.from(this.monitoredTargets) };
  }

  /**
   * Stop continuous monitoring.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.emitEvent(SENTINEL_EVENTS.SCAN_STOPPED, { stoppedAt: new Date().toISOString() });
    return { running: false };
  }

  /**
   * Run a single defensive audit cycle across monitored targets.
   */
  async runAuditCycle() {
    if (this.authGateway.emergencyStopEngaged) {
      this.stop();
      this.emitEvent(SENTINEL_EVENTS.EMERGENCY_HALT, { reason: "Emergency stop engaged during monitor cycle." });
      return;
    }

    this.lastCheckAt = new Date().toISOString();

    for (const target of this.monitoredTargets) {
      try {
        const scan = await this.agent.runMission(target, { dryRun: true });
        if (scan.findings && scan.findings.length > 0) {
          this.emitEvent(SENTINEL_EVENTS.VULNERABILITY_DETECTED, {
            target,
            findingsCount: scan.findings.length,
            riskScore: scan.risk?.score || 0
          });
        }
      } catch (err) {
        if (err.message?.includes("TARGET_OUT_OF_SCOPE")) {
          this.emitEvent(SENTINEL_EVENTS.SCOPE_BLOCKED, { target, error: err.message });
        }
      }
    }
  }

  /**
   * Record and emit a sentinel event.
   */
  emitEvent(eventType, payload = {}) {
    const eventObj = {
      id: "evt-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6),
      type: eventType,
      timestamp: new Date().toISOString(),
      payload
    };
    this.eventHistory.unshift(eventObj);
    if (this.eventHistory.length > 100) {
      this.eventHistory.pop();
    }
    this.emit(eventType, eventObj);
    return eventObj;
  }

  /**
   * Retrieve current monitor status and event stream buffer.
   */
  getStatus() {
    return {
      running: this.isRunning,
      intervalMs: this.intervalMs,
      monitoredTargets: Array.from(this.monitoredTargets),
      lastCheckAt: this.lastCheckAt,
      recentEvents: this.eventHistory.slice(0, 20)
    };
  }
}

export const sentinelMonitor = new SentinelMonitor();
