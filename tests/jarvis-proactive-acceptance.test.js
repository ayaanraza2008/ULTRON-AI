import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { ProactiveCommunicationEngine } from "../system/proactive-communication.js";
import { TelephonyGateway } from "../telephony/telephony-gateway.js";
import { ByoxWatchdogResilience } from "../system/byox-watchdog-resilience.js";
import { ByoxTaskLeaseWorker } from "../core/byox-task-lease-worker.js";
import { ByoxWalKvStore } from "../memory/byox-wal-kvstore.js";
import { WindowsComputerControl } from "../system/computer-control.js";

// ============================================================================
// WORKFLOW A: ULTRON detects simulated important event and sends real notification
// ============================================================================
test("Workflow A: ULTRON detects important event and dispatches real notification", async () => {
  const engine = new ProactiveCommunicationEngine({
    adapterIds: "desktop_adapter,push_adapter"
  });

  let deliveredPayload = null;
  engine.registerAdapter({
    id: "desktop_adapter",
    name: "desktop_adapter",
    emergency: true,
    deliver: async ({ notification }) => {
      deliveredPayload = notification;
      return { delivered: true, status: "DELIVERED", detail: "Desktop toast notification displayed" };
    }
  });

  const event = {
    ownerUserId: "owner_ayaan_001",
    title: "Security Alert: Unusual Access Attempt",
    body: "Suspicious API probe blocked by Cyber Core red-team filter.",
    priority: "HIGH",
    severity: "CRITICAL",
    type: "SECURITY_EVENT"
  };

  const outcome = await engine.sendProactiveAlert(event);

  assert.equal(outcome.status, "DELIVERED");
  assert.equal(outcome.delivered, true);
  assert.ok(deliveredPayload);
  assert.equal(deliveredPayload.title, "Security Alert: Unusual Access Attempt");
  assert.equal(deliveredPayload.priority, "EMERGENCY");

  const history = engine.getDispatchHistory(10);
  assert.ok(history.length >= 1);
  assert.equal(history[0].notification.title, "Security Alert: Unusual Access Attempt");
});

// ============================================================================
// WORKFLOW B: ULTRON completes background task while UI closed and reports result
// ============================================================================
test("Workflow B: ULTRON completes headless background task and persists durable result", () => {
  const testStorageDir = path.join(process.cwd(), ".tmp-headless-task-test");
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }

  const worker = new ByoxTaskLeaseWorker({ leaseDurationMs: 5000 });
  const durableStore = new ByoxWalKvStore({ storageDir: testStorageDir });

  // 1. Enqueue task (simulating background trigger when UI is closed)
  const { taskId, task } = worker.enqueueTask({
    action: "HEADLESS_SYSTEM_AUDIT",
    parameters: { targetScope: "workspace_integrity", runId: "headless_42" }
  }, { priority: 5, idempotencyKey: "audit_headless_42" });

  assert.equal(task.status, "PENDING");

  // 2. Background daemon leases and processes task
  const leased = worker.acquireLease("daemon_worker_pid_8192");
  assert.ok(leased);
  assert.equal(leased.id, taskId);

  // 3. Execution logic completes without UI
  const auditResult = {
    verifiedFiles: 386,
    errorsFound: 0,
    diskSpaceFreeMb: 42500,
    timestamp: Date.now()
  };

  const comp = worker.completeTask(taskId, "daemon_worker_pid_8192", auditResult);
  assert.equal(comp.success, true);

  // 4. Persist durable record to WAL store
  durableStore.set(`task_result_${taskId}`, {
    taskId,
    status: "COMPLETED",
    result: auditResult,
    completedAt: Date.now()
  });

  // Verify persistence
  const persisted = durableStore.get(`task_result_${taskId}`);
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.equal(persisted.result.verifiedFiles, 386);

  fs.rmSync(testStorageDir, { recursive: true, force: true });
});

// ============================================================================
// WORKFLOW C: ULTRON detects a failed service and performs authorized recovery
// ============================================================================
test("Workflow C: Watchdog detects stalled service and performs authorized recovery", async () => {
  const watchdog = new ByoxWatchdogResilience();
  let restartInvoked = false;
  let restartedServiceName = null;

  watchdog.registerService("voice_sapi_daemon", 200, async (serviceName) => {
    restartInvoked = true;
    restartedServiceName = serviceName;
  });

  // Send normal heartbeat
  watchdog.sendHeartbeat("voice_sapi_daemon");
  assert.equal(watchdog.stats.heartbeatsReceived, 1);

  // Advance time past timeout (simulating hung service)
  const simulatedTime = Date.now() + 500;
  const alerts = await watchdog.checkServices(simulatedTime);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].service, "voice_sapi_daemon");
  assert.equal(alerts[0].status, "STALLED");

  assert.equal(restartInvoked, true);
  assert.equal(restartedServiceName, "voice_sapi_daemon");
  assert.equal(watchdog.stats.restartsTriggered, 1);

  const report = watchdog.getHealthReport();
  assert.equal(report.services[0].status, "RESTARTED");
});

// ============================================================================
// WORKFLOW D: ULTRON initiates approved test call using verified test number
// ============================================================================
test("Workflow D: Telephony gateway enforces strict consent, allowlist, and initiates approved call", () => {
  const telephony = new TelephonyGateway({ ownerCallerId: "+15550001111" });
  const ownerId = "owner_ayaan_001";
  const verifiedTestNumber = "+15559876543";

  // 1. Attempt call without consent -> BLOCKED
  const unconsented = telephony.placeCall({
    ownerUserId: ownerId,
    to: verifiedTestNumber,
    reason: "Proactive security verification"
  });
  assert.equal(unconsented.success, false);
  assert.equal(unconsented.blocked, true);
  assert.equal(unconsented.reason, "OUTBOUND_CALL_CONSENT_REQUIRED");

  // 2. Authorize outbound calling for owner and destination
  telephony.authorizeOutboundCalling(ownerId, {
    enabled: true,
    phoneNumbers: [verifiedTestNumber],
    allowEmergency: true
  });

  // 3. Attempt unapproved destination -> BLOCKED
  const unauthorizedTarget = telephony.placeCall({
    ownerUserId: ownerId,
    to: "+15550009999",
    reason: "Test call"
  });
  assert.equal(unauthorizedTarget.success, false);
  assert.equal(unauthorizedTarget.reason, "OUTBOUND_CALL_TARGET_NOT_AUTHORIZED");

  // 4. Place approved call to verified test number -> SUCCEEDS
  const approvedCall = telephony.placeCall({
    ownerUserId: ownerId,
    to: verifiedTestNumber,
    reason: "Proactive hardware vitals alert"
  });

  assert.equal(approvedCall.success, true);
  assert.equal(approvedCall.blocked, false);
  assert.equal(approvedCall.direction, "OUTBOUND");
  assert.equal(approvedCall.state, "RINGING");
  assert.equal(approvedCall.to, verifiedTestNumber);
  assert.ok(approvedCall.callId.startsWith("call-"));
});

// ============================================================================
// WORKFLOW E: Multi-step goal execution across multiple agents without intervention
// ============================================================================
test("Workflow E: Autonomous multi-step goal execution across specialized agents", () => {
  const queue = new ByoxTaskLeaseWorker();

  // High level goal: System Maintenance & Audit Pipeline
  // Decomposed into 3 subtasks with dependency tracking
  const subtask1 = queue.enqueueTask({
    step: 1,
    agent: "DIAGNOSTIC_AGENT",
    action: "READ_VITALS"
  }, { priority: 10 });

  const subtask2 = queue.enqueueTask({
    step: 2,
    agent: "SECURITY_AGENT",
    action: "VERIFY_INTEGRITY",
    parentTraceId: subtask1.task.traceContext.traceId
  }, { priority: 9 });

  const subtask3 = queue.enqueueTask({
    step: 3,
    agent: "REPORTING_AGENT",
    action: "SUMMARIZE_AND_NOTIFY",
    parentTraceId: subtask1.task.traceContext.traceId
  }, { priority: 8 });

  // Autonomous worker pool processes the DAG
  const workerId = "orchestrator_daemon_01";

  // Step 1: Diagnostics
  const lease1 = queue.acquireLease(workerId);
  assert.equal(lease1.payload.agent, "DIAGNOSTIC_AGENT");
  queue.completeTask(lease1.id, workerId, { cpuTemp: "42C", ramUsedMb: 245 });

  // Step 2: Security Verification
  const lease2 = queue.acquireLease(workerId);
  assert.equal(lease2.payload.agent, "SECURITY_AGENT");
  queue.completeTask(lease2.id, workerId, { signatureIntegrity: "VERIFIED_OK" });

  // Step 3: Reporting
  const lease3 = queue.acquireLease(workerId);
  assert.equal(lease3.payload.agent, "REPORTING_AGENT");
  queue.completeTask(lease3.id, workerId, { reportSent: true });

  // All 3 subtasks complete
  assert.equal(queue.getTask(subtask1.taskId).status, "COMPLETED");
  assert.equal(queue.getTask(subtask2.taskId).status, "COMPLETED");
  assert.equal(queue.getTask(subtask3.taskId).status, "COMPLETED");
});

// ============================================================================
// WORKFLOW F: Quiet hours, permissions, and emergency stop enforcement
// ============================================================================
test("Workflow F: Quiet hours policy, emergency bypass, and emergency stop enforcement", async () => {
  // 1. Quiet Hours Enforcement
  const engine = new ProactiveCommunicationEngine({
    adapterIds: "desktop_adapter",
    policyLoader: () => ({
      quietHours: {
        enabled: true,
        startHHMM: "22:00",
        endHHMM: "08:00",
        allowUrgent: true
      }
    }),
    clock: () => {
      const d = new Date();
      d.setHours(23, 30, 0, 0); // 23:30 (Quiet hours active)
      return d;
    }
  });

  engine.registerAdapter({
    id: "desktop_adapter",
    name: "desktop_adapter",
    emergency: true,
    deliver: async () => ({ delivered: true, status: "DELIVERED" })
  });

  // Routine notification during quiet hours -> DEFERRED
  const deferredOutcome = await engine.dispatch({
    ownerUserId: "owner_01",
    title: "Routine Daily Tip",
    body: "Remember to drink water.",
    priority: "NORMAL"
  });
  assert.equal(deferredOutcome.status, "DEFERRED");
  assert.equal(deferredOutcome.windowDecision.reason, "QUIET_HOURS_ACTIVE");

  // Critical/Emergency notification during quiet hours -> BYPASSES quiet hours
  const emergencyOutcome = await engine.dispatch({
    ownerUserId: "owner_01",
    title: "Critical Server Outage",
    body: "Database failover in progress.",
    priority: "URGENT",
    severity: "CRITICAL"
  });
  assert.equal(emergencyOutcome.status, "DELIVERED");
  assert.equal(emergencyOutcome.windowDecision.urgentBypass, true);

  // 2. Emergency Stop on Computer Control
  const computerControl = new WindowsComputerControl();
  computerControl.setEmergencyStop(true);

  await assert.rejects(
    async () => {
      await computerControl.runApprovedCommand("whoami");
    },
    /Computer control is halted under Emergency Stop/
  );
});
