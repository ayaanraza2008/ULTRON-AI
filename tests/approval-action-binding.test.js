import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousOrchestrator } from "../core/autonomous-orchestrator.js";
import { ToolRegistry, TOOL_CATEGORIES, PERMISSION_LEVELS } from "../core/tool-registry.js";

function makeFixture() {
  let calls = 0;
  const registry = new ToolRegistry();
  registry.registerTool({
    id: "approval_bound_action",
    name: "Approval-bound action",
    category: TOOL_CATEGORIES.SYSTEM_CONTROL,
    permissionLevel: PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
    requiresConfirmation: true,
    execute: async () => { calls += 1; return { success: true }; }
  });
  const orchestrator = new AutonomousOrchestrator({ registry });
  orchestrator.analyzeIntent = () => ({
    intent: "TEST_PRIVILEGED_ACTION",
    domain: "SYSTEM",
    language: "en",
    confidence: 1
  });
  orchestrator.formulatePlan = () => ({
    id: "new-workflow",
    steps: [{
      id: "step-1",
      dependsOn: [],
      toolId: "approval_bound_action",
      agent: "test",
      description: "Perform exact approved action",
      params: { destination: "/approved/path", overwrite: false }
    }]
  });
  return { orchestrator, calls: () => calls };
}

test("Approval proof cannot authorize changed parameters for the same tool", async () => {
  const { orchestrator, calls } = makeFixture();
  const approval = orchestrator.createApprovalRequest({
    workflowId: "old-workflow",
    stepId: "step-1",
    toolId: "approval_bound_action",
    toolName: "Approval-bound action",
    permissionLevel: PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
    actionDescription: "Perform exact approved action",
    parameters: { destination: "/different/path", overwrite: false },
    userId: "owner-a"
  });
  assert.equal(orchestrator.approveRequest(approval.id, { userId: "owner-a" }).success, true);

  const result = await orchestrator.processUserRequest("run the action", {
    userId: "owner-a",
    approvalId: approval.id
  });
  assert.equal(result.status, "APPROVAL_ACTION_MISMATCH");
  assert.equal(calls(), 0);
  assert.equal(approval.status, "APPROVED");
  assert.equal(approval.consumed, false);
});

test("Approval requests expire after five minutes and cannot be approved or consumed", async () => {
  const { orchestrator, calls } = makeFixture();
  const approval = orchestrator.createApprovalRequest({
    workflowId: "old-workflow",
    stepId: "step-1",
    toolId: "approval_bound_action",
    toolName: "Approval-bound action",
    permissionLevel: PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
    actionDescription: "Perform exact approved action",
    parameters: { destination: "/approved/path", overwrite: false },
    userId: "owner-a"
  });
  approval.expiresAt = new Date(Date.now() - 1000).toISOString();

  const approved = orchestrator.approveRequest(approval.id, { userId: "owner-a" });
  assert.equal(approved.success, false);
  assert.equal(approved.error, "APPROVAL_EXPIRED");
  assert.equal(approval.status, "EXPIRED");

  const result = await orchestrator.processUserRequest("run the action", {
    userId: "owner-a",
    approvalId: approval.id
  });
  assert.equal(result.status, "APPROVAL_EXPIRED");
  assert.equal(calls(), 0);
});

test("Matching approval snapshot still dispatches once and consumes the proof", async () => {
  const { orchestrator, calls } = makeFixture();
  const approvedParams = { destination: "/approved/path", overwrite: false };
  const approval = orchestrator.createApprovalRequest({
    workflowId: "old-workflow",
    stepId: "step-1",
    toolId: "approval_bound_action",
    toolName: "Approval-bound action",
    permissionLevel: PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
    actionDescription: "Perform exact approved action",
    parameters: approvedParams,
    userId: "owner-a"
  });
  assert.equal(orchestrator.approveRequest(approval.id, { userId: "owner-a" }).success, true);

  const result = await orchestrator.processUserRequest("run the action", {
    userId: "owner-a",
    approvalId: approval.id
  });
  assert.equal(result.verified, true);
  assert.equal(calls(), 1);
  assert.equal(approval.status, "CONSUMED");
});


test("Approved exact owner action can safely resume on re-entry without a client token map", async () => {
  const { orchestrator, calls } = makeFixture();
  const approvedParams = { destination: "/approved/path", overwrite: false };
  const approval = orchestrator.createApprovalRequest({
    workflowId: "first-workflow",
    stepId: "step-1",
    toolId: "approval_bound_action",
    toolName: "Approval-bound action",
    permissionLevel: PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
    actionDescription: "Perform exact approved action",
    parameters: approvedParams,
    userId: "owner-a"
  });
  assert.equal(orchestrator.approveRequest(approval.id, { userId: "owner-a" }).success, true);

  // The UI may reload between approval and resume. The server can discover
  // exactly one unused approval matching the same authenticated owner/action.
  const result = await orchestrator.processUserRequest("run the action", { userId: "owner-a" });
  assert.equal(result.verified, true);
  assert.equal(calls(), 1);
  assert.equal(approval.status, "CONSUMED");
});
