import test from "node:test";
import assert from "node:assert/strict";
import {
  agentMemoryReadiness,
  shouldRecallAgentMemory,
  shouldCaptureAgentMemory,
  recallAgentMemory,
  captureAgentMemory
} from "../agentmemory-integration.js";

test("AgentMemory readiness never exposes the configured secret", () => {
  const status = agentMemoryReadiness({ AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "private-test-secret", ULTRON_AGENTMEMORY_CAPTURE: "true" });
  assert.equal(status.configured, true);
  assert.equal(status.automaticRecall, true);
  assert.equal(status.automaticCapture, true);
  assert.equal(JSON.stringify(status).includes("private-test-secret"), false);
});

test("memory routing is task-aware and avoids unrelated tasks", () => {
  assert.equal(shouldRecallAgentMemory("Continue the previous repository implementation"), true);
  assert.equal(shouldRecallAgentMemory("What is 2 plus 2?"), false);
  assert.equal(shouldCaptureAgentMemory("We decided: the project uses a separate worker for queued jobs."), true);
  assert.equal(shouldCaptureAgentMemory("My password is secret123"), false);
});

test("relevant tasks automatically retrieve scoped AgentMemory context", async () => {
  let call;
  const result = await recallAgentMemory("Continue the previous repository implementation", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "private-test-secret", ULTRON_AGENTMEMORY_PROJECT: "ultron-ai" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return new Response(JSON.stringify({ results: [{ title: "Architecture", content: "Use an isolated worker." }, { text: "Tests run with node --test." }] }), { status: 200 });
    }
  });
  assert.equal(call.url, "https://memory.example/agentmemory/smart-search");
  assert.equal(call.options.headers.Authorization, "Bearer private-test-secret");
  assert.deepEqual(JSON.parse(call.options.body), { query: "Continue the previous repository implementation", project: "ultron-ai", limit: 5 });
  assert.equal(result.memories.length, 2);
  assert.match(result.memories[0], /Architecture/);
});

test("AgentMemory capture is opt-in and only stores durable context", async () => {
  let call;
  const disabled = await captureAgentMemory("We decided: the project uses a separate worker for queued jobs.", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret" },
    fetchImpl: async () => { throw new Error("must not call when capture disabled"); }
  });
  assert.equal(disabled.state, "disabled");
  const captured = await captureAgentMemory("We decided: the project uses a separate worker for queued jobs.", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret", ULTRON_AGENTMEMORY_CAPTURE: "true", ULTRON_AGENTMEMORY_PROJECT: "ultron-ai" },
    sessionId: "user-123",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.equal(captured.state, "captured");
  assert.equal(call.url, "https://memory.example/agentmemory/observe");
  assert.equal(JSON.parse(call.options.body).project, "ultron-ai");
});
