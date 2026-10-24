import test from "node:test";
import assert from "node:assert/strict";
import {
  agentMemoryReadiness,
  shouldRecallAgentMemory,
  shouldCaptureAgentMemory,
  recallAgentMemory,
  captureAgentMemory
} from "../agentmemory-integration.js";

test("AgentMemory readiness does not reveal credentials", () => {
  const result = agentMemoryReadiness({ AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "private-test-secret" });
  assert.equal(result.configured, true);
  assert.equal(result.automaticRecall, true);
  assert.equal(result.automaticCapture, true);
  assert.equal(JSON.stringify(result).includes("private-test-secret"), false);
});

test("AgentMemory routing skips unrelated tasks and rejects secret-bearing capture", () => {
  assert.equal(shouldRecallAgentMemory("Continue the previous repository implementation"), true);
  assert.equal(shouldRecallAgentMemory("What is 2 plus 2?"), false);
  assert.equal(shouldCaptureAgentMemory("We decided: the project uses a separate worker for queued jobs."), true);
  assert.equal(shouldCaptureAgentMemory("My password is secret123"), false);
});

test("relevant task recall uses the authenticated user's isolated project", async () => {
  let call;
  const result = await recallAgentMemory("Continue the previous repository implementation", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "private-test-secret", ULTRON_AGENTMEMORY_PROJECT: "ultron-ai" },
    userId: "user-123",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return new Response(JSON.stringify({ results: [{ title: "Architecture", content: "Use an isolated worker." }, { text: "Tests run with node --test." }] }), { status: 200 });
    }
  });
  assert.equal(call.url, "https://memory.example/agentmemory/smart-search");
  assert.equal(call.options.headers.Authorization, "Bearer private-test-secret");
  assert.deepEqual(JSON.parse(call.options.body), { query: "Continue the previous repository implementation", project: JSON.parse(call.options.body).project, limit: 5 });
  assert.match(JSON.parse(call.options.body).project, /^ultron-ai-user-[a-f0-9]{40}$/);
  assert.equal(result.memories.length, 2);
  assert.match(result.memories[0], /Architecture/);
});

test("durable capture uses supported remember API and can be disabled", async () => {
  let call;
  const disabled = await captureAgentMemory("We decided: the project uses a separate worker for queued jobs.", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret", ULTRON_AGENTMEMORY_CAPTURE: "false" },
    userId: "user-123",
    fetchImpl: async () => { throw new Error("must not call when capture disabled"); }
  });
  assert.equal(disabled.state, "disabled");
  const captured = await captureAgentMemory("We decided: the project uses a separate worker for queued jobs.", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret", ULTRON_AGENTMEMORY_PROJECT: "ultron-ai" },
    userId: "user-123",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.equal(captured.state, "captured");
  assert.equal(call.url, "https://memory.example/agentmemory/remember");
  assert.equal(JSON.parse(call.options.body).project, "ultron-ai-user-user-123");
  assert.equal(JSON.parse(call.options.body).content, "We decided: the project uses a separate worker for queued jobs.");
});


test("distinct user IDs that normalize similarly cannot share an AgentMemory project", async () => {
  const projects = [];
  for (const userId of ["a/b", "a-b"]) {
    await recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "test-secret", ULTRON_AGENTMEMORY_PROJECT: "ultron-ai" },
      userId,
      fetchImpl: async (_url, options) => {
        projects.push(JSON.parse(options.body).project);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
    });
  }
  assert.notEqual(projects[0], projects[1]);
  assert.match(projects[0], /^ultron-ai-user-[a-f0-9]{40}$/);
  assert.match(projects[1], /^ultron-ai-user-[a-f0-9]{40}$/);
});
\ntest("AgentMemory fails safely when the remote service is unavailable", async () => {
  await assert.rejects(
    recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret" },
      userId: "user-123",
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    }),
    error => error.code === "AGENTMEMORY_REQUEST_FAILED"
  );
});
