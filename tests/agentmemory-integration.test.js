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
  assert.match(projects[0], /^ultron-ai-user-sha256-[a-f0-9]{40}$/);
  assert.equal(projects[1], "ultron-ai-user-a-b");
});


test("AgentMemory cancels oversized streamed responses before buffering the whole body", async () => {
  let cancelled = false;
  await assert.rejects(
    recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "test-secret" },
      userId: "user-123",
      fetchImpl: async (_url, options) => {
        assert.equal(options.redirect, "error");
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array(200_001)); },
          cancel() { cancelled = true; }
        }), { status: 200 });
      }
    }),
    error => error.code === "AGENTMEMORY_RESPONSE_TOO_LARGE"
  );
  assert.equal(cancelled, true);
});

test("AgentMemory rejects oversized declared response lengths without reading the body", async () => {
  let cancelled = false;
  await assert.rejects(
    recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "test-secret" },
      userId: "user-123",
      fetchImpl: async () => new Response(new ReadableStream({
        start() {},
        cancel() { cancelled = true; }
      }), { status: 200, headers: { "Content-Length": "200001" } })
    }),
    error => error.code === "AGENTMEMORY_RESPONSE_TOO_LARGE"
  );
  assert.equal(cancelled, true);
});

test("AgentMemory rejects unstreamable response bodies without calling text()", async () => {
  let textCalled = false;
  await assert.rejects(
    recallAgentMemory("Continue the previous repository implementation", {
      env: { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "test-secret" },
      userId: "user-123",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        text: async () => { textCalled = true; return "unbounded response"; }
      })
    }),
    error => error.code === "AGENTMEMORY_RESPONSE_UNBOUNDED" && error.retryable === true
  );
  assert.equal(textCalled, false);
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


test("AgentMemory refuses to persist common access-token and cloud-key formats", () => {
  const sensitive = [
    "We decided: store this access token abcdefghijklmnopqrstuvwxyz in the project notes.",
    "We decided: save this refresh_token: example-refresh-token for later use.",
    "We decided: client_secret=example-secret-value should be used by the integration.",
    "We decided: Authorization: Bearer example-token must be retained for debugging.",
    "We decided: AWS key AKIA1234567890ABCDEF belongs in the configuration notes."
  ];
  for (const value of sensitive) assert.equal(shouldCaptureAgentMemory(value), false, value);
});


test("AgentMemory refuses to persist bearer token wording even without an authorization header", () => {
  assert.equal(shouldCaptureAgentMemory("We decided: bearer token abcdefghijklmnopqrstuvwxyz should be saved for debugging."), false);
});
