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


test("agent model routing fails over when a provider returns HTTP 200 with an empty completion", async () => {
  const calls = [];
  const env = {
    FIRST_KEY: "first-test-key",
    SECOND_KEY: "second-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  await withServer(env, async url => {
    calls.push(url);
    if (url.startsWith("https://first.example/")) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Recovered from an empty completion." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.text()), /Recovered from an empty completion/);
    assert.deepEqual(calls, [
      "https://first.example/v1/chat/completions",
      "https://second.example/v1/chat/completions"
    ]);
  });
});


test("agent model routing falls back after malformed JSON from an HTTP 200 provider", async () => {
  const calls = [];
  const env = {
    FIRST_KEY: "first-test-key",
    SECOND_KEY: "second-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  await withServer(env, async url => {
    calls.push(url);
    if (url.startsWith("https://first.example/")) return new Response("{malformed-json", { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Recovered from malformed JSON." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered from malformed JSON/);
    assert.deepEqual(calls, [
      "https://first.example/v1/chat/completions",
      "https://second.example/v1/chat/completions"
    ]);
  });
});

test("agent model routing returns a bounded failure when every provider returns malformed JSON", async () => {
  const env = {
    ONLY_KEY: "only-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "only", baseUrl: "https://only.example/v1", apiKeyEnv: "ONLY_KEY", model: "model-a", priority: 0 }
    ])
  };
  await withServer(env, async () => new Response("{not-json", { status: 200 }), async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /PROVIDER_RESPONSE_INVALID|All configured AI providers failed/);
    assert.doesNotMatch(body, /only-test-key|not-json/);
  });
});


test("agent model routing fails over after a provider timeout without exposing provider details", async () => {
  const calls = [];
  const env = {
    FIRST_KEY: "first-timeout-test-key",
    SECOND_KEY: "second-timeout-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  await withServer(env, async url => {
    calls.push(url);
    if (url.startsWith("https://first.example/")) {
      const timeout = new Error("synthetic timeout detail");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    return new Response(JSON.stringify({
      model: "model-b",
      choices: [{ message: { role: "assistant", content: "Recovered after provider timeout." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Recovered after provider timeout/);
    assert.doesNotMatch(body, /first-timeout-test-key|second-timeout-test-key|synthetic timeout detail/);
    assert.deepEqual(calls, [
      "https://first.example/v1/chat/completions",
      "https://second.example/v1/chat/completions"
    ]);
  });
});


test("agent model routing falls back after an upstream HTTP 408 timeout response", async () => {
  const calls = [];
  const env = {
    FIRST_KEY: "first-408-test-key",
    SECOND_KEY: "second-408-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  await withServer(env, async url => {
    calls.push(url);
    if (url.startsWith("https://first.example/")) {
      return new Response(JSON.stringify({ error: { message: "upstream timeout" } }), { status: 408 });
    }
    return new Response(JSON.stringify({
      model: "model-b",
      choices: [{ message: { role: "assistant", content: "Recovered after HTTP 408." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered after HTTP 408/);
    assert.deepEqual(calls, [
      "https://first.example/v1/chat/completions",
      "https://second.example/v1/chat/completions"
    ]);
  });
});


test("agent fallback supports multiple free OpenRouter models on the same API endpoint", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "openrouter-test-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "nemotron-lightning-free", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: "nvidia/nemotron-3.5-lightning:free", priority: 10, supportsTools: true },
      { name: "north-mini-code-free", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: "cohere/north-mini-code:free", priority: 20, supportsTools: true }
    ])
  };
  await withServer(env, async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, model: request.model, authorization: options.headers.Authorization });
    if (request.model === "openrouter/free") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    return new Response(JSON.stringify({
      model: request.model,
      choices: [{ message: { role: "assistant", content: "Recovered on a free fallback model." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered on a free fallback model/);
    assert.deepEqual(calls.map(call => call.model), ["openrouter/free", "nvidia/nemotron-3.5-lightning:free"]);
    assert.ok(calls.every(call => call.url === "https://openrouter.ai/api/v1/chat/completions"));
    assert.ok(calls.every(call => call.authorization === "Bearer openrouter-test-key"));
  });
});


test("agent model routing retries plain chat after HTTP 400 without switching providers", async () => {
  const calls = [];
  const env = {
    FIRST_KEY: "first-400-test-key",
    SECOND_KEY: "second-400-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };

  await withServer(env, async (url, options) => {
    calls.push({ url, request: JSON.parse(options.body), authorization: options.headers.Authorization });
    return new Response(JSON.stringify({ error: { message: "malformed request" } }), { status: 400 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello" })
    });
    assert.equal(response.status, 502);
    assert.equal(calls.length, 2, "tool-mode 400 should trigger one plain-chat retry");
    assert.deepEqual(calls.map(call => call.url), [
      "https://first.example/v1/chat/completions",
      "https://first.example/v1/chat/completions"
    ], "HTTP 400 must not advance to the second provider");
    assert.ok(Array.isArray(calls[0].request.tools) && calls[0].request.tools.length > 0, "first call includes tool schemas");
    assert.equal(calls[1].request.tools, undefined, "retry omits unsupported tool schemas");
    assert.deepEqual(calls.map(call => call.authorization), [
      "Bearer first-400-test-key",
      "Bearer first-400-test-key"
    ]);
    const body = await response.text();
    assert.doesNotMatch(body, /first-400-test-key|second-400-test-key|malformed request/);
  });
});
