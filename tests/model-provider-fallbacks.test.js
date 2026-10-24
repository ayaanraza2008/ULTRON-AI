import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
    next();
  };
  app.use("/api", createAgentRouter({ env, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("agent model routing falls back after rate limiting and keeps credentials server-side", async () => {
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
    calls.push({ url, authorization: options.headers.Authorization });
    if (url.startsWith("https://openrouter.ai/")) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(JSON.stringify({ model: "llama-3.3-70b-versatile", choices: [{ message: { role: "assistant", content: "Completed through fallback." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello", apiKey: "untrusted-client-key" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.text()), /Completed through fallback/);
    assert.deepEqual(calls.map(call => call.url), [
      "https://openrouter.ai/api/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions"
    ]);
    assert.deepEqual(calls.map(call => call.authorization), [
      "Bearer primary-test-secret",
      "Bearer secondary-test-secret"
    ]);
  });
});

test("agent model routing rejects insecure provider URLs and skips providers without server credentials", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "primary-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "unsafe", baseUrl: "http://evil.example/v1", apiKeyEnv: "EVIL_API_KEY", model: "x" },
      { name: "missing-key", baseUrl: "https://missing.example/v1", apiKeyEnv: "MISSING_PROVIDER_KEY", model: "x" }
    ])
  };
  await withServer(env, async url => {
    calls.push(url);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Primary provider worked." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
  });
});
