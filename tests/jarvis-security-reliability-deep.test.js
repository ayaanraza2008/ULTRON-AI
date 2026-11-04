import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import express from "express";
import { createServer } from "node:http";
import { TelephonyGateway, CALL_LIFECYCLE_TIERS, CALL_STATES } from "../telephony/telephony-gateway.js";
import { ProactiveCommunicationEngine } from "../system/proactive-communication.js";
import { ByoxTaskLeaseWorker } from "../core/byox-task-lease-worker.js";
import { ByoxWalKvStore } from "../memory/byox-wal-kvstore.js";
import { WindowsComputerControl } from "../system/computer-control.js";
import { createJarvisRouter } from "../jarvis-router.js";

// Helper for spinning up test server for HTTP authentication tests
async function withTestServer({ env = {}, mockUser = null, ownerUserId = "owner_ayaan_001" } = {}, callback) {
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

// ----------------------------------------------------------------------------
// 1. Telephony consent and destination allowlisting
// ----------------------------------------------------------------------------
test("Security & Reliability 1: Telephony consent and destination allowlisting", () => {
  const telephony = new TelephonyGateway({ ownerCallerId: "+15551112222" });
  const ownerId = "owner_ayaan_001";
  const targetA = "+15551234567";
  const targetB = "+15559876543";

  // Attempt without consent
  const unconsented = telephony.placeCall({ ownerUserId: ownerId, to: targetA, reason: "Probe" });
  assert.equal(unconsented.success, false);
  assert.equal(unconsented.blocked, true);
  assert.equal(unconsented.reason, "OUTBOUND_CALL_CONSENT_REQUIRED");

  // Grant consent for targetA only
  telephony.authorizeOutboundCalling(ownerId, { enabled: true, phoneNumbers: [targetA], allowEmergency: false });

  // Call targetA -> Allowed
  const callA = telephony.placeCall({ ownerUserId: ownerId, to: targetA, reason: "Authorized call" });
  assert.equal(callA.success, true);
  assert.equal(callA.tier, CALL_LIFECYCLE_TIERS.RINGING);

  // Call targetB -> Blocked (unauthorized destination)
  const callB = telephony.placeCall({ ownerUserId: ownerId, to: targetB, reason: "Unauthorized target" });
  assert.equal(callB.success, false);
  assert.equal(callB.reason, "OUTBOUND_CALL_TARGET_NOT_AUTHORIZED");

  // Emergency call without emergency opt-in -> Blocked
  const emergencyCall = telephony.placeCall({ ownerUserId: ownerId, to: targetA, type: "EMERGENCY" });
  assert.equal(emergencyCall.success, false);
  assert.equal(emergencyCall.reason, "OUTBOUND_CALL_EMERGENCY_CONSENT_REQUIRED");

  // Revoke consent
  telephony.authorizeOutboundCalling(ownerId, { enabled: false, phoneNumbers: [] });
  const callAfterRevoke = telephony.placeCall({ ownerUserId: ownerId, to: targetA, reason: "After revoke" });
  assert.equal(callAfterRevoke.success, false);
  assert.equal(callAfterRevoke.reason, "OUTBOUND_CALL_CONSENT_REQUIRED");
});

// ----------------------------------------------------------------------------
// 2. Call rate-limit bypass and concurrent call attempts
// ----------------------------------------------------------------------------
test("Security & Reliability 2: Call rate-limit enforcement and concurrent call attempts", () => {
  const telephony = new TelephonyGateway({
    maxCallsPerWindow: 3,
    rateLimitWindowMs: 60000
  });
  const ownerId = "owner_ayaan_001";
  const target = "+15551112222";

  telephony.authorizeOutboundCalling(ownerId, {
    enabled: true,
    phoneNumbers: [target],
    allowEmergency: true
  });

  // Rapidly place 3 allowed calls
  const res1 = telephony.placeCall({ ownerUserId: ownerId, to: target, reason: "Call 1" });
  const res2 = telephony.placeCall({ ownerUserId: ownerId, to: target, reason: "Call 2" });
  const res3 = telephony.placeCall({ ownerUserId: ownerId, to: target, reason: "Call 3" });
  assert.equal(res1.success, true);
  assert.equal(res2.success, true);
  assert.equal(res3.success, true);

  // 4th call exceeds limit -> Rate limited
  const res4 = telephony.placeCall({ ownerUserId: ownerId, to: target, reason: "Call 4" });
  assert.equal(res4.success, false);
  assert.equal(res4.blocked, true);
  assert.equal(res4.reason, "OUTBOUND_CALL_RATE_LIMIT_EXCEEDED");

  // EMERGENCY call bypasses non-emergency rate limit
  const emergencyRes = telephony.placeCall({ ownerUserId: ownerId, to: target, type: "EMERGENCY" });
  assert.equal(emergencyRes.success, true, "Emergency call must bypass rate limit");
});

// ----------------------------------------------------------------------------
// 3. Duplicate notification races and emergency handling
// ----------------------------------------------------------------------------
test("Security & Reliability 3: Concurrent duplicate notification deduplication & emergency bypass", async () => {
  const engine = new ProactiveCommunicationEngine({
    duplicateCooldownMs: 5000
  });

  let deliveryCount = 0;
  engine.registerAdapter({
    id: "race_test_adapter",
    emergency: true,
    deliver: async () => {
      deliveryCount++;
      return { delivered: true, status: "DELIVERED" };
    }
  });

  const alertPayload = {
    ownerUserId: "owner_ayaan_001",
    title: "Sensor Overheat",
    body: "Core temperature reached 92C.",
    priority: "HIGH",
    channelIds: ["race_test_adapter"]
  };

  // Concurrent dispatch race: both dispatches initiated simultaneously
  const [outcome1, outcome2] = await Promise.all([
    engine.dispatch(alertPayload),
    engine.dispatch(alertPayload)
  ]);

  // Exactly one must be delivered, and one must be suppressed
  const outcomes = [outcome1.status, outcome2.status].sort();
  assert.deepEqual(outcomes, ["DELIVERED", "SUPPRESSED"]);
  assert.equal(deliveryCount, 1, "Only one physical delivery should occur during concurrent duplicate dispatch");

  // Concurrent EMERGENCY alerts must BOTH deliver
  const emergencyPayload = {
    ...alertPayload,
    priority: "EMERGENCY",
    severity: "EMERGENCY"
  };
  const [em1, em2] = await Promise.all([
    engine.dispatch(emergencyPayload),
    engine.dispatch(emergencyPayload)
  ]);
  assert.equal(em1.status, "DELIVERED");
  assert.equal(em2.status, "DELIVERED");
  assert.equal(deliveryCount, 3, "Both emergency alerts must be delivered");
});

// ----------------------------------------------------------------------------
// 4. Task dependency cycles and missing prerequisites
// ----------------------------------------------------------------------------
test("Security & Reliability 4: Task dependency resolution and missing prerequisites", () => {
  const queue = new ByoxTaskLeaseWorker();

  // Task A has no dependencies
  const taskA = queue.enqueueTask({ name: "Step A" }, { priority: 1 });
  // Task B depends on Task A
  const taskB = queue.enqueueTask({ name: "Step B" }, { priority: 10, dependencies: [taskA.taskId] });
  // Task C depends on a non-existent task ID (unfulfillable prerequisite)
  const taskC = queue.enqueueTask({ name: "Step C" }, { priority: 20, dependencies: ["non_existent_task_999"] });

  // Worker attempts to acquire lease. Despite Task B and Task C having higher priority (10 & 20),
  // they cannot be leased because their dependencies are not yet completed. Task A should be leased.
  const lease1 = queue.acquireLease("worker_1");
  assert.ok(lease1);
  assert.equal(lease1.id, taskA.taskId, "Task A must be leased first because Task B and C prerequisites are unmet");

  // Worker completes Task A
  queue.completeTask(taskA.taskId, "worker_1", { result: "A_DONE" });

  // Now Task B's dependency is met. It should be leased next.
  const lease2 = queue.acquireLease("worker_1");
  assert.ok(lease2);
  assert.equal(lease2.id, taskB.taskId, "Task B must be leased once Task A is completed");

  queue.completeTask(taskB.taskId, "worker_1", { result: "B_DONE" });

  // Task C still has an unfulfillable dependency. It must never be leased.
  const lease3 = queue.acquireLease("worker_1");
  assert.equal(lease3, null, "Task with missing dependency must never be leased");
});

// ----------------------------------------------------------------------------
// 5. Concurrent lease acquisition and expired leases
// ----------------------------------------------------------------------------
test("Security & Reliability 5: Concurrent lease acquisition and lease expiration reclamation", async () => {
  const queue = new ByoxTaskLeaseWorker({ leaseDurationMs: 40 });
  const { taskId } = queue.enqueueTask({ name: "Heavy Job" });

  // Worker 1 acquires the lease
  const lease1 = queue.acquireLease("worker_1");
  assert.ok(lease1);
  assert.equal(lease1.id, taskId);

  // Worker 2 attempts concurrent acquisition while lease is active
  const lease2 = queue.acquireLease("worker_2");
  assert.equal(lease2, null, "Worker 2 cannot lease an actively running task");

  // Wait for Worker 1's lease to expire
  await new Promise(resolve => setTimeout(resolve, 60));

  // Worker 2 now acquires the expired lease
  const lease3 = queue.acquireLease("worker_2");
  assert.ok(lease3, "Worker 2 must reclaim the expired lease");
  assert.equal(lease3.id, taskId);
  assert.equal(lease3.leaseWorkerId, "worker_2");

  // Worker 1 attempts to heartbeat on its stale lease -> Worker mismatch
  const heartbeat = queue.renewLease(taskId, "worker_1");
  assert.equal(heartbeat.success, false);
  assert.equal(heartbeat.reason, "WORKER_MISMATCH");
});

// ----------------------------------------------------------------------------
// 6. Task cancellation during active execution
// ----------------------------------------------------------------------------
test("Security & Reliability 6: Task cancellation during active execution prevents completion", () => {
  const queue = new ByoxTaskLeaseWorker({ leaseDurationMs: 5000 });
  const { taskId } = queue.enqueueTask({ name: "Cancellable Job" });

  const leased = queue.acquireLease("worker_1");
  assert.ok(leased);
  assert.equal(leased.status, "RUNNING");

  // In-flight cancellation
  const cancelled = queue.cancelTask(taskId, "SECURITY_ABORT");
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.status, "CANCELLED");

  // Worker attempts to heartbeat on cancelled task -> Rejected
  const heartbeat = queue.renewLease(taskId, "worker_1");
  assert.equal(heartbeat.success, false);
  assert.equal(heartbeat.reason, "TASK_CANCELLED");

  // Worker attempts to complete cancelled task -> Rejected
  const completion = queue.completeTask(taskId, "worker_1", { result: "Malicious payload" });
  assert.equal(completion.success, false);
  assert.equal(completion.reason, "TASK_CANCELLED");

  // Verify task status remains CANCELLED
  const taskState = queue.getTask(taskId);
  assert.equal(taskState.status, "CANCELLED");
});

// ----------------------------------------------------------------------------
// 7. WAL corruption, interrupted writes, and restart recovery
// ----------------------------------------------------------------------------
test("Security & Reliability 7: WAL resilience against corrupted or truncated lines", () => {
  const testDir = path.join(process.cwd(), ".tmp-wal-deep-test");
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  try {
    // 1. Write clean items to WAL
    const store1 = new ByoxWalKvStore({ storageDir: testDir });
    store1.set("key_alpha", { value: 100 });
    store1.set("key_beta", { value: 200 });

    // 2. Artificially append corrupted / truncated bytes to the active WAL file
    const walFile = path.join(testDir, "current.wal");
    fs.appendFileSync(walFile, "\n{\"incomplete_json\": true, truncated\n", "utf8");

    // 3. New store instance starts up and recovers from disk
    const store2 = new ByoxWalKvStore({ storageDir: testDir });
    assert.deepEqual(store2.get("key_alpha"), { value: 100 });
    assert.deepEqual(store2.get("key_beta"), { value: 200 });

    // New writes continue cleanly after recovery
    store2.set("key_gamma", { value: 300 });
    assert.deepEqual(store2.get("key_gamma"), { value: 300 });
  } finally {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// 8. Cross-tenant access and unauthorized API requests
// ----------------------------------------------------------------------------
test("Security & Reliability 8: Cross-tenant isolation & unauthenticated API rejections", async () => {
  const ownerId = "owner_ayaan_001";
  const crossTenantUser = { id: "user_tenant_hacker_77", email: "hacker@evil.org" };

  // 1. Unauthenticated request -> 401
  await withTestServer({ mockUser: null, ownerUserId: ownerId }, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/jarvis/agents`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  // 2. Cross-tenant authenticated request -> 403
  await withTestServer({ mockUser: crossTenantUser, ownerUserId: ownerId }, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/jarvis/agents`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "ULTRON_OWNER_ONLY");
  });
});

// ----------------------------------------------------------------------------
// 9. Emergency stop during active computer-control operations
// ----------------------------------------------------------------------------
test("Security & Reliability 9: Emergency stop immediately halts computer control operations", async () => {
  const control = new WindowsComputerControl();

  // Under normal conditions, emergency stop is inactive
  assert.equal(control.isEmergencyStopped(), false);

  // Trigger emergency halt
  control.setEmergencyStop(true);
  assert.equal(control.isEmergencyStopped(), true);

  // All execution operations must immediately fail closed
  await assert.rejects(
    async () => control.launchApplication("calc"),
    /Computer control is halted under Emergency Stop/
  );

  await assert.rejects(
    async () => control.runApprovedCommand("whoami"),
    /Computer control is halted under Emergency Stop/
  );
});
