import test from "node:test";
import assert from "node:assert/strict";
import {
  NayaAutonomousAgent,
  NAYA_AUTONOMY_LEVELS,
  TASK_STATUS
} from "../intelligence/naya/naya-agent.js";

test("NAYA Autonomous Agent: Autonomy levels enforcement (0 to 4)", () => {
  const agent = new NayaAutonomousAgent({ autonomyLevel: NAYA_AUTONOMY_LEVELS.LEVEL_3_INDEPENDENT });
  assert.equal(agent.getAutonomyLevel(), 3);

  agent.setAutonomyLevel(0);
  assert.equal(agent.getAutonomyLevel(), 0);

  const resInvalid = agent.setAutonomyLevel(99);
  assert.equal(resInvalid.success, false);
});

test("NAYA Autonomous Agent: Level 0 blocks tool execution and preserves conversation only", async () => {
  const agent = new NayaAutonomousAgent({ autonomyLevel: NAYA_AUTONOMY_LEVELS.LEVEL_0_CONVERSATION });

  const outcome = await agent.executeGoal("Check system battery vitals");
  assert.equal(outcome.success, true);
  assert.equal(outcome.autonomyLevel, 0);
  assert.ok(outcome.textResponse.includes("Conversation Mode"));
  assert.equal(outcome.evidence.length, 0, "No tools may execute in Level 0");
});

test("NAYA Autonomous Agent: Level 1 generates structured DAG plan without executing tools", async () => {
  const agent = new NayaAutonomousAgent({ autonomyLevel: NAYA_AUTONOMY_LEVELS.LEVEL_1_SUGGESTION });

  const outcome = await agent.executeGoal("Check system vitals and search files");
  assert.equal(outcome.success, true);
  assert.equal(outcome.autonomyLevel, 1);
  assert.ok(Array.isArray(outcome.plan));
  assert.ok(outcome.plan.length >= 1);
  assert.equal(outcome.evidence.length, 0, "Tools must not execute in Level 1 planning mode");
});

test("NAYA Autonomous Agent: DAG Cycle Detection prevents infinite loops", () => {
  const agent = new NayaAutonomousAgent();

  const acyclicSteps = [
    { id: "A", dependsOn: [] },
    { id: "B", dependsOn: ["A"] },
    { id: "C", dependsOn: ["B"] }
  ];
  assert.equal(agent.detectCycles(acyclicSteps), false, "Valid DAG must have 0 cycles");

  const cyclicSteps = [
    { id: "A", dependsOn: ["C"] },
    { id: "B", dependsOn: ["A"] },
    { id: "C", dependsOn: ["B"] }
  ];
  assert.equal(agent.detectCycles(cyclicSteps), true, "Cycle A -> B -> C -> A must be detected");
});

test("NAYA Autonomous Agent: Single-use approval tokens enforce replay protection and expiry", () => {
  const agent = new NayaAutonomousAgent();

  const step = { id: "step_lock", toolId: "windows_lock_workstation", params: {} };
  const approval = agent.createApprovalRequest(step, "test_owner");
  assert.ok(approval.token);
  assert.equal(approval.consumed, false);

  // 1. Consume token with matching step and user
  const consume1 = agent.consumeApproval(approval.token, "step_lock", "test_owner");
  assert.equal(consume1.success, true);
  assert.equal(consume1.record.consumed, true);

  // 2. Replay attack with already-consumed token must fail
  const replayAttempt = agent.consumeApproval(approval.token, "step_lock", "test_owner");
  assert.equal(replayAttempt.success, false);
  assert.equal(replayAttempt.error, "TOKEN_ALREADY_CONSUMED");

  // 3. User mismatch must fail
  const approval2 = agent.createApprovalRequest(step, "test_owner");
  const mismatchUser = agent.consumeApproval(approval2.token, "step_lock", "attacker_user");
  assert.equal(mismatchUser.success, false);
  assert.equal(mismatchUser.error, "TOKEN_MISMATCH");
});

test("NAYA Autonomous Agent: Emergency kill-switch halts execution and invalidates pending tokens", () => {
  const agent = new NayaAutonomousAgent();

  const step = { id: "step_1", toolId: "test_tool", params: {} };
  const req = agent.createApprovalRequest(step, "test_owner");

  // Activate emergency halt
  agent.setEmergencyHalt(true);
  assert.equal(agent.emergencyHalted, true);

  // Token must be invalidated
  const attempt = agent.consumeApproval(req.token, "step_1", "test_owner");
  assert.equal(attempt.success, false);

  // Reset emergency halt
  agent.setEmergencyHalt(false);
  assert.equal(agent.emergencyHalted, false);
});

test("NAYA Autonomous Agent: Verified multi-step task execution with evidence capture", async () => {
  const agent = new NayaAutonomousAgent({ autonomyLevel: NAYA_AUTONOMY_LEVELS.LEVEL_3_INDEPENDENT });

  const outcome = await agent.executeGoal("Check system vitals", { userId: "test_owner" });
  assert.equal(outcome.success, true);
  assert.equal(outcome.status, TASK_STATUS.COMPLETED);
  assert.equal(outcome.verified, true);
  assert.ok(outcome.stepsExecuted >= 1);
  assert.ok(outcome.evidence.length >= 1, "Must contain verified evidence");
  assert.equal(outcome.evidence[0].toolId, "windows_pc_vitals");
});
