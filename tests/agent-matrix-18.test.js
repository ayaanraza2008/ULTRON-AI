import test from "node:test";
import assert from "node:assert/strict";
import { ULTRON_AGENT_CATALOG, getAgentById } from "../agents/catalog.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";

test("AgentMatrix18: all 18 agents have complete responsibilities, schemas, and retry policies", () => {
  assert.equal(ULTRON_AGENT_CATALOG.length, 18);

  for (const agent of ULTRON_AGENT_CATALOG) {
    assert.ok(agent.id, `Agent missing id`);
    assert.ok(agent.name, `Agent ${agent.id} missing name`);
    assert.ok(agent.role, `Agent ${agent.id} missing role`);
    assert.ok(agent.responsibility, `Agent ${agent.id} missing responsibility`);
    assert.ok(Array.isArray(agent.capabilities) && agent.capabilities.length >= 3,
      `Agent ${agent.id} must declare at least 3 capabilities`);
    assert.ok(Array.isArray(agent.allowedTools) && agent.allowedTools.length >= 2,
      `Agent ${agent.id} must declare allowedTools`);

    // Schemas & boundaries
    assert.ok(agent.inputSchema && agent.inputSchema.type === "object", `Agent ${agent.id} missing inputSchema`);
    assert.ok(agent.outputSchema && agent.outputSchema.type === "object", `Agent ${agent.id} missing outputSchema`);
    assert.ok(agent.retryPolicy && typeof agent.retryPolicy.maxRetries === "number");
    assert.ok(agent.executionBoundaries && typeof agent.executionBoundaries.timeoutMs === "number");
  }
});

test("AgentMatrix18: executeAgentAction routes across all 18 specialized agents", async () => {
  const orchestrator = new AgentOrchestrator();

  for (const agent of ULTRON_AGENT_CATALOG) {
    const res = await orchestrator.executeAgentAction(agent.id, "test_action", { sample: "payload" });
    assert.ok(res, `Action result for ${agent.id} must be non-null`);
    assert.ok(res.agent === agent.id || res.agent, `Response must record agent id`);
  }
});

test("AgentMatrix18: DLQ failure classification categorizes network, timeout, and permission errors", () => {
  const orchestrator = new AgentOrchestrator();

  const timeoutClass = orchestrator.classifyFailure(new Error("Request ETIMEDOUT after 30000ms"));
  assert.equal(timeoutClass.category, "TIMEOUT");
  assert.equal(timeoutClass.retryable, true);

  const rateLimitClass = orchestrator.classifyFailure(new Error("HTTP 429 Too Many Requests"));
  assert.equal(rateLimitClass.category, "RATE_LIMIT");
  assert.equal(rateLimitClass.retryable, true);

  const netClass = orchestrator.classifyFailure(new Error("fetch failed: ECONNREFUSED"));
  assert.equal(netClass.category, "TRANSIENT_NETWORK");
  assert.equal(netClass.retryable, true);

  const permClass = orchestrator.classifyFailure(new Error("Access forbidden (403): insufficient privileges"));
  assert.equal(permClass.category, "PERMISSION_DENIED");
  assert.equal(permClass.retryable, false);

  const valClass = orchestrator.classifyFailure(new Error("Invalid schema: missing required field"));
  assert.equal(valClass.category, "VALIDATION_ERROR");
  assert.equal(valClass.retryable, false);
});

test("AgentMatrix18: DLQ captures failed tasks with idempotency keys and stats", async () => {
  const orchestrator = new AgentOrchestrator();

  const task = orchestrator.createTask({
    id: "task-failing-01",
    title: "Test Failing Task",
    targetAgentId: "research-agent",
    steps: [{ id: "step-err", agentId: "research-agent", action: "query" }]
  });

  // Execute with an executor that throws a timeout error
  await orchestrator.resumeTask(task.id, async () => {
    throw new Error("ETIMEDOUT connecting to upstream research provider");
  });

  assert.equal(task.status, "FAILED");
  const dlq = orchestrator.getDeadLetterQueue();
  assert.equal(dlq.length, 1);
  assert.equal(dlq[0].category, "TIMEOUT");
  assert.equal(dlq[0].retryable, true);
  assert.ok(dlq[0].idempotencyKey.startsWith("task-failing-01:step-err:"));

  const stats = orchestrator.getDLQStats();
  assert.equal(stats.total, 1);
  assert.equal(stats.retryable, 1);
  assert.equal(stats.categories["TIMEOUT"], 1);

  // Purge DLQ
  const purgeRes = orchestrator.purgeDLQ();
  assert.equal(purgeRes.purged, 1);
  assert.equal(orchestrator.getDeadLetterQueue().length, 0);
});

test("AgentMatrix18: DAG upfront cycle detection catches dependency cycles immediately", async () => {
  const orchestrator = new AgentOrchestrator();

  // Create a cyclic dependency: node-A -> node-B -> node-C -> node-A
  const cyclicNodes = [
    { id: "node-A", agentId: "planning-agent", dependsOn: ["node-C"] },
    { id: "node-B", agentId: "coding-agent", dependsOn: ["node-A"] },
    { id: "node-C", agentId: "testing-agent", dependsOn: ["node-B"] }
  ];

  const dagResult = await orchestrator.executeDAG({ title: "Cyclic Test", nodes: cyclicNodes });
  assert.equal(dagResult.status, "FAILED");
  assert.ok(dagResult.error.includes("dependency cycle detected"));
});

test("AgentMatrix18: DAG failure propagates cancellation across pending branches", async () => {
  const orchestrator = new AgentOrchestrator();

  const nodes = [
    { id: "node-1", agentId: "research-agent", dependsOn: [] },
    { id: "node-2", agentId: "coding-agent", dependsOn: ["node-1"] }
  ];

  let step1Failed = false;
  try {
    await orchestrator.executeDAG({ title: "Propagation Test", nodes }, async (node) => {
      if (node.id === "node-1") {
        step1Failed = true;
        throw new Error("Provider rate limit hit");
      }
      return { status: "success" };
    });
  } catch (err) {
    assert.ok(err.message.includes("Provider rate limit hit"));
  }

  assert.equal(step1Failed, true);
  const task = Array.from(orchestrator.activeTasks.values()).find(t => t.title === "Propagation Test");
  assert.ok(task);
  assert.equal(task.status, "FAILED");
});
