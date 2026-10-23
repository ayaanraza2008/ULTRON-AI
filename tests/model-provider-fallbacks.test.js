import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("model provider registry fails over after rate limiting and never reads provider keys from request JSON", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "primary-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    GROQ_TEST_API_KEY: "secondary-test-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_TEST_API_KEY", model: "llama-3.3-70b-versatile", priority: 1 }
    ])
  };
  await withServer(env, async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer secondary-test-secret");
    return new Response(JSON.stringify({ model: "llama-3.3-70b-versatile", choices: [{ message: { role: "assistant", content: "Completed through the fallback provider." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Tell me a short greeting", apiKey: "must-not-be-used" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /fallback provider/i);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].auth, "Bearer primary-test-secret");
    assert.equal(calls[1].auth, "Bearer secondary-test-secret");
  });
});

test("model provider registry ignores insecure custom provider URLs and absent server-side credentials", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "primary-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "unsafe", baseUrl: "http://evil.example/v1", apiKeyEnv: "EVIL_API_KEY", model: "x" },
      { name: "missing-key", baseUrl: "https://missing.example/v1", apiKeyEnv: "MISSING_PROVIDER_KEY", model: "x" }
    ])
  };
  await withServer(env, async (url, options) => {
    calls.push(url);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Primary provider worked." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Say hello" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
  });
});
