import test from "node:test";
import assert from "node:assert/strict";
import { ULTRON_AGENT_CATALOG, getAgentById, listAvailableAgents } from "../agents/catalog.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";

test("Agent Catalog: contains all 12 specialized agents", () => {
  assert.equal(ULTRON_AGENT_CATALOG.length, 12);

  const expectedIds = [
    "ultron-core",
    "research-agent",
    "coding-agent",
    "security-agent",
    "system-agent",
    "memory-agent",
    "voice-agent",
    "vision-agent",
    "automation-agent",
    "planning-agent",
    "execution-agent",
    "self-improvement-agent"
  ];

  for (const id of expectedIds) {
    const agent = getAgentById(id);
    assert.ok(agent, `Agent ${id} must exist in catalog`);
    assert.ok(agent.name, `Agent ${id} must have a name`);
    assert.ok(Array.isArray(agent.allowedTools), `Agent ${id} must define allowed tools`);
    assert.ok(agent.maxConcurrency >= 1, `Agent ${id} must specify positive max concurrency`);
  }
});

test("Agent Catalog: filters agents by autonomy level threshold", () => {
  const level0 = listAvailableAgents(0);
  assert.ok(level0.some(a => a.id === "security-agent"));

  const level3 = listAvailableAgents(3);
  assert.ok(level3.length > level0.length);
  assert.ok(level3.some(a => a.id === "system-agent"));
});

test("Agent Orchestrator: task execution, checkpoints, and resume", async () => {
  const orchestrator = new AgentOrchestrator();

  const task = orchestrator.createTask({
    title: "Verify Core System Modules",
    targetAgentId: "ultron-core",
    steps: [
      { id: "step-1", action: "check_modules" },
      { id: "step-2", action: "validate_integrity" }
    ]
  });

  assert.equal(task.status, "QUEUED");
  assert.equal(task.steps.length, 2);

  const checkpoint1 = orchestrator.getCheckpoint(task.id);
  assert.ok(checkpoint1);
  assert.equal(checkpoint1.currentStepIndex, 0);

  // Resume and execute steps
  const completed = await orchestrator.resumeTask(task.id, async (step) => {
    return { output: `Completed ${step.id}` };
  });

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.currentStepIndex, 2);
  assert.equal(completed.artifacts["step-1"].output, "Completed step-1");
  assert.equal(completed.artifacts["step-2"].output, "Completed step-2");

  const checkpoint2 = orchestrator.getCheckpoint(task.id);
  assert.equal(checkpoint2.completedSteps.length, 2);
});

test("Agent Orchestrator: handles inter-agent delegation", async () => {
  const orchestrator = new AgentOrchestrator();

  const delegated = await orchestrator.delegate({
    fromAgentId: "ultron-core",
    toAgentId: "research-agent",
    taskName: "Deep Web Fact Verification",
    input: { query: "Latest autonomous agent patterns" },
    executor: async (step) => ({ summary: "Fact check verified" })
  });

  assert.equal(delegated.status, "COMPLETED");
  assert.equal(delegated.primaryAgent, "research-agent");
  assert.ok(delegated.artifacts["substep-1"]);
});

test("Agent Orchestrator: emergency stop halts tasks and rejects new work", async () => {
  const orchestrator = new AgentOrchestrator();

  const task = orchestrator.createTask({
    title: "Long Running Pipeline",
    targetAgentId: "automation-agent",
    steps: [{ id: "step-1", action: "wait" }]
  });

  const stopResult = orchestrator.emergencyStop("User triggered emergency button");
  assert.equal(stopResult.success, true);
  assert.equal(orchestrator.isHalted(), true);

  const haltedTask = orchestrator.getTask(task.id);
  assert.equal(haltedTask.status, "CANCELLED");

  // Rejection of new task
  assert.throws(() => {
    orchestrator.createTask({ title: "Forbidden Task" });
  }, /Emergency Stop/);

  // Reset emergency stop
  orchestrator.resetEmergencyStop();
  assert.equal(orchestrator.isHalted(), false);
});

test("Agent Orchestrator: executeAgentAction routes across specialized agents", async () => {
  const orchestrator = new AgentOrchestrator();

  const coreRes = await orchestrator.executeAgentAction("ultron-core", "synthesize", {});
  assert.equal(coreRes.agent, "ultron-core");

  const researchRes = await orchestrator.executeAgentAction("research-agent", "search", { query: "Quantum AI" });
  assert.equal(researchRes.agent, "research-agent");
  assert.ok(researchRes.sourcesCount > 0);

  const secRes = await orchestrator.executeAgentAction("security-agent", "audit", {});
  assert.equal(secRes.safe, true);

  const sysRes = await orchestrator.executeAgentAction("system-agent", "telemetry", {});
  assert.equal(sysRes.hardwareNominal, true);
});

test("Agent Orchestrator: Dead Letter Queue (DLQ) captures failed tasks and supports recovery", async () => {
  const orchestrator = new AgentOrchestrator();

  const task = orchestrator.createTask({
    title: "Faulty External Network Sync",
    targetAgentId: "system-agent",
    steps: [{ id: "step-flaky", action: "sync_remote" }]
  });
  task.maxRetries = 2;

  // Execute with persistent error to force DLQ capture
  await orchestrator.resumeTask(task.id, async () => {
    throw new Error("Simulated upstream gateway timeout 504");
  });

  assert.equal(task.status, "FAILED");
  const dlq = orchestrator.getDeadLetterQueue();
  assert.equal(dlq.length, 1);
  assert.equal(dlq[0].taskId, task.id);
  assert.equal(dlq[0].failedStepId, "step-flaky");

  // Recover task from DLQ with fixed executor
  const recovered = await orchestrator.retryFromDeadLetterQueue(task.id, async (step) => {
    return { status: "recovered", output: "Gateway connection restored." };
  });

  assert.equal(recovered.status, "COMPLETED");
  assert.equal(orchestrator.getDeadLetterQueue().length, 0);
  assert.equal(recovered.artifacts["step-flaky"].status, "recovered");
});

test("Agent Orchestrator: executes DAG tasks with topological dependency resolution", async () => {
  const orchestrator = new AgentOrchestrator();

  // DAG Structure:
  // Node A (research) -> Node B (coding) \
  //                      Node C (security) -> Node D (planning/synthesis)
  const dagNodes = [
    { id: "node-a", agentId: "research-agent", action: "gather_specs", dependsOn: [] },
    { id: "node-b", agentId: "coding-agent", action: "generate_code", dependsOn: ["node-a"] },
    { id: "node-c", agentId: "security-agent", action: "scan_vulnerabilities", dependsOn: ["node-a"] },
    { id: "node-d", agentId: "ultron-core", action: "final_approval", dependsOn: ["node-b", "node-c"] }
  ];

  const executionLog = [];
  const dagResult = await orchestrator.executeDAG({
    title: "Automated Software Deployment Pipeline",
    nodes: dagNodes
  }, async (node, artifacts) => {
    executionLog.push(node.id);
    return { node: node.id, status: "success", timestamp: Date.now() };
  });

  assert.equal(dagResult.status, "COMPLETED");
  assert.equal(executionLog[0], "node-a");
  assert.ok(executionLog.indexOf("node-b") > 0);
  assert.ok(executionLog.indexOf("node-c") > 0);
  assert.equal(executionLog[executionLog.length - 1], "node-d");
  assert.equal(Object.keys(dagResult.artifacts).length, 4);
});
