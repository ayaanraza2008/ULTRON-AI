import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousOrchestrator } from "../core/autonomous-orchestrator.js";
import { ToolRegistry, TOOL_CATEGORIES, PERMISSION_LEVELS } from "../core/tool-registry.js";

test("Multi-step sensitive plans consume approvals only after every step is authorized", async () => {
  const calls = [];
  const registry = new ToolRegistry();
  for (const id of ["sensitive_step_one", "sensitive_step_two"]) {
    registry.registerTool({
      id,
      name: id,
      category: TOOL_CATEGORIES.SYSTEM_CONTROL,
      permissionLevel: PERMISSION_LEVELS.LEVEL_3_SENSITIVE,
      requiresConfirmation: true,
      execute: async params => {
        calls.push({ id, params });
        return { success: true, id };
      }
    });
  }

  const orchestrator = new AutonomousOrchestrator({ registry });
  orchestrator.analyzeIntent = () => ({
    intent: "MULTI_SENSITIVE_TEST",
    domain: "SYSTEM",
    language: "en",
    confidence: 1
  });
  orchestrator.formulatePlan = () => ({
    id: "multi-sensitive-plan",
    steps: [
      {
        id: "step-1",
        dependsOn: [],
        toolId: "sensitive_step_one",
        agent: "test",
        description: "Perform sensitive step one",
        params: { destination: "/one" }
      },
      {
        id: "step-2",
        dependsOn: [],
        toolId: "sensitive_step_two",
        agent: "test",
        description: "Perform sensitive step two",
        params: { destination: "/two" }
      }
    ]
  });

  const pending = await orchestrator.processUserRequest("Run both sensitive actions", { userId: "owner-a" });
  assert.equal(pending.status, "APPROVAL_REQUIRED");
  assert.equal(pending.approvalRequests.length, 2);
  const [approvalOne, approvalTwo] = pending.approvalRequests;
  assert.equal(orchestrator.approveRequest(approvalOne.id, { userId: "owner-a" }).success, true);
  assert.equal(orchestrator.approveRequest(approvalTwo.id, { userId: "owner-a" }).success, true);

  // Supplying only the first approval must not consume it while the second
  // action is still awaiting approval.
  const partial = await orchestrator.processUserRequest("Run both sensitive actions", {
    userId: "owner-a",
    approvalIds: { "step-1": approvalOne.id }
  });
  assert.equal(partial.status, "APPROVAL_REQUIRED");
  assert.equal(partial.approvalRequests.length, 1);
  assert.equal(partial.approvalRequests[0].id, approvalTwo.id);
  assert.equal(approvalOne.status, "APPROVED");
  assert.equal(approvalOne.consumed, false);
  assert.equal(calls.length, 0);

  const completed = await orchestrator.processUserRequest("Run both sensitive actions", {
    userId: "owner-a",
    approvalIds: {
      "step-1": approvalOne.id,
      "step-2": approvalTwo.id
    }
  });
  assert.equal(completed.verified, true);
  assert.equal(calls.length, 2);
  assert.equal(approvalOne.status, "CONSUMED");
  assert.equal(approvalTwo.status, "CONSUMED");
});
