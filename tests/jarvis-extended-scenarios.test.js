import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import express from "express";
import { createServer } from "node:http";
import { ByoxTaskLeaseWorker } from "../core/byox-task-lease-worker.js";
import { ByoxWalKvStore } from "../memory/byox-wal-kvstore.js";
import { ProactiveCommunicationEngine } from "../system/proactive-communication.js";
import { createJarvisRouter } from "../jarvis-router.js";
import { WindowsComputerControl } from "../system/computer-control.js";
import { TelephonyGateway, CALL_LIFECYCLE_TIERS, CALL_STATES } from "../telephony/telephony-gateway.js";

// Helper for spinning up test server for HTTP authentication tests
async function withTestServer({ env = {}, mockUser = null, ownerUserId = "owner-ayaan-001" } = {}, callback) {
  const app = express();
  app.use(express.json());

  const requireSupabaseUser = (req, res, next) => {
    if (!mockUser) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Supabase authentication required." }
      });
    }
    req.supabaseUser = mockUser;
    next();
  };

  const router = createJarvisRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: ownerUserId, ...env },
    requireSupabaseUser,
    supabaseRest: async () => new Response("[]", { status: 200 }),
    logger: { warn() {}, info() {}, error() {} }
  });

  app.use("/api", router);

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await callback(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

// ============================================================================
// WORKFLOW G: Restart ULTRON and recover pending tasks from WAL
// ============================================================================
test("Workflow G: Restart ULTRON and recover pending tasks from WAL", () => {
  const testStorageDir = path.join(process.cwd(), ".tmp-wal-recovery-test");
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }

  try {
    // 1. Initial process lifecycle: Worker enqueues tasks and persists state to WAL
    const walStore1 = new ByoxWalKvStore({ storageDir: testStorageDir });
    const worker1 = new ByoxTaskLeaseWorker({ leaseDurationMs: 5000 });

    const taskA = worker1.enqueueTask({ type: "ANALYZE_SECURITY_LOGS", target: "firewall" }, { priority: 10 });
    const taskB = worker1.enqueueTask({ type: "SYNC_LOCAL_KNOWLEDGE", target: "memory" }, { priority: 5 });

    assert.equal(taskA.status, "ENQUEUED");
    assert.equal(taskB.status, "ENQUEUED");

    // Persist pending tasks snapshot to WAL store
    walStore1.set("task_lease_state", worker1.exportState());

    // 2. Simulate complete process termination / crash
    // walStore1 and worker1 are dropped

    // 3. New process starts up: Re-open WAL store and recover state
    const walStore2 = new ByoxWalKvStore({ storageDir: testStorageDir });
    const recoveredState = walStore2.get("task_lease_state");

    assert.ok(recoveredState, "Recovered state must exist in WAL");
    const worker2 = new ByoxTaskLeaseWorker({ leaseDurationMs: 5000 });
    worker2.importState(recoveredState);

    // Verify tasks are present and ready for leasing
    assert.equal(worker2.tasks.size, 2);
    const candidate = worker2.acquireLease("recovery_daemon_pid_999");
    assert.ok(candidate);
    assert.equal(candidate.id, taskA.taskId);
    assert.equal(candidate.payload.type, "ANALYZE_SECURITY_LOGS");

    // Complete the task in recovered worker
    const completion = worker2.completeTask(candidate.id, "recovery_daemon_pid_999", { status: "CLEAN" });
    assert.equal(completion.success, true);
    assert.equal(worker2.getTask(taskA.taskId).status, "COMPLETED");
  } finally {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  }
});

// ============================================================================
// WORKFLOW H: Kill an isolated worker (missed heartbeats) and verify lease reclamation
// ============================================================================
test("Workflow H: Kill an isolated worker (missed heartbeats) and verify lease reclamation", async () => {
  // Use a very short lease duration for testing: 30ms
  const workerPool = new ByoxTaskLeaseWorker({ leaseDurationMs: 30 });

  const { taskId } = workerPool.enqueueTask({
    action: "TRANSCODE_AUDIO_STREAM",
    bitrate: "128kbps"
  }, { priority: 1 });

  // 1. Worker 1 leases the task
  const lease1 = workerPool.acquireLease("worker_alpha_pid_101");
  assert.ok(lease1);
  assert.equal(lease1.id, taskId);
  assert.equal(lease1.leaseWorkerId, "worker_alpha_pid_101");

  // While Worker 1 holds the lease, another worker cannot steal it immediately
  const prematureLease = workerPool.acquireLease("worker_beta_pid_102");
  assert.equal(prematureLease, null, "Should not lease an active task before expiration");

  // 2. Simulate Worker 1 crashing / dying (it misses its heartbeat and lease expires)
  await new Promise(resolve => setTimeout(resolve, 50));

  // 3. Worker 2 detects expired lease, automatically reclaims it
  const lease2 = workerPool.acquireLease("worker_beta_pid_102");
  assert.ok(lease2, "Worker 2 must successfully reclaim the expired lease");
  assert.equal(lease2.id, taskId);
  assert.equal(lease2.leaseWorkerId, "worker_beta_pid_102");
  assert.ok(workerPool.stats.reclaimed >= 1, "Stats must record lease reclamation");

  // 4. Worker 2 successfully finishes the job
  const result = workerPool.completeTask(taskId, "worker_beta_pid_102", { transcodedBytes: 1048576 });
  assert.equal(result.success, true);
  assert.equal(workerPool.getTask(taskId).status, "COMPLETED");
});

// ============================================================================
// WORKFLOW I: Simulate notification adapter failure and verify DELIVERY_FAILED
// ============================================================================
test("Workflow I: Simulate notification adapter failure and verify DELIVERY_FAILED without fake success", async () => {
  const engine = new ProactiveCommunicationEngine({
    adapterIds: "failing_push_adapter"
  });

  // Register adapter that throws an unexpected upstream network error
  engine.registerAdapter({
    id: "failing_push_adapter",
    name: "failing_push_adapter",
    deliver: async () => {
      throw new Error("HTTP 502 Bad Gateway: Push Gateway service down");
    }
  });

  const outcome = await engine.dispatch({
    ownerUserId: "owner_ayaan_001",
    title: "Backup Complete",
    body: "Database snapshot successfully written to offsite storage.",
    priority: "NORMAL",
    channelIds: ["failing_push_adapter"]
  });

  // Must honestly report failure without fabricating a delivery
  assert.equal(outcome.status, "DELIVERY_FAILED");
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.notification.delivered, false);
  assert.equal(outcome.notification.deliveryStatus, "DELIVERY_FAILED");
  assert.equal(outcome.deliveries.length, 1);
  assert.equal(outcome.deliveries[0].status, "ADAPTER_ERROR");
  assert.match(outcome.deliveries[0].detail, /Push Gateway service down/);
});

// ============================================================================
// WORKFLOW J: Verify duplicate notification suppression within cooldown window
// ============================================================================
test("Workflow J: Verify duplicate notification suppression within cooldown window", async () => {
  const engine = new ProactiveCommunicationEngine({
    duplicateCooldownMs: 2000
  });

  let deliveryCount = 0;
  engine.registerAdapter({
    id: "test_desktop",
    name: "test_desktop",
    emergency: true,
    deliver: async () => {
      deliveryCount++;
      return { delivered: true, status: "DELIVERED" };
    }
  });

  const alertPayload = {
    ownerUserId: "owner_ayaan_001",
    title: "High Disk Usage Warning",
    body: "Volume C: has reached 91% capacity.",
    priority: "HIGH",
    channelIds: ["test_desktop"]
  };

  // 1. First dispatch: Should be delivered
  const first = await engine.dispatch(alertPayload);
  assert.equal(first.status, "DELIVERED");
  assert.equal(first.delivered, true);
  assert.equal(deliveryCount, 1);

  // 2. Immediate duplicate dispatch: Should be suppressed
  const second = await engine.dispatch(alertPayload);
  assert.equal(second.status, "SUPPRESSED");
  assert.equal(second.suppressed, true);
  assert.equal(second.reason, "DUPLICATE_NOTIFICATION_COOLDOWN");
  assert.equal(deliveryCount, 1, "Adapter delivery count must not increase for suppressed alert");

  // 3. EMERGENCY alert with same content: Must bypass deduplication
  const emergencyBypass = await engine.dispatch({
    ...alertPayload,
    priority: "EMERGENCY",
    severity: "EMERGENCY"
  });
  assert.equal(emergencyBypass.status, "DELIVERED");
  assert.equal(emergencyBypass.delivered, true);
  assert.equal(deliveryCount, 2, "Emergency alert must bypass suppression window");
});

// ============================================================================
// WORKFLOW K: Verify unauthorized API requests return 401
// ============================================================================
test("Workflow K: Verify unauthorized API requests return 401", async () => {
  // Server without authenticated user (mockUser = null)
  await withTestServer({ mockUser: null, ownerUserId: "owner_ayaan_001" }, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/jarvis/agents`);
    assert.equal(res.status, 401, "Unauthenticated request must return 401");
    const data = await res.json();
    assert.equal(data.error.code, "UNAUTHORIZED");
  });
});

// ============================================================================
// WORKFLOW L: Verify owner identity isolation (cross-tenant 403)
// ============================================================================
test("Workflow L: Verify owner identity isolation (cross-tenant 403)", async () => {
  // Authenticated user is 'attacker_user_999', while owner is 'owner_ayaan_001'
  await withTestServer({
    mockUser: { id: "attacker_user_999", email: "attacker@test.com" },
    ownerUserId: "owner_ayaan_001"
  }, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/jarvis/agents`);
    assert.equal(res.status, 403, "Non-owner authenticated caller must be rejected with 403");
    const data = await res.json();
    assert.equal(data.error.code, "ULTRON_OWNER_ONLY");
  });
});

// ============================================================================
// WORKFLOW M: Verify task cancellation and computer control emergency stop
// ============================================================================
test("Workflow M: Verify task cancellation and computer control emergency stop", async () => {
  // 1. Task Queue Cancellation
  const worker = new ByoxTaskLeaseWorker();
  const { taskId } = worker.enqueueTask({ action: "RUN_LONG_SCRIPT", script: "heavy.ps1" });

  const cancelResult = worker.cancelTask(taskId, "USER_EMERGENCY_STOP");
  assert.equal(cancelResult.success, true);
  assert.equal(cancelResult.status, "CANCELLED");

  // Attempting to acquire lease should find no available tasks
  const candidate = worker.acquireLease("worker_01");
  assert.equal(candidate, null, "Cancelled task must never be leased");

  // 2. Windows Computer Control Emergency Stop
  const control = new WindowsComputerControl();

  // Verify normal state
  assert.equal(control.isEmergencyStopped(), false);

  // Trigger emergency halt
  control.setEmergencyStop(true);
  assert.equal(control.isEmergencyStopped(), true);

  // Subsequent control actions must immediately fail closed
  await assert.rejects(
    async () => control.launchApplication("notepad"),
    /Computer control is halted under Emergency Stop/
  );
});

// ============================================================================
// WORKFLOW N: Verify task results survive process crash and restart
// ============================================================================
test("Workflow N: Verify task results survive process crash and restart", () => {
  const testStorageDir = path.join(process.cwd(), ".tmp-durability-test");
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }

  try {
    // Phase 1: Complete task and write result to WAL store
    const store1 = new ByoxWalKvStore({ storageDir: testStorageDir });
    const taskId = "task_durable_verification_777";
    const taskResultData = {
      taskId,
      status: "COMPLETED",
      output: {
        analyzedFiles: 1420,
        anomaliesDetected: 0,
        sha256Digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      },
      completedAt: 1730000000000
    };

    store1.set(`task_result:${taskId}`, taskResultData);

    // Phase 2: Simulate process crash/restart by instantiating new store on same disk path
    const store2 = new ByoxWalKvStore({ storageDir: testStorageDir });
    const recoveredResult = store2.get(`task_result:${taskId}`);

    assert.ok(recoveredResult, "Recovered result must exist in store");
    assert.equal(recoveredResult.taskId, taskId);
    assert.equal(recoveredResult.status, "COMPLETED");
    assert.deepEqual(recoveredResult.output, taskResultData.output);
  } finally {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  }
});

// ============================================================================
// VERIFICATION BONUS: Telephony lifecycle tiers, rate limits, and consent audit
// ============================================================================
test("Telephony Gateway: Enforces lifecycle tiers, call rate-limiting, and consent audit trail", () => {
  const telephony = new TelephonyGateway({
    ownerCallerId: "+15551112222",
    maxCallsPerWindow: 2,
    rateLimitWindowMs: 60000
  });

  const ownerId = "owner_ayaan_001";
  const verifiedTarget = "+15553334444";

  // 1. Consent audit logging
  telephony.authorizeOutboundCalling(ownerId, {
    enabled: true,
    phoneNumbers: [verifiedTarget],
    allowEmergency: true
  });

  const consentLogs = telephony.getConsentAuditLog();
  assert.equal(consentLogs.length, 1);
  assert.equal(consentLogs[0].action, "GRANT_CONSENT");
  assert.equal(consentLogs[0].ownerUserId, ownerId);

  // 2. Call 1: Initiated -> RINGING
  const call1 = telephony.placeCall({ ownerUserId: ownerId, to: verifiedTarget, reason: "Call 1" });
  assert.equal(call1.success, true);
  assert.equal(call1.state, CALL_STATES.RINGING);
  assert.equal(call1.tier, CALL_LIFECYCLE_TIERS.RINGING);

  // 3. Lifecycle progression: answerCall -> CONNECTED
  const answered = telephony.answerCall(call1.callId);
  assert.equal(answered.success, true);
  assert.equal(answered.state, CALL_STATES.CONNECTED);
  assert.equal(answered.tier, CALL_LIFECYCLE_TIERS.CONNECTED);

  // 4. Lifecycle termination: endCall -> COMPLETED
  const ended = telephony.endCall(call1.callId, "CALLER_DISCONNECTED");
  assert.equal(ended.success, true);
  assert.equal(ended.state, CALL_STATES.COMPLETED);
  assert.equal(ended.tier, CALL_LIFECYCLE_TIERS.COMPLETED);

  // 5. Call 2: Within rate limit
  const call2 = telephony.placeCall({ ownerUserId: ownerId, to: verifiedTarget, reason: "Call 2" });
  assert.equal(call2.success, true);

  // 6. Call 3: Exceeds maxCallsPerWindow (2) -> RATE_LIMIT_EXCEEDED
  const call3 = telephony.placeCall({ ownerUserId: ownerId, to: verifiedTarget, reason: "Call 3" });
  assert.equal(call3.success, false);
  assert.equal(call3.blocked, true);
  assert.equal(call3.reason, "OUTBOUND_CALL_RATE_LIMIT_EXCEEDED");
});
