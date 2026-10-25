import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const token = "openviking-agent-test-secret";

async function withServer(env, userId, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, ...env },
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: userId }; next(); },
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("agent tool catalog exposes configured OpenViking only to its owner and never returns API tokens", async () => {
  const env = { OPENVIKING_BASE_URL: "https://openviking.example", OPENVIKING_API_TOKEN: token };
  await withServer(env, ownerId, async () => { throw new Error("tool catalog must not call upstream services"); }, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tools.find(item => item.name === "openviking_context").available, true);
    assert.equal(JSON.stringify(body).includes(token), false);
  });
  await withServer(env, "other-user", async () => { throw new Error("tool catalog must not call upstream services"); }, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tools.find(item => item.name === "openviking_context").available, false);
    assert.equal(JSON.stringify(body).includes(token), false);
  });
});

test("deterministic agent fallback routes OpenViking status requests without model tool calls", async () => {
  let modelCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    OPENVIKING_BASE_URL: "https://openviking.example",
    OPENVIKING_API_TOKEN: token
  };
  await withServer(env, ownerId, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    if (modelCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I'll check the context service." } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OpenViking is configured; upstream search has not yet been verified." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Check OpenViking status" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "check_openviking" && item.ok));
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes(token), false);
    assert.equal(JSON.stringify(body).includes("provider-test-secret"), false);
  });
});
