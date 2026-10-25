import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter, modelRoutingTimeoutMs } from "../agent-runtime.js";

test("overall model-routing deadline stops the fallback chain", async () => {
  const totalDeadline = new AbortController();
  const requestedTimeouts = [];
  const providerCalls = [];
  const env = {
    ULTRON_MODEL_TOTAL_TIMEOUT_MS: "30000",
    FIRST_KEY: "first-test-key",
    SECOND_KEY: "second-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example.com/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example.com/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    createTimeoutSignal: ms => {
      requestedTimeouts.push(ms);
      return ms === 30000 ? totalDeadline.signal : AbortSignal.timeout(ms);
    },
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
      next();
    },
    logger: { warn() {} },
    fetchImpl: async (url, options = {}) => {
      providerCalls.push(url);
      assert.equal(url, "https://first.example.com/v1/chat/completions");
      // Simulate the overall deadline expiring during the first provider call.
      totalDeadline.abort(new DOMException("Total provider budget expired", "TimeoutError"));
      assert.equal(options.signal.aborted, true);
      throw options.signal.reason;
    }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Give me a concise summary." })
    });
    assert.equal(response.status, 504);
    const body = await response.json();
    assert.equal(body.error.code, "PROVIDER_TOTAL_TIMEOUT");
    assert.deepEqual(providerCalls, ["https://first.example.com/v1/chat/completions"]);
    assert.deepEqual(requestedTimeouts.slice(0, 2), [30000, 45000]);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("model-routing timeout budget defaults and clamps unsafe values", () => {
  assert.equal(modelRoutingTimeoutMs({}), 90000);
  assert.equal(modelRoutingTimeoutMs({ ULTRON_MODEL_TOTAL_TIMEOUT_MS: "30000" }), 30000);
  assert.equal(modelRoutingTimeoutMs({ ULTRON_MODEL_TOTAL_TIMEOUT_MS: "1000" }), 15000);
  assert.equal(modelRoutingTimeoutMs({ ULTRON_MODEL_TOTAL_TIMEOUT_MS: "500000" }), 120000);
  assert.equal(modelRoutingTimeoutMs({ ULTRON_MODEL_TOTAL_TIMEOUT_MS: "invalid" }), 90000);
});
