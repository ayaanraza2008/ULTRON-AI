import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHermesAgentService,
  getHermesAgentReadiness,
  resolveHermesAgentProvider,
  runHermesAgentTask,
  startHermesAgentRun,
  getHermesAgentRunStatus,
  stopHermesAgentRun
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
  assert.equal(local.supportsVision, false);
  const visionEnabled = resolveHermesAgentProvider(configuredEnv({
    HERMES_AGENT_BASE_URL: "http://127.0.0.1:8642/v1",
    HERMES_AGENT_API_KEY: "local-key",
    HERMES_AGENT_SUPPORTS_VISION: "true"
  }), ownerId);
  assert.equal(visionEnabled.supportsVision, true);
  assert.equal(local.apiKey, "local-key");
});

test("Hermes readiness lists supported feature families without leaking API key", () => {
  const readiness = getHermesAgentReadiness(configuredEnv());
  assert.equal(readiness.state, "configured_unverified");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.license, "MIT");
  assert.ok(readiness.features.some(feature => feature.includes("self-improving skill")));
  assert.ok(readiness.features.some(feature => feature.includes("subagents")));
  assert.equal(readiness.supportsVision, false);
  assert.equal(getHermesAgentReadiness(configuredEnv({ HERMES_AGENT_SUPPORTS_VISION: "true" })).supportsVision, true);
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
          chat_completions: true,
          responses_api: true,
          run_submission: true,
          run_status: true,
          run_events_sse: true,
          run_stop: true
        }
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
  assert.equal(result.capabilities.runSubmission, true);
  assert.equal(result.capabilities.runStatus, true);
  assert.equal(result.capabilities.runEventsSse, true);
  assert.equal(result.capabilities.runStop, true);
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(result).includes("private-hermes-api-key"), false);
});


test("Hermes capability discovery remains compatible with legacy flat capability flags", async () => {
  const result = await checkHermesAgentService({
    env: configuredEnv(),
    userId: ownerId,
    fetchImpl: async url => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "hermes-agent" }] }), { status: 200 });
      }
      if (url.endsWith("/capabilities")) {
        return new Response(JSON.stringify({
          chat_completions: true,
          chat_completions_streaming: true,
          responses: true,
          runs: true
        }), { status: 200 });
      }
      throw new Error("unexpected Hermes endpoint");
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.capabilities.chatCompletions, true);
  assert.equal(result.capabilities.streaming, true);
  assert.equal(result.capabilities.responses, true);
  assert.equal(result.capabilities.runs, true);
  assert.equal(result.capabilities.runSubmission, false);
  assert.equal(result.capabilities.runStatus, false);
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


function currentRunCapabilities() {
  return new Response(JSON.stringify({
    object: "hermes.api_server.capabilities",
    features: {
      chat_completions: true,
      run_submission: true,
      run_status: true,
      run_events_sse: true,
      run_stop: true,
      run_approval: true
    }
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("Hermes long-running task starts only after run capability discovery and preserves owner-scoped session identity", async () => {
  const seen = [];
  const result = await startHermesAgentRun({
    env: configuredEnv(),
    userId: ownerId,
    conversationId: "conversation-42",
    task: "Research the official Hermes API and summarize its run lifecycle.",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.endsWith("/capabilities")) return currentRunCapabilities();
      assert.equal(url, "https://hermes.example.com/v1/runs");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer private-hermes-api-key");
      assert.ok(options.headers["Idempotency-Key"]);
      assert.match(options.headers["X-Hermes-Session-Key"], /^ultron-[a-f0-9]{32}$/);
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "hermes-agent");
      assert.match(payload.session_id, /^ultron-[a-f0-9]{32}$/);
      assert.match(payload.instructions, /Do not publish/);
      assert.equal(payload.input, "Research the official Hermes API and summarize its run lifecycle.");
      return new Response(JSON.stringify({ run_id: "run_abc123", status: "started" }), { status: 202 });
    }
  });
  assert.equal(result.state, "started");
  assert.equal(result.runId, "run_abc123");
  assert.equal(result.status, "started");
  assert.equal(result.model, "hermes-agent");
  assert.equal(seen.length, 2);
});

test("Hermes run submission fails closed when run APIs are not advertised", async () => {
  let posts = 0;
  const result = await startHermesAgentRun({
    env: configuredEnv(),
    userId: ownerId,
    task: "Do a harmless read-only research task.",
    fetchImpl: async url => {
      if (url.endsWith("/capabilities")) {
        return new Response(JSON.stringify({ features: { chat_completions: true, run_status: true } }), { status: 200 });
      }
      posts++;
      throw new Error("run submission must not be attempted");
    }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "HERMES_RUNS_UNSUPPORTED");
  assert.equal(posts, 0);
});

test("Hermes run status is owner-scoped, validates run IDs and bounds output", async () => {
  let calls = 0;
  const denied = await getHermesAgentRunStatus({
    env: configuredEnv(),
    userId: "00000000-0000-4000-8000-000000000002",
    runId: "run_abc123",
    fetchImpl: async () => { calls++; throw new Error("non-owner must not reach Hermes"); }
  });
  assert.equal(denied.state, "blocked");
  assert.equal(denied.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  const invalid = await getHermesAgentRunStatus({
    env: configuredEnv(),
    userId: ownerId,
    runId: "../admin",
    fetchImpl: async () => { calls++; throw new Error("invalid run ID must not reach Hermes"); }
  });
  assert.equal(invalid.state, "blocked");
  assert.equal(invalid.error.code, "HERMES_RUN_ID_INVALID");
  const result = await getHermesAgentRunStatus({
    env: configuredEnv(),
    userId: ownerId,
    runId: "run_abc123",
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://hermes.example.com/v1/runs/run_abc123");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer private-hermes-api-key");
      return new Response(JSON.stringify({
        object: "hermes.run",
        run_id: "run_abc123",
        status: "completed",
        session_id: "ultron-session",
        model: "hermes-agent",
        output: "Completed the public documentation review.",
        usage: { input_tokens: 12, output_tokens: 19, total_tokens: 31 }
      }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.terminal, true);
  assert.equal(result.usage.totalTokens, 31);
  assert.match(result.output, /documentation review/);
  assert.equal(calls, 1);
});

test("Hermes run stop requires advertised support and reports stopping, not cancelled", async () => {
  const seen = [];
  const result = await stopHermesAgentRun({
    env: configuredEnv(),
    userId: ownerId,
    runId: "run_abc123",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.endsWith("/capabilities")) return currentRunCapabilities();
      assert.equal(url, "https://hermes.example.com/v1/runs/run_abc123/stop");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({ status: "stopping" }), { status: 200 });
    }
  });
  assert.equal(result.state, "stopping");
  assert.equal(result.status, "stopping");
  assert.equal(result.runId, "run_abc123");
  assert.equal(seen.length, 2);
  let stopCalls = 0;
  const unsupported = await stopHermesAgentRun({
    env: configuredEnv(),
    userId: ownerId,
    runId: "run_abc123",
    fetchImpl: async url => {
      if (url.endsWith("/capabilities")) return new Response(JSON.stringify({ features: { run_submission: true, run_status: true } }), { status: 200 });
      stopCalls++;
      throw new Error("unsupported stop must not be attempted");
    }
  });
  assert.equal(unsupported.state, "blocked");
  assert.equal(unsupported.error.code, "HERMES_RUN_STOP_UNSUPPORTED");
  assert.equal(stopCalls, 0);
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
