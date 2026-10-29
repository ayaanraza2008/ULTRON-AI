import test from "node:test";
import assert from "node:assert/strict";
import { getStrataReadiness, resolveStrataProvider } from "../integrations/strata.js";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

test("Strata is optional and never downloads model weights", () => {
  const readiness = getStrataReadiness({});
  assert.equal(readiness.configured, false);
  assert.equal(readiness.state, "optional");
  assert.match(readiness.note, /does not install Strata or download model weights/i);
  assert.equal(resolveStrataProvider({}), null);
});

test("Strata accepts an explicitly configured local loopback API without a key", () => {
  const env = { STRATA_BASE_URL: "http://127.0.0.1:8080/v1", STRATA_MODEL: "local-model" };
  const readiness = getStrataReadiness(env);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.state, "configured_unverified");
  assert.equal(JSON.stringify(readiness).includes("secret"), false);
  assert.deepEqual(resolveStrataProvider(env), {
    name: "strata",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "",
    model: "local-model",
    priority: -10,
    supportsTools: false,
    supportsVision: false,
    local: true
  });
});

test("Strata requires HTTPS and a server-only key for remote endpoints", () => {
  assert.equal(getStrataReadiness({ STRATA_BASE_URL: "https://strata.example.com/v1", STRATA_MODEL: "model" }).state, "blocked");
  assert.equal(getStrataReadiness({
    STRATA_BASE_URL: "https://strata.example.com/v1",
    STRATA_MODEL: "model",
    STRATA_API_KEY: "server-only-test-secret"
  }).state, "configured_unverified");
  assert.equal(getStrataReadiness({
    STRATA_BASE_URL: "http://strata.example.com/v1",
    STRATA_MODEL: "model",
    STRATA_API_KEY: "server-only-test-secret"
  }).state, "blocked");
});

test("Strata rejects unsafe endpoint URLs and does not enable tool use by default", () => {
  for (const STRATA_BASE_URL of [
    "http://192.168.1.2:8080/v1",
    "https://user:pass@strata.example.com/v1",
    "https://strata.example.com/v1?token=secret"
  ]) {
    assert.equal(getStrataReadiness({ STRATA_BASE_URL, STRATA_MODEL: "model", STRATA_API_KEY: "secret" }).state, "blocked");
  }
  assert.equal(getStrataReadiness({
    STRATA_BASE_URL: "https://strata.example.com/v1",
    STRATA_MODEL: "model",
    STRATA_API_KEY: "secret"
  }).supportsTools, false);
});


test("ULTRON agent uses explicitly configured Strata for compatible text completions", async () => {
  let captured;
  const env = {
    STRATA_BASE_URL: "http://127.0.0.1:8080/v1",
    STRATA_MODEL: "strata-local-test"
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
      next();
    },
    fetchImpl: async (url, options = {}) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        model: "strata-local-test",
        choices: [{ message: { role: "assistant", content: "Strata local response" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    logger: { warn() {}, error() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Explain a simple computer science concept" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Strata local response/);
    assert.equal(captured.url, "http://127.0.0.1:8080/v1/chat/completions");
    assert.equal(captured.options.headers.Authorization, undefined);
    assert.equal(JSON.parse(captured.options.body).model, "strata-local-test");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
