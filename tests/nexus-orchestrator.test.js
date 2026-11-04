import test from "node:test";
import assert from "node:assert/strict";
import { NexusOrchestrator, NEXUS_ROLES } from "../nexus/nexus-orchestrator.js";

test("NexusOrchestrator: initializes specialized agent swarm with defined priorities", () => {
  const nexus = new NexusOrchestrator();

  assert.equal(nexus.agents.size, Object.keys(NEXUS_ROLES).length);
  const guardian = nexus.agents.get("CYBER_GUARDIAN");
  assert.ok(guardian);
  assert.equal(guardian.priority, 95);
  assert.equal(guardian.domain, "security");

  const coder = nexus.agents.get("CODE_ENGINEER");
  assert.ok(coder);
  assert.equal(coder.priority, 60);
});

test("NexusOrchestrator: shared Blackboard context maintains versioning and author provenance", () => {
  const nexus = new NexusOrchestrator();

  const v1 = nexus.setContext("deployment_target", "render_production", "ARCHITECT");
  assert.equal(v1.version, 1);
  assert.equal(v1.author, "ARCHITECT");

  const v2 = nexus.setContext("deployment_target", "render_staging", "OPERATOR");
  assert.equal(v2.version, 2);
  assert.equal(v2.author, "OPERATOR");

  assert.equal(nexus.getContext("deployment_target"), "render_staging");
});

test("NexusOrchestrator: inter-agent direct and broadcast messaging", () => {
  const nexus = new NexusOrchestrator();

  // Direct message
  const msg = nexus.sendMessage("SYSTEM_ARCHITECT", "CODE_ENGINEER", "task_assignment", { taskId: "101" });
  assert.equal(msg.topic, "task_assignment");
  const coderInbox = nexus.agents.get("CODE_ENGINEER").inbox;
  assert.equal(coderInbox.length, 1);
  assert.equal(coderInbox[0].payload.taskId, "101");

  // Broadcast message
  nexus.sendMessage("CYBER_GUARDIAN", "*", "security_alert", { threatLevel: "elevated" });
  for (const [name, agent] of nexus.agents.entries()) {
    if (name !== "CYBER_GUARDIAN") {
      assert.ok(agent.inbox.some(m => m.topic === "security_alert"));
    }
  }
});

test("NexusOrchestrator: conflict resolution arbitrates by priority and security override", () => {
  const nexus = new NexusOrchestrator();

  const coderProposal = {
    agentName: "CODE_ENGINEER",
    proposal: "Bypass sandbox for faster native execution",
    confidence: 0.95
  };

  const securityProposal = {
    agentName: "CYBER_GUARDIAN",
    proposal: "Enforce strict sandbox; isolate all file operations",
    confidence: 0.90
  };

  const winner = nexus.resolveConflict([coderProposal, securityProposal]);
  // Security Guardian has higher priority (95 vs 60) and must win the dispute
  assert.equal(winner.agentName, "CYBER_GUARDIAN");
  assert.ok(winner.proposal.includes("Enforce strict sandbox"));
  assert.equal(nexus.conflictLog.length, 1);
});

test("NexusOrchestrator: collaborative multi-agent workflow execution", async () => {
  const nexus = new NexusOrchestrator();

  const mission = await nexus.executeCollaborativeMission("Build secure payment webhook receiver", {
    architecture: async () => ({ approved: true, architectureType: "event_driven" }),
    coding: async () => ({ codeChanges: 3, memoryPressureMB: 12 }),
    security: async () => ({ secure: true, vulnerabilities: 0 })
  });

  assert.equal(mission.success, true);
  assert.equal(mission.executionTrace.length, 3);
  assert.equal(mission.executionTrace[0].agent, "SYSTEM_ARCHITECT");
  assert.equal(mission.executionTrace[1].agent, "CODE_ENGINEER");
  assert.equal(mission.executionTrace[2].agent, "CYBER_GUARDIAN");
  assert.ok(nexus.getContext("security_audit").secure);
});
