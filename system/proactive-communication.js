/**
 * ULTRON AI — Proactive Communication Engine
 *
 * Routes proactive events / owner alerts through pluggable delivery adapters
 * under the owner-controlled quiet-hours policy, with explicit emergency
 * handling and an auditable dispatch ledger.
 *
 * Invariants:
 * - Quiet hours are enforced through system/notification-policy (fail-open).
 * - EMERGENCY severity is treated as an urgent, bypass-eligible priority and
 *   requires an emergency-capable delivery channel; otherwise dispatch is
 *   BLOCKED (never silently delivered or dropped).
 * - Deferred deliveries are explicit outcomes (DEFERRED + QUIET_HOURS_ACTIVE).
 * - Missing adapters produce honest NOT_DISPATCHED outcomes; adapters themselves
 *   decide DELIVERED vs DELIVERY_FAILED.
 * - Check-ins and event subscriptions keep proactive behavior auditable.
 */

import { evaluateNotificationWindow, loadNotificationPolicy, NOTIFICATION_PRIORITIES } from "./notification-policy.js";

const EMERGENCY_SEVERITIES = new Set(["EMERGENCY", "CRITICAL"]);

function normalizeSeverity(value) {
  const key = String(value || "NORMAL").toUpperCase();
  if (EMERGENCY_SEVERITIES.has(key)) return key;
  return key === "NORMAL" ? "NORMAL" : "NORMAL";
}

function newNotificationId() {
  return "notif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
}

function isEmergencyPriority(priority) {
  const key = String(priority || "NORMAL").toUpperCase();
  return key === "EMERGENCY" || key === "CRITICAL";
}

export class ProactiveCommunicationEngine {
  constructor(options = {}) {
    this.deviceHub = options.deviceHub || null;
    this.env = options.env || process.env;
    this.policyLoader = options.policyLoader || loadNotificationPolicy;
    this.adapters = new Map();
    this.checkIns = new Map();
    this.dispatchHistory = [];
    this.maxDispatchHistory = 200;
    this.eventHandlers = new Map();
    this.clock = options.clock || (() => new Date());
    this.outboundTelephony = options.outboundTelephony || null;
    this.emergencyContacts = new Map();
    this.duplicateCooldownMs = options.duplicateCooldownMs ?? 5000;
    this.recentDispatches = new Map();
    const envChannels = String(options.adapterIds || this.env.ULTRON_NOTIFICATION_ADAPTERS || "");
    this.defaultAdapterIds = envChannels.split(",").map(s => s.trim()).filter(Boolean);
  }

  registerAdapter(adapter) {
    if (!adapter || typeof adapter.id !== "string") return this;
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  getAdapter(adapterId) {
    return this.adapters.get(adapterId) || null;
  }

  listAdapterIds() {
    return Array.from(this.adapters.keys());
  }

  setEmergencyContacts(ownerUserId, contacts = []) {
    const ownerKey = String(ownerUserId || "default-owner");
    const normalized = new Set(
      (Array.isArray(contacts) ? contacts : [])
        .map(c => String(c || "").replace(/[^0-9+]/g, "").trim())
        .filter(c => c)
    );
    this.emergencyContacts.set(ownerKey, normalized);
    return { success: true, ownerUserId: ownerKey, emergencyContacts: Array.from(normalized) };
  }

  getEmergencyContacts(ownerUserId) {
    const ownerKey = String(ownerUserId || "default-owner");
    const set = this.emergencyContacts.get(ownerKey) || new Set();
    return { ownerUserId: ownerKey, emergencyContacts: Array.from(set) };
  }

  onEvent(eventType, handler) {
    const key = String(eventType || "UNKNOWN");
    if (!this.eventHandlers.has(key)) this.eventHandlers.set(key, new Set());
    const set = this.eventHandlers.get(key);
    set.add(handler);
    return () => { set.delete(handler); };
  }

  async emitEvent(event) {
    const key = String((event && event.type) || "UNKNOWN");
    const handlers = this.eventHandlers.get(key);
    if (!handlers) return false;
    const normalized = { ...(event || {}), type: key, timestamp: new Date().toISOString() };
    let handled = false;
    for (const handler of Array.from(handlers)) {
      let result;
      try {
        result = await handler(normalized);
      } catch {
        result = false;
      }
      if (result !== false) handled = true;
    }
    return handled;
  }

  registerVoiceCallAdapter(outboundTelephony) {
    const telephony = outboundTelephony || this.outboundTelephony;
    if (!telephony) return this;
    this.registerAdapter({
      id: "voice_call",
      name: "voice_call",
      emergency: true,
      deliver: async ({ notification, context }) => {
        const call = telephony.placeCall({
          ownerUserId: notification.ownerUserId,
          to: context && context.to ? context.to : notification.context?.to,
          reason: notification.title,
          context: { sourceType: notification.type, severity: notification.severity, alertId: notification.id },
          type: isEmergencyPriority(notification.severity) ? "EMERGENCY" : "PROACTIVE"
        });
        const delivered = Boolean(call && call.success && !call.blocked);
        return {
          delivered,
          status: delivered ? "DELIVERED" : (call && call.reason) || "VOICE_CALL_BLOCKED",
          detail: delivered ? `OUTBOUND_CALL_${call.callId}` : `VOICE_CALL_BLOCKED:${call && call.reason ? call.reason : "UNKNOWN"}`,
          callId: call ? call.callId : null
        };
      }
    });
    return this;
  }

  async dispatch({ ownerUserId, deviceId = null, title, body, priority = "NORMAL", type = "PROACTIVE_ALERT", severity = "NORMAL", emergency = false, channelIds = null, context = {} } = {}) {
    const normalizedSeverity = normalizeSeverity(severity);
    const isEmergency = Boolean(emergency) || isEmergencyPriority(normalizedSeverity) || isEmergencyPriority(priority);
    const effectivePriority = isEmergency ? "EMERGENCY" : priority;

    const notification = {
      id: newNotificationId(),
      ownerUserId: ownerUserId || null,
      targetDeviceId: deviceId || "broadcast",
      title: String(title || "").slice(0, 120),
      body: String(body || "").slice(0, 500),
      priority: effectivePriority,
      severity: normalizedSeverity,
      type: String(type || "PROACTIVE_ALERT"),
      context: context || {},
      timestamp: new Date().toISOString(),
      delivered: false,
      deliveryStatus: "NOT_DISPATCHED"
    };

    // Deduplication check: Suppress identical non-emergency notifications within cooldown window
    const dedupeKey = `${ownerUserId || "broadcast"}:${String(title || "").trim()}:${String(body || "").trim()}`;
    const now = Date.now();
    const lastDispatchedAt = this.recentDispatches.get(dedupeKey);
    if (!isEmergency && lastDispatchedAt && (now - lastDispatchedAt < this.duplicateCooldownMs)) {
      return {
        status: "SUPPRESSED",
        reason: "DUPLICATE_NOTIFICATION_COOLDOWN",
        suppressed: true,
        notification,
        deliveries: [],
        windowDecision: { allowed: true, policyActive: false, reason: "DUPLICATE_SUPPRESSED" },
        effectivePriority,
        isEmergency
      };
    }
    this.recentDispatches.set(dedupeKey, now);
    if (this.recentDispatches.size > 500) {
      for (const [k, ts] of this.recentDispatches.entries()) {
        if (now - ts > this.duplicateCooldownMs * 2) this.recentDispatches.delete(k);
      }
    }

    const channelIdsToUse = Array.isArray(channelIds)
      ? channelIds
      : (Array.isArray(this.defaultAdapterIds) && this.defaultAdapterIds.length > 0
          ? this.defaultAdapterIds
          : Array.from(this.adapters.keys()));
    const adaptersToUse = channelIdsToUse.map(id => this.adapters.get(id)).filter(Boolean);

    if (isEmergency) {
      const emergencyAdapter = adaptersToUse.find(a => a && (a.emergency === true || a.supportsEmergency === true || (Array.isArray(a.capabilities) && a.capabilities.includes("emergency"))));
      if (!emergencyAdapter) {
        return {
          status: "BLOCKED",
          reason: "EMERGENCY_CHANNEL_REQUIRED",
          notification,
          deliveries: [],
          windowDecision: { allowed: true, policyActive: false, emergencyGate: true },
          effectivePriority,
          isEmergency
        };
      }
    }

    const policy = this.policyLoader(this.env);
    const windowDecision = evaluateNotificationWindow({ policy, at: this.clock(), priority: effectivePriority });

    if (!windowDecision.allowed) {
      return {
        status: "DEFERRED",
        reason: windowDecision.reason,
        notification,
        deliveries: [],
        windowDecision,
        effectivePriority,
        isEmergency
      };
    }

    if (adaptersToUse.length === 0) {
      return { status: "NOT_DISPATCHED", reason: "NO_ADAPTERS_CONFIGURED", notification, deliveries: [], windowDecision, effectivePriority, isEmergency };
    }

    const deliveries = [];
    for (const adapter of adaptersToUse) {
      let outcome;
      try {
        outcome = await adapter.deliver({ notification, context: { ownerUserId, deviceId, windowDecision, isEmergency, severity: normalizedSeverity } });
      } catch (err) {
        deliveries.push({ adapterId: adapter.id, delivered: false, status: "ADAPTER_ERROR", detail: err && err.message });
        continue;
      }
      const delivered = Boolean(outcome && outcome.delivered);
      deliveries.push({
        adapterId: adapter.id,
        delivered,
        status: outcome && outcome.status ? outcome.status : delivered ? "DELIVERED" : "DELIVERY_FAILED",
        detail: outcome && outcome.detail
      });
      if (delivered) {
        notification.delivered = true;
        notification.deliveryStatus = "DELIVERED";
      }
    }

    const deliveredAny = deliveries.some(d => d.delivered);
    notification.deliveryStatus = deliveredAny ? "DELIVERED" : "DELIVERY_FAILED";

    const dispatchRecord = {
      dispatchId: notification.id,
      ownerUserId: notification.ownerUserId,
      notification,
      deliveries,
      windowDecision,
      dispatchedAt: new Date().toISOString(),
      status: deliveredAny ? "DELIVERED" : "DELIVERY_FAILED"
    };
    this.dispatchHistory.unshift(dispatchRecord);
    if (this.dispatchHistory.length > this.maxDispatchHistory) this.dispatchHistory.pop();

    let inboxNotification = notification;
    try {
      if (this.deviceHub && typeof this.deviceHub.sendNotification === "function") {
        inboxNotification = this.deviceHub.sendNotification({ ownerUserId, deviceId, title, body, priority: effectivePriority, type });
      }
    } catch { /* dispatch ledger remains authoritative */ }

    return {
      status: deliveredAny ? "DELIVERED" : "DELIVERY_FAILED",
      notification,
      inboxNotification,
      deliveries,
      windowDecision,
      effectivePriority,
      delivered: deliveredAny,
      isEmergency
    };
  }

  async sendProactiveAlert(event = {}) {
    const notification = {
      ownerUserId: event.ownerUserId || null,
      deviceId: event.deviceId || null,
      title: event.title || event.summary || "Proactive alert",
      body: event.body || event.message || event.summary || "",
      priority: event.priority || "NORMAL",
      type: event.type || "PROACTIVE_ALERT",
      severity: event.severity || "NORMAL"
    };
    return this.dispatch({
      ownerUserId: notification.ownerUserId,
      deviceId: notification.deviceId,
      title: notification.title,
      body: notification.body,
      priority: notification.priority,
      type: notification.type,
      severity: notification.severity,
      emergency: event.emergency === true
    });
  }

  scheduleCheckIn({ ownerUserId, deliverAt, title, body, priority = "NORMAL", type = "SCHEDULED_CHECK_IN", channelId = null } = {}) {
    const id = "checkin-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const record = {
      id,
      ownerUserId: String(ownerUserId || "default-owner"),
      deliverAt: new Date(deliverAt),
      title: String(title || ""),
      body: String(body || ""),
      priority,
      type,
      channelId: channelId || null,
      status: "SCHEDULED",
      createdAt: new Date().toISOString(),
      notified: false
    };
    this.checkIns.set(id, record);
    return { success: true, checkIn: { ...record, deliverAt: record.deliverAt.toISOString() } };
  }

  cancelCheckIn(checkInId) {
    const existed = this.checkIns.delete(checkInId);
    return { success: true, cancelled: existed, checkInId };
  }

  async processDueCheckIns(at = this.clock()) {
    const now = new Date(at);
    const due = Array.from(this.checkIns.values()).filter(c => c.status === "SCHEDULED" && new Date(c.deliverAt) <= now);
    const results = [];
    for (const checkIn of due) {
      const outcome = await this.dispatch({
        ownerUserId: checkIn.ownerUserId,
        title: checkIn.title,
        body: checkIn.body,
        priority: checkIn.priority,
        type: checkIn.type,
        channelIds: checkIn.channelId ? [checkIn.channelId] : null
      });
      checkIn.status = outcome.status;
      checkIn.notified = true;
      checkIn.lastOutcome = outcome.status;
      checkIn.lastDispatchedAt = new Date().toISOString();
      results.push({ checkInId: checkIn.id, status: outcome.status });
    }
    return { success: true, processed: results.length, results };
  }

  getDispatchHistory(limit = 50) {
    return this.dispatchHistory.slice(0, Math.max(0, Math.min(200, Number(limit) || 50)));
  }
}

export const proactiveCommunicationEngine = new ProactiveCommunicationEngine();
