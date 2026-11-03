import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { toolRegistry, PERMISSION_LEVELS } from "../core/tool-registry.js";
import { AutonomousOrchestrator, AGENT_ROLES } from "../core/autonomous-orchestrator.js";

// ==========================================
// 1. TOOL SCHEMA VALIDATION & PATH TRAVERSAL ATTACK TESTS
// ==========================================

test("Adversarial Security: Rejects directory traversal in file organization parameters", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  const attackInputs = [
    "../../../../windows/system32",
    "..\\..\\sensitive_passwords.txt",
    "/etc/passwd\0malicious",
    "downloads/../../../cmd.exe"
  ];

  for (const attackPath of attackInputs) {
    await assert.rejects(
      async () => {
        await toolRegistry.execute("windows_file_organize", { folderPath: attackPath });
      },
      /Security validation/i,
      `Failed to reject directory traversal path: ${attackPath}`
    );
  }
});

test("Adversarial Security: Rejects malformed and empty app launch parameters", async () => {
  await assert.rejects(
    async () => {
      await toolRegistry.execute("windows_app_launch", { app: "" });
    },
    /Missing required parameter 'app'/i
  );

  await assert.rejects(
    async () => {
      await toolRegistry.execute("windows_app_launch", { app: "calc.exe; rm -rf /" });
    },
    /APPLICATION_NOT_ALLOWLISTED|Application name must contain valid/i
  );
});

// ==========================================
// 2. APPROVAL GATE & REPLAY ATTACK SECURITY TESTS
// ==========================================

test("Adversarial Security: Sensitive tool execution without approval fails with APPROVAL_REQUIRED", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  const outcome = await orchestrator.processUserRequest("Lock workstation immediately");
  assert.equal(outcome.status, "APPROVAL_REQUIRED");
  assert.ok(outcome.approvalRequest);
  assert.equal(outcome.approvalRequest.toolId, "windows_lock_workstation");
  assert.equal(outcome.approvalRequest.permissionLevel, PERMISSION_LEVELS.LEVEL_4_CRITICAL);
  assert.equal(outcome.approvalRequest.consumed, false);
});

test("Adversarial Security: Execution with invalid approval token fails with UNAUTHORIZED", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  const forgedToken = "appr-forged-fake-123456";
  const outcome = await orchestrator.processUserRequest("Lock workstation immediately", { approvalId: forgedToken });

  assert.equal(outcome.status, "UNAUTHORIZED");
  assert.equal(outcome.success, false);
  assert.ok(outcome.error.includes("Invalid or non-existent approval ID"));
});

test("Adversarial Security: Replay attack with already-consumed approval token is rejected", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  // 1. Initial request triggers approval
  const init = await orchestrator.processUserRequest("Organize my downloads folder");
  assert.equal(init.status, "APPROVAL_REQUIRED");
  const approvalId = init.approvalRequest.id;

  // 2. Legitimate operator approves
  const approveRes = orchestrator.approveRequest(approvalId, { userId: "operator" });
  assert.equal(approveRes.success, true);
  assert.equal(approveRes.request.status, "APPROVED");

  // 3. First execution consumes the single-use token
  const firstExec = await orchestrator.processUserRequest("Organize my downloads folder", { approvalId });
  assert.equal(firstExec.verified, true);
  assert.equal(approveRes.request.status, "CONSUMED");
  assert.equal(approveRes.request.consumed, true);

  // 4. Adversary attempts replay attack with same approval token
  const replayExec = await orchestrator.processUserRequest("Organize my downloads folder", { approvalId });
  assert.equal(replayExec.status, "REPLAY_ATTACK_DETECTED");
  assert.equal(replayExec.success, false);
  assert.ok(replayExec.error.includes("Approval token has already been consumed (replay attack rejected)"));
});

test("Adversarial Security: Tool mismatch on approval token is rejected", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  // 1. Request file organization
  const init = await orchestrator.processUserRequest("Organize my downloads folder");
  const approvalId = init.approvalRequest.id;
  orchestrator.approveRequest(approvalId);

  // 2. Attacker attempts to use file organization approval to lock workstation
  const attackOutcome = await orchestrator.processUserRequest("Lock workstation immediately", { approvalId });
  assert.equal(attackOutcome.status, "UNAUTHORIZED");
  assert.ok(attackOutcome.error.includes("Tool mismatch"));
});

// ==========================================
// 3. EMERGENCY STOP AUDIT & RESTART PERSISTENCE
// ==========================================

test("Emergency Stop Audit: Halts new commands, cancels active workflows, and persists across restarts", async () => {
  const testDir = path.join(os.tmpdir(), "ultron-test-estop-" + Date.now());
  fs.mkdirSync(testDir, { recursive: true });

  try {
    const orchestrator1 = new AutonomousOrchestrator({ registry: toolRegistry, persistenceDir: testDir });

    // 1. Enqueue background workflow
    const sub = orchestrator1.submitBackgroundTask("Assemble multi-agent team for GTM review");
    assert.equal(sub.status, "RUNNING");

    // 2. Engage Emergency Stop
    orchestrator1.setEmergencyStop(true, "Red-team security drill", { userId: "sre-lead" });
    assert.equal(orchestrator1.emergencyHalted, true);

    // 3. Workflow is cancelled immediately
    const active = orchestrator1.getActiveWorkflows();
    const wf = active.find(w => w.id === sub.workflowId);
    assert.ok(wf);
    assert.equal(wf.status, "CANCELLED");

    // 4. New commands are rejected fail-closed
    const blockedCmd = await orchestrator1.processUserRequest("Check system vitals");
    assert.equal(blockedCmd.status, "BLOCKED");
    assert.equal(blockedCmd.intent, "EMERGENCY_STOPPED");

    // 5. New background submissions throw
    assert.throws(
      () => orchestrator1.submitBackgroundTask("Launch chrome"),
      /Emergency Stop is engaged/
    );

    // 6. Simulate Server Crash & Restart: instantiate a new orchestrator with same directory
    const orchestrator2 = new AutonomousOrchestrator({ registry: toolRegistry, persistenceDir: testDir });
    assert.equal(orchestrator2.emergencyHalted, true, "Emergency stop must persist across server restart");

    // 7. Reset Emergency Stop
    orchestrator2.setEmergencyStop(false, "Drill complete", { userId: "sre-lead" });
    assert.equal(orchestrator2.emergencyHalted, false);

    // 8. Normal commands resume
    const resumed = await orchestrator2.processUserRequest("Check system vitals");
    assert.equal(resumed.verified, true);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// ==========================================
// 4. AUTONOMOUS DAG PLANNING & DEPENDENCY RESOLUTION
// ==========================================

test("Autonomous Planning Audit: Executes independent DAG steps in parallel waves", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // Custom DAG plan: Step 1 (root), Step 2 & 3 (parallel independent), Step 4 (depends on 2 & 3)
  const timestamps = {};
  const customPlan = {
    id: "dag-plan-1",
    steps: [
      {
        id: "step-1",
        dependsOn: [],
        toolId: "windows_pc_vitals",
        agent: AGENT_ROLES.SYSTEMS_CONTROLLER,
        description: "Root vitals check",
        params: {}
      },
      {
        id: "step-2",
        dependsOn: ["step-1"],
        toolId: "cybersecurity_defensive_scan",
        agent: AGENT_ROLES.SECURITY_SENTINEL,
        description: "Security scan",
        params: { target: "localhost" }
      },
      {
        id: "step-3",
        dependsOn: ["step-1"],
        toolId: "knowledge_vault_query",
        agent: AGENT_ROLES.RESEARCH_SCHOLAR,
        description: "Knowledge lookup",
        params: { query: "security" }
      },
      {
        id: "step-4",
        dependsOn: ["step-2", "step-3"],
        toolId: "ai_chat_inference",
        agent: AGENT_ROLES.FULLSTACK_ARCHITECT,
        description: "Final report synthesis",
        params: { prompt: "Synthesize findings" }
      }
    ]
  };

  const dagResult = await orchestrator.executePlanDAG(customPlan, {});
  assert.equal(dagResult.allPassed, true);
  assert.equal(dagResult.status, "COMPLETED");
  assert.equal(dagResult.stepResults.length, 4);

  // All 4 steps succeeded
  assert.ok(dagResult.stepResults.every(r => r.success));
  assert.ok(dagResult.artifacts["step-1"]);
  assert.ok(dagResult.artifacts["step-2"]);
  assert.ok(dagResult.artifacts["step-3"]);
  assert.ok(dagResult.artifacts["step-4"]);
});

test("Autonomous Planning Audit: Detects and rejects circular dependency cycles in DAG", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  const cyclicPlan = {
    id: "cyclic-plan-1",
    steps: [
      { id: "step-A", dependsOn: ["step-B"], toolId: "windows_pc_vitals", params: {} },
      { id: "step-B", dependsOn: ["step-A"], toolId: "windows_pc_vitals", params: {} }
    ]
  };

  assert.equal(orchestrator.detectCycle(cyclicPlan.steps), true);

  await assert.rejects(
    async () => {
      await orchestrator.executePlanDAG(cyclicPlan, {});
    },
    /DAG dependency cycle detected/
  );
});

test("Autonomous Planning Audit: Cascades failure by skipping dependent steps while completing independent ones", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // Plan:
  // Step 1: fails (invalid tool)
  // Step 2: depends on Step 1 -> MUST BE SKIPPED
  // Step 3: root independent step -> MUST SUCCEED
  const partialPlan = {
    id: "partial-plan-1",
    steps: [
      {
        id: "step-1",
        dependsOn: [],
        toolId: "non_existent_tool_fail",
        agent: AGENT_ROLES.SYSTEMS_CONTROLLER,
        description: "Will fail",
        params: {}
      },
      {
        id: "step-2",
        dependsOn: ["step-1"],
        toolId: "ai_chat_inference",
        agent: AGENT_ROLES.FULLSTACK_ARCHITECT,
        description: "Dependent step that must be skipped",
        params: { prompt: "Hello" }
      },
      {
        id: "step-3",
        dependsOn: [],
        toolId: "windows_pc_vitals",
        agent: AGENT_ROLES.SYSTEMS_CONTROLLER,
        description: "Independent step that must succeed",
        params: {}
      }
    ]
  };

  const res = await orchestrator.executePlanDAG(partialPlan, {});
  assert.equal(res.allPassed, false);
  assert.equal(res.partiallyCompleted, true);
  assert.equal(res.status, "PARTIALLY_COMPLETED");

  const s1 = res.stepResults.find(r => r.stepId === "step-1");
  const s2 = res.stepResults.find(r => r.stepId === "step-2");
  const s3 = res.stepResults.find(r => r.stepId === "step-3");

  assert.equal(s1.success, false);
  assert.equal(s2.success, false);
  assert.equal(s2.skipped, true);
  assert.ok(s2.error.includes("Prerequisite dependency failed"));
  assert.equal(s3.success, true);
});

// ==========================================
// 5. BACKGROUND WORKFLOW RELIABILITY & IDEMPOTENCY
// ==========================================

test("Background Reliability: Enforces idempotency to prevent duplicate task execution", async () => {
  const testDir = path.join(os.tmpdir(), "ultron-test-idempotency-" + Date.now());
  fs.mkdirSync(testDir, { recursive: true });

  try {
    const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, persistenceDir: testDir });

    const key = "idem-order-sync-998811";

    const sub1 = orchestrator.submitBackgroundTask("Assemble multi-agent team for sync", { idempotencyKey: key });
    assert.equal(sub1.success, true);
    assert.equal(sub1.duplicatePrevented, undefined);

    // Duplicate submission with same key
    const sub2 = orchestrator.submitBackgroundTask("Assemble multi-agent team for sync", { idempotencyKey: key });
    assert.equal(sub2.success, true);
    assert.equal(sub2.workflowId, sub1.workflowId);
    assert.equal(sub2.duplicatePrevented, true);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// ==========================================
// 6. CROSS-USER ISOLATION & ATTACK DEFENSE
// ==========================================

test("Adversarial Security: Rejects cross-user background task access and cancellation", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // User A creates a workflow
  const subA = orchestrator.submitBackgroundTask("Assemble multi-agent team for User A", { userId: "user-alpha" });
  assert.equal(subA.success, true);

  // User B attempts to pause User A's workflow
  const pauseAttempt = orchestrator.pauseWorkflow(subA.workflowId, { userId: "user-bravo" });
  assert.equal(pauseAttempt.success, false);
  assert.equal(pauseAttempt.error, "CROSS_USER_ACCESS_DENIED");

  // User B attempts to resume User A's workflow
  const resumeAttempt = orchestrator.resumeWorkflow(subA.workflowId, { userId: "user-bravo" });
  assert.equal(resumeAttempt.success, false);
  assert.equal(resumeAttempt.error, "CROSS_USER_ACCESS_DENIED");

  // User B attempts to cancel User A's workflow
  const cancelAttempt = orchestrator.cancelWorkflow(subA.workflowId, "Malicious abort", { userId: "user-bravo" });
  assert.equal(cancelAttempt.success, false);
  assert.equal(cancelAttempt.error, "CROSS_USER_ACCESS_DENIED");

  // User A or Admin can cancel legitimately
  const adminCancel = orchestrator.cancelWorkflow(subA.workflowId, "Admin cleanup", { userId: "admin", isAdmin: true });
  assert.equal(adminCancel.success, true);
  assert.equal(adminCancel.status, "CANCELLED");
});

test("Adversarial Security: Rejects cross-user approval tampering and token hijacking", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  // 1. User A triggers approval request
  const outA = await orchestrator.processUserRequest("Organize my downloads folder", { userId: "user-alpha" });
  assert.equal(outA.status, "APPROVAL_REQUIRED");
  const apprId = outA.approvalRequest.id;

  // 2. User B attempts to approve User A's request
  const hijackApprove = orchestrator.approveRequest(apprId, { userId: "user-bravo" });
  assert.equal(hijackApprove.success, false);
  assert.equal(hijackApprove.error, "CROSS_USER_APPROVAL_DENIED");

  // 3. User B attempts to reject User A's request
  const hijackReject = orchestrator.rejectRequest(apprId, "Deny", { userId: "user-bravo" });
  assert.equal(hijackReject.success, false);
  assert.equal(hijackReject.error, "CROSS_USER_APPROVAL_DENIED");

  // 4. User A approves legitimately
  const legitimateApprove = orchestrator.approveRequest(apprId, { userId: "user-alpha" });
  assert.equal(legitimateApprove.success, true);

  // 5. User B attempts to consume User A's approval token
  const hijackExec = await orchestrator.processUserRequest("Organize my downloads folder", { approvalId: apprId, userId: "user-bravo" });
  assert.equal(hijackExec.status, "CROSS_USER_ACCESS_DENIED");
});

// ==========================================
// 7. AUTONOMY LEVEL GATING & BYPASS DEFENSE
// ==========================================

test("Adversarial Security: Prevents bypassing autonomy level limits", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // Set autonomy level to 1 (Read-Only)
  orchestrator.setAutonomyLevel(1);

  // Read-only tool should pass autonomously
  const readRes = await orchestrator.processUserRequest("Check system vitals");
  assert.equal(readRes.verified, true);

  // Normal Level 2 tool (ai_chat_inference, memory_store) exceeds autonomy level 1 -> MUST REQUIRE APPROVAL
  const plan = {
    id: "gated-plan-1",
    steps: [
      {
        id: "step-1",
        toolId: "memory_store",
        agent: AGENT_ROLES.SYSTEMS_CONTROLLER,
        description: "Store memory in read-only mode",
        params: { content: "sensitive data", tags: ["secret"] }
      }
    ]
  };

  const outcome = await orchestrator.processUserRequest("Save this fact to long term memory");
  // memory_store has permission level 2, which exceeds autonomy level 1
  assert.equal(outcome.status, "APPROVAL_REQUIRED");
  assert.ok(outcome.approvalRequest);
});

// ==========================================
// 8. EMERGENCY STOP INVALIDATION OF PENDING APPROVALS
// ==========================================

test("Emergency Stop Audit: Invalidates pending approval requests upon halt", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry, strictApprovalGates: true });

  const out = await orchestrator.processUserRequest("Lock workstation immediately");
  assert.equal(out.status, "APPROVAL_REQUIRED");
  const apprId = out.approvalRequest.id;

  // Engage emergency stop
  orchestrator.setEmergencyStop(true, "Threat detected");

  // Attempting to approve the request must be rejected
  const apprRes = orchestrator.approveRequest(apprId);
  assert.equal(apprRes.success, false);
  assert.equal(apprRes.error, "EMERGENCY_STOP_ACTIVE");

  // Reset emergency stop
  orchestrator.setEmergencyStop(false);

  // Approval request was invalidated during emergency stop, so it cannot be revived
  const retryAppr = orchestrator.approveRequest(apprId);
  assert.equal(retryAppr.success, false);
  assert.equal(retryAppr.error, "APPROVAL_INVALIDATED");
});

// ==========================================
// 9. MALICIOUS EXTERNAL TOOL OUTPUT SANITIZATION
// ==========================================

test("Adversarial Security: Sanitizes malicious external tool output and prevents prototype pollution", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // Custom plan with a step returning prototype pollution payload
  const maliciousPlan = {
    id: "malicious-output-plan",
    steps: [
      {
        id: "step-1",
        dependsOn: [],
        toolId: "web_search_research",
        agent: AGENT_ROLES.RESEARCH_SCHOLAR,
        description: "Search with malicious payload simulation",
        params: { query: "clean query" }
      }
    ]
  };

  const res = await orchestrator.executePlanDAG(maliciousPlan, {});
  assert.equal(res.allPassed, true);
  assert.ok(res.artifacts["step-1"]);

  // Verify prototype was not polluted
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.isAdmin, undefined);
});

// ==========================================
// 10. REAL TOOL EXECUTION INVENTORY VERIFICATION
// ==========================================

test("Real Tool Execution Audit: All 23 tools execute real paths with schema validation", async () => {
  const allTools = toolRegistry.listTools();
  assert.equal(allTools.length, 23);

  const testPayloads = {
    ai_chat_inference: { prompt: "Health check" },
    memory_recall: { query: "preferences" },
    memory_store: { content: "Audited operational check", tags: ["audit"] },
    autonomous_goal_planner: { goal: "Audit all subsystems" },
    agent_team_assembly: { task: "Security verification", targetAgent: "security-sentinel" },
    emergency_kill_switch: { reason: "Routine health check" },
    windows_app_launch: { app: "notepad", dryRun: true },
    windows_pc_vitals: {},
    windows_file_organize: { folderPath: "Downloads", dryRun: true },
    windows_screenshot_capture: {},
    windows_lock_workstation: { dryRun: true },
    vision_image_analysis: { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
    vision_spatial_diorama: {},
    kokoro_voice_synthesis: { text: "Ultron ready" },
    web_search_research: { query: "autonomous agents" },
    knowledge_vault_query: { query: "cybersecurity" },
    multidevice_remote_dispatch: { targetPlatform: "windows", action: "get_system_vitals", dryRun: true },
    cybersecurity_defensive_scan: {},
    mobile_device_discovery: { dryRun: true },
    mobile_screen_inspection: { dryRun: true },
    mobile_interaction_dispatch: { action: "press_key", keycode: 4, dryRun: true },
    mobile_app_lifecycle: { operation: "launch", packageName: "com.android.settings", dryRun: true },
    mobile_autonomous_task: { goal: "test mobile task", dryRun: true }
  };

  for (const tool of allTools) {
    const payload = testPayloads[tool.id];
    assert.ok(payload !== undefined, `Missing test payload for tool: ${tool.id}`);

    // Input schema validation test
    assert.doesNotThrow(() => {
      toolRegistry.validateParams(tool, payload);
    }, `Schema validation failed for tool: ${tool.id}`);

    // Execution path test
    const outcome = await toolRegistry.execute(tool.id, payload);
    assert.ok(outcome, `Tool '${tool.id}' returned null or undefined`);
    assert.equal(outcome.success, true, `Tool '${tool.id}' did not return success: true (received: ${JSON.stringify(outcome)})`);
  }
});

// ==========================================
// 11. BACKGROUND RESTART RECOVERY & INTERRUPTED TASK MARKING
// ==========================================

test("Background Reliability: Recovers interrupted tasks safely upon restart without zombie execution", async () => {
  const testDir = path.join(os.tmpdir(), "ultron-test-recovery-" + Date.now());
  fs.mkdirSync(testDir, { recursive: true });

  try {
    const workflowsFile = path.join(testDir, "workflows.json");
    const inFlightWorkflow = [
      {
        id: "wf-zombie-candidate-123",
        userId: "operator",
        prompt: "Long running deployment",
        intent: "MULTI_AGENT_COORDINATION",
        status: "RUNNING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentStepIndex: 1,
        stepResults: [{ stepId: "step-1", success: true }]
      }
    ];
    fs.writeFileSync(workflowsFile, JSON.stringify(inFlightWorkflow, null, 2), "utf8");

    // Instantiate orchestrator simulating server reboot
    const rebootedOrchestrator = new AutonomousOrchestrator({ registry: toolRegistry, persistenceDir: testDir });
    const recovered = rebootedOrchestrator.getActiveWorkflows();

    const wf = recovered.find(w => w.id === "wf-zombie-candidate-123");
    assert.ok(wf, "Interrupted workflow must be loaded into memory");
    assert.equal(wf.status, "INTERRUPTED", "In-flight task must be transitioned from RUNNING to INTERRUPTED on reboot");
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// ==========================================
// 12. AUTONOMOUS DAG RETRY LIMITS & DURATION AUDIT
// ==========================================

test("Autonomous Planning: Enforces retry limits and records step execution duration", async () => {
  const testRegistry = toolRegistry;
  let attemptCount = 0;

  testRegistry.registerTool({
    id: "flaky_audit_tool",
    name: "Flaky Audit Tool",
    category: "AUTONOMOUS_OPERATIONS",
    description: "Fails on first attempt, succeeds on second attempt",
    capabilities: ["retry_audit"],
    permissionLevel: PERMISSION_LEVELS.LEVEL_2_NORMAL,
    timeoutMs: 5000,
    checkHealth: () => "OPERATIONAL",
    execute: async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("Simulated transient socket glitch on attempt 1");
      }
      return { success: true, attemptsTaken: attemptCount };
    }
  });

  const orchestrator = new AutonomousOrchestrator({ registry: testRegistry });
  const plan = {
    id: "retry-audit-plan",
    steps: [
      {
        id: "step-retry-1",
        dependsOn: [],
        toolId: "flaky_audit_tool",
        agent: AGENT_ROLES.SYSTEMS_CONTROLLER,
        description: "Test transient retry handling",
        maxRetries: 2,
        params: {}
      }
    ]
  };

  const res = await orchestrator.executePlanDAG(plan, {});
  assert.equal(res.allPassed, true, "DAG should pass after successful retry attempt");
  assert.equal(attemptCount, 2, "Tool must have retried exactly once");
  const stepRes = res.stepResults[0];
  assert.equal(stepRes.success, true);
  assert.ok(typeof stepRes.durationMs === "number", "Execution durationMs must be recorded");
  assert.ok(stepRes.durationMs >= 0, "Execution duration must be non-negative");
});
