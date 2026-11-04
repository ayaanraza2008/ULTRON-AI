import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, TOOL_CATEGORIES, PERMISSION_LEVELS } from "../core/tool-registry.js";
import { createToolApprovalProof } from "../security/tool-approval-authority.js";

test("ToolRegistry denies privileged calls when no trusted approval verifier is configured", async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  const tool = registry.registerTool({
    id: "approval_test_critical",
    name: "Approval test",
    category: TOOL_CATEGORIES.SYSTEM_CONTROL,
    permissionLevel: PERMISSION_LEVELS.LEVEL_4_CRITICAL,
    requiresConfirmation: true,
    execute: async () => { calls += 1; return { ok: true }; }
  });

  await assert.rejects(
    () => registry.execute(tool.id, {}, { actorId: "owner-a", confirmationToken: "forged" }),
    error => error.code === "TOOL_APPROVAL_REQUIRED"
  );
  await assert.rejects(
    () => tool.execute({}, { actorId: "owner-a", confirmationToken: "forged" }),
    error => error.code === "TOOL_APPROVAL_REQUIRED"
  );
  assert.equal(calls, 0);
});

test("ToolRegistry verifies actor-bound, tool-bound approvals before privileged execution", async () => {
  const consumed = new Set(["owner-a:critical-tool:one-time-token"]);
  let calls = 0;
  const registry = new ToolRegistry({
    approvalVerifier: async ({ actorId, toolId, confirmationToken }) => {
      const key = `${actorId}:${toolId}:${confirmationToken}`;
      if (!consumed.has(key)) return false;
      consumed.delete(key);
      return true;
    }
  });
  const tool = registry.registerTool({
    id: "critical-tool",
    name: "Critical test",
    category: TOOL_CATEGORIES.SYSTEM_CONTROL,
    permissionLevel: PERMISSION_LEVELS.LEVEL_4_CRITICAL,
    execute: async () => { calls += 1; return { ok: true }; }
  });

  await assert.rejects(
    () => registry.execute(tool.id, {}, { actorId: "owner-b", confirmationToken: "one-time-token" }),
    error => error.code === "TOOL_APPROVAL_INVALID"
  );
  assert.deepEqual(
    await registry.execute(tool.id, {}, { actorId: "owner-a", confirmationToken: "one-time-token" }),
    { ok: true }
  );
  await assert.rejects(
    () => registry.execute(tool.id, {}, { actorId: "owner-a", confirmationToken: "one-time-token" }),
    error => error.code === "TOOL_APPROVAL_INVALID"
  );
  assert.equal(calls, 1);
});

test("ToolRegistry consumes orchestrator-minted proof objects exactly once", async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  const tool = registry.registerTool({
    id: "proof-bound-tool",
    name: "Proof-bound test",
    category: TOOL_CATEGORIES.SYSTEM_CONTROL,
    permissionLevel: PERMISSION_LEVELS.LEVEL_4_CRITICAL,
    execute: async () => { calls += 1; return { ok: true }; }
  });
  const proof = createToolApprovalProof({
    actorId: "owner-a",
    toolId: tool.id,
    permissionLevel: tool.permissionLevel,
    approvalId: "appr-test-one"
  });

  assert.deepEqual(
    await registry.execute(tool.id, {}, { actorId: "owner-a", toolApprovalProof: proof }),
    { ok: true }
  );
  await assert.rejects(
    () => registry.execute(tool.id, {}, { actorId: "owner-a", toolApprovalProof: proof }),
    error => error.code === "TOOL_APPROVAL_REQUIRED"
  );
  assert.equal(calls, 1);
});
