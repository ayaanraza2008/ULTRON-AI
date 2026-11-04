import test from "node:test";
import assert from "node:assert/strict";
import { ProactiveCommunicationEngine } from "../system/proactive-communication.js";

function createEngine({ env = {}, adapters = [] } = {}) {
  const engine = new ProactiveCommunicationEngine({ env });
  for (const adapter of adapters) engine.registerAdapter(adapter);
  return engine;
}

function quietEnv(enabled = true, startHHMM = "23:00", endHHMM = "07:00", allowUrgent = true) {
  return {
    ULTRON_NOTIFICATION_POLICY_JSON: JSON.stringify({
      quietHours: { enabled, startHHMM, endHHMM, allowUrgent }
    })
  };
}

const deliveredAdapter = {
  id: "test_adapter",
  deliver: async ({ notification }) => ({ delivered: true, status: "DELIVERED", detail: "OK" })
};

const emergencyVoiceAdapter = {
  id: "emergency_voice",
  emergency: true,
  deliver: async ({ notification }) => ({ delivered: true, status: "DELIVERED", detail: "OUTBOUND_CALL_call-x", callId: "call-x" })
};

test("ProactiveCommunicationEngine: dispatch delivers through a registered adapter and records delivery", async () => {
  const engine = createEngine({ adapters: [deliveredAdapter] });
  const outcome = await engine.dispatch({ ownerUserId: "owner-user", title: "Task complete", body: "Synthesis finished", priority: "NORMAL", type: "TASK_COMPLETED" });
  assert.equal(outcome.status, "DELIVERED");
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.notification.deliveryStatus, "DELIVERED");
  assert.equal(outcome.deliveries.length, 1);
  assert.equal(outcome.deliveries[0].delivered, true);
  assert.equal(engine.getDispatchHistory(10).length, 1);
});

test("ProactiveCommunicationEngine: dispatch without adapters is an honest NOT_DISPATCHED", async () => {
  const engine = createEngine({ adapters: [] });
  const outcome = await engine.dispatch({ ownerUserId: "owner-user", title: "T", body: "B" });
  assert.equal(outcome.status, "NOT_DISPATCHED");
  assert.equal(outcome.notification.deliveryStatus, "NOT_DISPATCHED");
});

test("ProactiveCommunicationEngine: quiet hours defer normal priority; emergency bypasses via emergency channel", async () => {
  const engine = createEngine({
    env: quietEnv(true, "23:00", "07:00", true),
    adapters: [deliveredAdapter, emergencyVoiceAdapter]
  });

  const deferred = await engine.dispatch({ ownerUserId: "owner-user", title: "T", body: "B", priority: "NORMAL" });
  assert.equal(deferred.status, "DEFERRED");
  assert.equal(deferred.windowDecision.allowed, false);
  assert.equal(deferred.windowDecision.reason, "QUIET_HOURS_ACTIVE");

  const emergency = await engine.dispatch({
    ownerUserId: "owner-user",
    title: "Emergency",
    body: "Battery critical",
    priority: "NORMAL",
    severity: "EMERGENCY",
    emergency: true,
    channelIds: ["emergency_voice"]
  });
  assert.equal(emergency.status, "DELIVERED");
  assert.equal(emergency.isEmergency, true);

  const blocked = await engine.dispatch({
    ownerUserId: "owner-user",
    title: "Emergency",
    body: "Critical",
    priority: "NORMAL",
    severity: "EMERGENCY",
    emergency: true,
    channelIds: ["test_adapter"]
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.reason, "EMERGENCY_CHANNEL_REQUIRED");
});

test("ProactiveCommunicationEngine: scheduled check-ins dispatch when due and can be cancelled", async () => {
  const engine = createEngine({ adapters: [deliveredAdapter] });

  const past = new Date(Date.now() - 1000);
  const schedule = engine.scheduleCheckIn({ ownerUserId: "owner-user", deliverAt: past, title: "Check-in", body: "Morning check-in", priority: "NORMAL", type: "SCHEDULED_CHECK_IN" });
  assert.equal(schedule.success, true);

  const processed = await engine.processDueCheckIns(past);
  assert.equal(processed.processed, 1);
  assert.equal(processed.results[0].status, "DELIVERED");

  const cancel = engine.cancelCheckIn(schedule.checkIn.id);
  assert.equal(cancel.cancelled, true);
  const cancelMissing = engine.cancelCheckIn("checkin-does-not-exist");
  assert.equal(cancelMissing.cancelled, false);
});

test("ProactiveCommunicationEngine: event subscriptions receive proactive alerts", async () => {
  const engine = createEngine({ adapters: [deliveredAdapter] });
  let received = null;
  const unsubscribe = engine.onEvent("TASK_COMPLETED", (event) => { received = event; return true; });
  const handled = await engine.emitEvent({ type: "TASK_COMPLETED", title: "Build done" });
  unsubscribe();
  assert.equal(handled, true);
  assert.equal(received.type, "TASK_COMPLETED");
});
