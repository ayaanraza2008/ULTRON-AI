/**
 * ULTRON AI — Proactive Autonomous Assistant Daemon
 *
 * Implements Iron Man's JARVIS-level proactive behavior:
 * - Periodically monitors system vitals (AMD Ryzen 7 CPU, RAM, Battery)
 * - Identifies critical conditions:
 *   - Low battery alert (< 20% and discharging)
 *   - Elevated RAM pressure (> 85% on 8 GB RAM)
 *   - Scheduled productivity reminders due
 *   - Morning daily briefing on first interaction
 * - Emits proactive alerts and spoken notifications
 *
 * Non-blocking, light-weight, designed for 24/7 background operation.
 */

import { windowsAutomation } from "./windows-automation.js";
import { windowsSpeechDaemon } from "../voice/windows-speech-daemon.js";
import { ProductivitySuite } from "../integrations/productivity.js";
import os from "node:os";

export class ProactiveDaemon {
  constructor(options = {}) {
    this.productivity = options.productivity || new ProductivitySuite();
    this.intervalMs = options.intervalMs || 30000; // default 30s tick
    this.timer = null;
    this.isRunning = false;
    this.enableSpokenAlerts = options.enableSpokenAlerts ?? false;
    this.lastBatteryWarningAt = 0;
    this.lastMemoryWarningAt = 0;
    this.morningBriefingDelivered = false;
    this.isLoadShedding = false;
    this.alerts = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  async tick() {
    const alerts = [];
    const now = Date.now();

    try {
      // 1. Check Battery State
      const battery = await windowsAutomation.getBatteryStatus();
      if (battery.present && !battery.isCharging && battery.percent <= 20) {
        if (now - this.lastBatteryWarningAt > 15 * 60 * 1000) { // Throttle 15 min
          this.lastBatteryWarningAt = now;
          const msg = `Sir, power level is at ${battery.percent} percent. Please connect your charger.`;
          alerts.push({ type: "BATTERY_LOW", message: msg, severity: "warning", timestamp: new Date().toISOString() });
          if (this.enableSpokenAlerts) await windowsSpeechDaemon.speak(msg);
        }
      }

      // 2. Check System Memory Pressure (8 GB host limit)
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const ramPercent = ((totalMem - freeMem) / totalMem) * 100;
      if (ramPercent > 85.0) {
        this.isLoadShedding = true;
        if (now - this.lastMemoryWarningAt > 10 * 60 * 1000) { // Throttle 10 min
          this.lastMemoryWarningAt = now;
          const msg = `System memory pressure elevated at ${ramPercent.toFixed(1)} percent. Background tasks throttled.`;
          alerts.push({ type: "MEMORY_PRESSURE", message: msg, severity: "warning", timestamp: new Date().toISOString() });
          if (this.enableSpokenAlerts) await windowsSpeechDaemon.speak(msg);
        }
      } else if (ramPercent <= 80.0) {
        this.isLoadShedding = false;
      }

      // 3. Morning Briefing Check (Between 7 AM and 11 AM)
      const currentHour = new Date().getHours();
      if (currentHour >= 7 && currentHour <= 11 && !this.morningBriefingDelivered) {
        this.morningBriefingDelivered = true;
        const briefing = this.productivity.generateDailyBriefing();
        const msg = `Good morning, sir. ${briefing.spokenSummary}`;
        alerts.push({ type: "MORNING_BRIEFING", message: msg, severity: "info", timestamp: new Date().toISOString() });
        if (this.enableSpokenAlerts) await windowsSpeechDaemon.speak(msg);
      }

      // Store alerts
      for (const a of alerts) {
        this.alerts.unshift(a);
      }
      if (this.alerts.length > 50) this.alerts.length = 50;

      return { success: true, alertsGenerated: alerts.length, alerts };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getRecentAlerts() {
    return [...this.alerts];
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      enableSpokenAlerts: this.enableSpokenAlerts,
      morningBriefingDelivered: this.morningBriefingDelivered,
      isLoadShedding: this.isLoadShedding,
      totalAlertsCount: this.alerts.length
    };
  }
}

export const proactiveDaemon = new ProactiveDaemon();
