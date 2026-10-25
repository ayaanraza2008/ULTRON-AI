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
    HERMES_AGENT_BASE_URL: "https://hermes.example/v1",
    HERMES_AGENT_API_KEY: "private-hermes-api-key",
    HERMES_AGENT_MODEL: "hermes-agent",
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    ...overrides
  };
}

test("Hermes stays disabled until explicitly enabled and configured", async () => {
  let calls = 0;
  assert.equal(resolveHermesAgentProvider({ HERMES_AGENT_BASE_URL: "https://hermes.example/v1", HERMES_AGENT_API_KEY: "key" }), null);
  assert.equal(getHermesAgentReadiness({}).state, "disabled_by_config");
  const result = await checkHermesAgentService({
    env: {}, userId: ownerId,
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "HERMES_AGENT_DISABLED");
  assert.equal(calls, 0);
});

test("Hermes provider rejects unsafe/malformed endpoints and missing API_SERVER_KEY", () => {
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: "http://hermes.example/v1" })), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: "https://user:pass@hermes.example/v1" })), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_BASE_URL: "https://hermes.example/v2" })), null);
  assert.equal(resolveHermesAgentProvider(configuredEnv({ HERMES_AGENT_API_KEY: "" })), null);
  const local = resolveHermesAgentProvider(configuredEnv({
    HERMES_AGENT_BASE_URL: "http://127.0.0.1:8642/v1",
    HERMES_AGENT_API_KEY: "local-key"
  }));
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
        chat_completions: true, chat_completions_streaming: true, responses: true, runs: true
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
  assert.equal(result.capabilities.runs, true);
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
      seen = { url, options, payload: JSON.parse(options.body) };
      assert.equal(url, "https://hermes.example/v1/chat/completions");
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
