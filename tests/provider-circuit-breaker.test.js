import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SECRET = "test-only-provider-key-do-not-expose";
const BASE_ENV = {
  PRIMARY_KEY: SECRET,
  ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
    {
      name: "primary",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_KEY",
      model: "primary-test-model",
      priority: 0
    }
  ]),
  ULTRON_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "2",
  ULTRON_PROVIDER_CIRCUIT_OPEN_MS: "1000"
};

async function withServer({ fetchImpl, env = BASE_ENV, now }, run) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    fetchImpl,
    now,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: USER_ID };
      next();
    },
    logger: { info() {}, warn() {}, error() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function runPrompt(base) {
  return fetch(base + "/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Say hello." })
  });
}

test("provider circuit opens after repeated transient errors, blocks calls, then recovers through one probe", async () => {
  let nowMs = 10_000;
  let providerCalls = 0;
  const fetchImpl = async (_url, options = {}) => {
    assert.equal(options.headers.Authorization, "Bearer " + SECRET);
    providerCalls += 1;
    if (providerCalls <= 2) {
      return new Response(JSON.stringify({ error: { message: "upstream temporarily unavailable" } }), { status: 503 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Hello from the recovered provider." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await withServer({ fetchImpl, now: () => nowMs }, async base => {
    const first = await runPrompt(base);
    assert.equal(first.status, 502);
    const second = await runPrompt(base);
    assert.equal(second.status, 502);
    assert.equal(providerCalls, 2);

    const healthOpen = await fetch(base + "/api/agent/provider-health");
    assert.equal(healthOpen.status, 200);
    const openBody = await healthOpen.json();
    assert.equal(openBody.providers.length, 1);
    assert.equal(openBody.providers[0].circuitState, "open");
    assert.equal(openBody.providers[0].consecutiveFailures, 2);
    assert.equal(openBody.providers[0].lastStatus, 503);
    assert.equal(openBody.providers[0].retryAfterMs, 1000);
    assert.doesNotMatch(JSON.stringify(openBody), new RegExp(SECRET));
    assert.doesNotMatch(JSON.stringify(openBody), /primary\.example\.com/);

    const blocked = await runPrompt(base);
    assert.equal(blocked.status, 503);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error.code, "PROVIDER_CIRCUIT_OPEN");
    assert.equal(providerCalls, 2, "open circuit must not make another outbound provider call");

    nowMs += 1000;
    const recovered = await runPrompt(base);
    assert.equal(recovered.status, 200);
    assert.equal(providerCalls, 3);

    const healthRecovered = await fetch(base + "/api/agent/provider-health");
    const recoveredBody = await healthRecovered.json();
    assert.equal(recoveredBody.providers[0].circuitState, "healthy");
    assert.equal(recoveredBody.providers[0].consecutiveFailures, 0);
    assert.ok(recoveredBody.providers[0].lastSuccessAt);
    assert.doesNotMatch(JSON.stringify(recoveredBody), new RegExp(SECRET));
  });
});

test("provider-health route requires authentication and does not disclose provider credentials", async () => {
  const app = express();
  app.use("/api", createAgentRouter({
    env: BASE_ENV,
    fetchImpl: async () => { throw new Error("health must not call the provider"); },
    requireSupabaseUser: (_req, res) => res.status(401).json({ error: { code: "AUTH_REQUIRED" } }),
    logger: { info() {}, warn() {}, error() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/provider-health");
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
