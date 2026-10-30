import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHermesAgentService,
  getHermesAgentReadiness,
  resolveHermesAgentProvider,
  runHermesAgentTask
} from "../integrations/hermes-agent.js";

const ownerId = "00000000-0000-4000-8000-000000000001";

function configuredEnv(overrides = {}) {
  return {
    HERMES_AGENT_ENABLED: "true",
    HERMES_AGENT_CHAT_PROVIDER: "true",
    HERMES_AGENT_BASE_URL: "https://hermes.example.com/v1",
    HERMES_AGENT_API_KEY: "private-hermes-api-key",
    HERMES_AGENT_MODEL: "hermes-agent",
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    ...overrides
  };
}

test("Hermes stays disabled until explicitly enabled and configured", async () => {
  let calls = 0;
  assert.equal(resolveHermesAgentProvider({ HERMES_AGENT_BASE_URL: "https://hermes.example.com/v1", HERMES_AGENT_API_KEY: "key" }), null);
  assert.equal(getHermesAgentReadiness({}).state, "disabled_by_config");
  const result = await checkHermesAgentService({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId }, userId: ownerId,
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "HERMES_AGENT_DISABLED");
  assert.equal(calls, 0);
});

test("Hermes direct chat provider is restricted to the configured owner", () => {
  assert.equal(resolveHermesAgentProvider(configuredEnv()), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv(), "00000000-0000-4000-8000-000000000002"), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: "http://hermes.example.com/v1" }), ownerId), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: "https://user:pass@hermes.example.com/v1" }), ownerId), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: "https://hermes.example.com/v2" }), ownerId), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_CHAT_PROVIDER: "false" }), ownerId), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_API_KEY: "" }), ownerId), null);
  const local = resolveHermesAgentProvider(configuredEnv({
    HERMES_AGENT_BASE_URL: "http://127.0.0.1:8642/v1",
    HERMES_AGENT_API_KEY: "local-key"
  }), ownerId);
  assert.equal(local.name, "hermes-agent");
  assert.equal(local.baseUrl, "http://127.0.0.1:8642/v1");
  assert.equal(local.priority, -5);
  assert.equal(local.supportsTools, true);
  assert.equal(local.supportsVision, true);
  assert.equal(local.apiKey, "local-key");
});

test("Hermes readiness lists supported feature families without leaking API key", () => {
  const readiness = getHermesAgentReadiness(configuredEnv());
  assert.equal(readiness.state, "configured_unverified");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.license, "MIT");
  assert.ok(readiness.features.some(feature => feature.includes("self-improving skill")));
  assert.ok(readiness.features.some(feature => feature.includes("subagents")));
  assert.equal(JSON.stringify(readiness).includes("private-hermes-api-key"), false);
});

test("Hermes health checks only GET models/capabilities and blocks non-owner accounts", async () => {
  let calls = 0;
  const notOwner = await checkHermesAgentService({
    env: configuredEnv(),
    userId: "00000000-0000-4000-8000-000000000002",
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(notOwner.state, "blocked");
  assert.equal(notOwner.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  assert.equal(calls, 0);

  const requests = [];
  const result = await checkHermesAgentService({
    env: configuredEnv(), userId: ownerId,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer private-hermes-api-key");
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "hermes-agent" }, { id: "reasoner" }] }), { status: 200 });
      if (url.endsWith("/capabilities")) return new Response(JSON.stringify({
        object: "hermes.api_server.capabilities",
        platform: "hermes-agent",
        model: "hermes-agent",
        auth: { type: "bearer", required: true },
        features: {
          chat_completions: true, responses_api: true, run_submission: true,
          run_status: true, run_events_sse: true, run_stop: true, run_approval: true
        },
        endpoints: { skills: "/v1/skills", toolsets: "/v1/toolsets" },
        session_key_header: "X-Hermes-Session-Key"
      }), { status: 200 });
      throw new Error("unexpected Hermes endpoint");
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.endpointReachable, true);
  assert.equal(result.configuredModelListed, true);
  assert.deepEqual(result.availableModels, ["hermes-agent", "reasoner"]);
  assert.equal(result.capabilities.chatCompletions, true);
  assert.equal(result.capabilities.streaming, true);
  assert.equal(result.capabilities.responses, true);
  assert.equal(result.capabilities.runs, true);
  assert.equal(result.capabilities.runStatus, true);
  assert.equal(result.capabilities.runEvents, true);
  assert.equal(result.capabilities.runStop, true);
  assert.equal(result.capabilities.runApproval, true);
  assert.equal(result.capabilities.skills, true);
  assert.equal(result.capabilities.toolsets, true);
  assert.equal(result.capabilities.sessionKeyHeader, true);
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(result).includes("private-hermes-api-key"), false);
});

test("Hermes delegated task requires owner UUID, sends stable account-scoped memory key and returns bounded final content", async () => {
  let seen;
  const unguarded = await runHermesAgentTask({
    env: configuredEnv({ ULTRON_INTEGRATION_OWNER_USER_ID: "" }),
    userId: ownerId, task: "Research this API and summarize reliable documentation.",
    fetchImpl: async () => { throw new Error("should not call upstream"); }
  });
  assert.equal(unguarded.state, "blocked");
  assert.equal(unguarded.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");

  const result = await runHermesAgentTask({
    env: configuredEnv(), userId: ownerId,
    task: "Research the public API documentation and return a concise summary.",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/runs")) return new Response("Not Found", { status: 404 });
      seen = { url, options, payload: JSON.parse(options.body) };
      assert.equal(url, "https://hermes.example.com/v1/chat/completions");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer private-hermes-api-key");
      assert.match(options.headers["X-Hermes-Session-Key"], /^ultron-[a-f0-9]{32}$/);
      assert.ok(options.headers["Idempotency-Key"]);
      return new Response(JSON.stringify({
        model: "hermes-agent", usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { role: "assistant", content: "The official documentation describes the API; no changes were made." } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.provider, "hermes-agent");
  assert.match(result.content, /official documentation/);
  assert.equal(result.usage.totalTokens, 30);
  assert.equal(JSON.stringify(result).includes("private-hermes-api-key"), false);
  assert.equal(seen.payload.messages[0].role, "system");
  assert.equal(seen.payload.stream, false);
});

test("Hermes delegated tasks reject empty/oversized prompts before networking", async () => {
  let calls = 0;
  const env = configuredEnv({ HERMES_AGENT_MAX_PROMPT_CHARS: "1000" });
  for (const task of ["", "   ", "x".repeat(1001)]) {
    const result = await runHermesAgentTask({
      env, userId: ownerId, task,
      fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
    });
    assert.equal(result.state, "blocked");
    assert.equal(result.error.code, "HERMES_AGENT_TASK_INVALID");
  }
  assert.equal(calls, 0);
});


test("Hermes rejects private, metadata, and loopback HTTPS endpoints", () => {
  for (const url of [
    "https://192.168.1.10/v1",
    "https://10.1.2.3/v1",
    "https://169.254.169.254/v1",
    "https://metadata.google.internal/v1",
    "https://[::1]/v1",
    "https://[fd00::1]/v1"
  ]) {
    assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: url }), ownerId), null, url);
    assert.equal(getHermesAgentReadiness(configuredEnv({ HERMES_AGENT_BASE_URL: url })).configured, false, url);
  }
});


test("Hermes delegates through the native Runs API and polls a completed execution", async () => {
  const requests = [];
  const result = await runHermesAgentTask({
    env: configuredEnv({ HERMES_AGENT_POLL_INTERVAL_MS: "100" }),
    userId: ownerId,
    conversationId: "ultron-conversation-42",
    task: "Inspect the project tests and summarize their coverage.",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/runs") && options.method === "POST") {
        const payload = JSON.parse(options.body);
        assert.equal(payload.input, "Inspect the project tests and summarize their coverage.");
        assert.equal(payload.model, "hermes-agent");
        assert.match(payload.instructions, /least-privileged configured terminal backend/);
        assert.match(payload.session_id, /^ultron-[a-f0-9]{32}$/);
        assert.match(options.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/i);
        assert.match(options.headers["X-Hermes-Session-Key"], /^ultron-[a-f0-9]{32}$/);
        return new Response(JSON.stringify({ run_id: "run-42", status: "started" }), { status: 202 });
      }
      if (url.endsWith("/runs/run-42") && options.method === "GET") {
        return new Response(JSON.stringify({
          run_id: "run-42", status: "completed", model: "hermes-agent",
          output: "Reviewed 18 tests; found 4 coverage groups.",
          usage: { input_tokens: 12, output_tokens: 19 }
        }), { status: 200 });
      }
      throw new Error("unexpected Hermes endpoint: " + url);
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.execution, "runs_api");
  assert.equal(result.runId, "run-42");
  assert.match(result.sessionId, /^ultron-[a-f0-9]{32}$/);
  assert.match(result.content, /Reviewed 18 tests/);
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 19, totalTokens: 31 });
  assert.equal(requests.length, 2);
});

test("Hermes does not auto-approve native runs waiting for approval", async () => {
  const requests = [];
  const result = await runHermesAgentTask({
    env: configuredEnv(),
    userId: ownerId,
    task: "Prepare a code change that needs a tool approval.",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/runs") && options.method === "POST") {
        return new Response(JSON.stringify({ run_id: "run-approval", status: "started" }), { status: 202 });
      }
      if (url.endsWith("/runs/run-approval")) {
        return new Response(JSON.stringify({ run_id: "run-approval", status: "awaiting_approval" }), { status: 200 });
      }
      throw new Error("unexpected Hermes endpoint");
    }
  });
  assert.equal(result.state, "awaiting_approval");
  assert.equal(result.runId, "run-approval");
  assert.equal(requests.length, 2);
});

test("Hermes reports native run failures instead of treating them as successful text", async () => {
  const result = await runHermesAgentTask({
    env: configuredEnv(),
    userId: ownerId,
    task: "Run a bounded verification task.",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/runs") && options.method === "POST") {
        return new Response(JSON.stringify({ run_id: "run-failed", status: "started" }), { status: 202 });
      }
      if (url.endsWith("/runs/run-failed")) {
        return new Response(JSON.stringify({ run_id: "run-failed", status: "failed", output: "internal details" }), { status: 200 });
      }
      throw new Error("unexpected Hermes endpoint");
    }
  });
  assert.equal(result.state, "failed");
  assert.equal(result.error.code, "HERMES_AGENT_RUN_FAILED");
  assert.equal(JSON.stringify(result).includes("internal details"), false);
});


test("Hermes reports interrupted and unknown run outcomes without claiming success", async (t) => {
  for (const status of ["interrupted", "unknown"]) {
    await t.test(status, async () => {
      const result = await runHermesAgentTask({
        env: configuredEnv(),
        userId: ownerId,
        task: "Check a previously submitted run.",
        fetchImpl: async (url, options) => {
          if (url.endsWith("/runs") && options.method === "POST") {
            return new Response(JSON.stringify({ run_id: "run-" + status, status: "started" }), { status: 202 });
          }
          if (url.endsWith("/runs/run-" + status)) {
            return new Response(JSON.stringify({ run_id: "run-" + status, status, output: "should not be trusted" }), { status: 200 });
          }
          throw new Error("unexpected Hermes endpoint");
        }
      });
      assert.equal(result.state, status);
      assert.notEqual(result.state, "completed");
      assert.equal(JSON.stringify(result).includes("should not be trusted"), false);
      assert.equal(result.error.code, status === "unknown"
        ? "HERMES_AGENT_RUN_OUTCOME_UNKNOWN"
        : "HERMES_AGENT_RUN_INTERRUPTED");
    });
  }
});
