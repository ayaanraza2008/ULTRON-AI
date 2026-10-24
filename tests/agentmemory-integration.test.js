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
  assert.deepEqual(JSON.parse(call.options.body), { query: "Continue the previous repository implementation", project: "ultron-ai-user-user-123", limit: 5 });
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

test("AgentMemory recall and capture report missing configuration truthfully", async () => {
  const recalled = await recallAgentMemory("Continue the previous repository implementation", {
    env: {},
    userId: "user-123",
    fetchImpl: async () => { throw new Error("unconfigured memory must not call network"); }
  });
  assert.deepEqual(recalled, { state: "not_configured", memories: [] });
  const captured = await captureAgentMemory("We decided: the project uses a separate worker for queued jobs.", {
    env: {},
    userId: "user-123",
    fetchImpl: async () => { throw new Error("unconfigured memory must not call network"); }
  });
  assert.deepEqual(captured, { state: "not_configured" });
});

test("AgentMemory rejects private, local, credentialed and insecure remote endpoints", async () => {
  for (const url of [
    "https://127.0.0.1:8080",
    "https://10.0.0.5",
    "https://192.0.2.10",
    "https://192.88.99.10",
    "https://198.51.100.10",
    "https://203.0.113.10",
    "https://[::1]",
    "https://[::ffff:7f00:1]",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://metadata.google.internal",
    "https://user:password@memory.example",
    "http://memory.example"
  ]) {
    let called = false;
    const result = await recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: url, AGENTMEMORY_SECRET: "test-secret" },
      userId: "user-123",
      fetchImpl: async () => { called = true; throw new Error("unsafe endpoint must not be called"); }
    });
    assert.equal(result.state, "not_configured", url);
    assert.equal(called, false, url);
  }
});

test("AgentMemory requests refuse redirects so credentials cannot be forwarded", async () => {
  let options;
  const result = await recallAgentMemory("Continue the previous repository implementation", {
    env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "test-secret" },
    userId: "user-123",
    fetchImpl: async (_url, input) => {
      options = input;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(options.redirect, "error");
});

test("AgentMemory fails safely when the remote service is unavailable", async () => {
  await assert.rejects(
    recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret" },
      userId: "user-123",
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    }),
    error => error.code === "AGENTMEMORY_REQUEST_FAILED"
  );
});


test("AgentMemory response body is bounded while streaming", async () => {
  let cancelled = false;
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(200_001));
    },
    cancel() { cancelled = true; }
  });
  await assert.rejects(
    recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "secret" },
      userId: "user-123",
      fetchImpl: async () => new Response(oversized, { status: 200 })
    }),
    error => error.code === "AGENTMEMORY_RESPONSE_TOO_LARGE"
  );
  assert.equal(cancelled, true);
});
