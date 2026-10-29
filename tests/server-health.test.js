import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function health(env) {
  const app = createApp({ env, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(response.status, 200);
    return await response.json();
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("health exposes only a validated deployed commit identifier", async () => {
  const result = await health({ RENDER_GIT_COMMIT: "a1b2c3d4e5f60718293a4b5c6d7e8f901234abcd" });
  assert.equal(result.build.commit, "a1b2c3d4e5f60718293a4b5c6d7e8f901234abcd");

  const invalid = "main?token=must-not-be-exposed";
  const rejected = await health({ RENDER_GIT_COMMIT: invalid });
  assert.equal(rejected.build.commit, null);
  assert.equal(JSON.stringify(rejected).includes(invalid), false);
});


test("health reports a configured alternate provider without exposing credentials", async () => {
  const result = await health({
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: "example-model" }
    ]),
    GROQ_API_KEY: "synthetic-test-key"
  });
  assert.equal(result.providerConfigured, true);
  assert.equal(JSON.stringify(result).includes("synthetic-test-key"), false);
});

test("health rejects missing-key and insecure alternate providers", async () => {
  const result = await health({
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "missing-key", baseUrl: "https://api.example.com/v1", apiKeyEnv: "MISSING_KEY", model: "example-model" },
      { name: "insecure", baseUrl: "http://localhost:1234/v1", apiKeyEnv: "UNSAFE_KEY", model: "example-model" }
    ]),
    UNSAFE_KEY: "synthetic-test-key"
  });
  assert.equal(result.providerConfigured, false);
});

test("health continues to recognize the configured OpenRouter primary", async () => {
  const result = await health({ OPENROUTER_API_KEY: "synthetic-test-key", OPENROUTER_DEFAULT_MODEL: "openrouter/free" });
  assert.equal(result.providerConfigured, true);
});

test("health recognizes OpenRouter when the runtime default model is used", async () => {
  const result = await health({ OPENROUTER_API_KEY: "synthetic-test-key" });
  assert.equal(result.providerConfigured, true);
});


test("password recovery validates email and sends a generic response without account enumeration", async () => {
  let request;
  const app = createApp({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-publishable-key" },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      request = { url, options };
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/recovery`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "not-an-email" })
    });
    assert.equal(invalid.status, 400);
    assert.equal(request, undefined);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/recovery`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "user@example.com" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /If an account exists/);
    assert.ok(request.url.endsWith("/auth/v1/recover"));
    assert.deepEqual(JSON.parse(request.options.body), { email: "user@example.com" });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("password recovery uses only the configured HTTPS redirect destination", async () => {
  let requestUrl = "";
  const app = createApp({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      ULTRON_AUTH_REDIRECT_URL: "https://ultron.example.com/reset-password"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async url => {
      requestUrl = url;
      return new Response("{}", { status: 200 });
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/recovery`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "user@example.com" })
    });
    assert.equal(response.status, 200);
    assert.ok(requestUrl.includes("redirect_to=https%3A%2F%2Fultron.example.com%2Freset-password"));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("health does not mark query/fragment-bearing provider URLs as configured", async () => {
  const primary = await health({
    OPENROUTER_API_KEY: "synthetic-test-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1?token=unexpected"
  });
  assert.equal(primary.providerConfigured, false);

  const alternates = await health({
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "query-provider", baseUrl: "https://api.example.com/v1?token=unexpected", apiKeyEnv: "QUERY_KEY", model: "test-model" },
      { name: "fragment-provider", baseUrl: "https://api.example.com/v1#unexpected", apiKeyEnv: "FRAGMENT_KEY", model: "test-model" }
    ]),
    QUERY_KEY: "synthetic-query-key",
    FRAGMENT_KEY: "synthetic-fragment-key"
  });
  assert.equal(alternates.providerConfigured, false);
});

test("health rejects alternate providers with empty or oversized model IDs", async () => {
  const result = await health({
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "empty-model", baseUrl: "https://empty.example.com/v1", apiKeyEnv: "EMPTY_MODEL_KEY", model: "   " },
      { name: "oversized-model", baseUrl: "https://oversized.example.com/v1", apiKeyEnv: "OVERSIZED_MODEL_KEY", model: "x".repeat(161) }
    ]),
    EMPTY_MODEL_KEY: "synthetic-empty-model-key",
    OVERSIZED_MODEL_KEY: "synthetic-oversized-model-key"
  });
  assert.equal(result.providerConfigured, false);
});



test("Browser Use proxy retries free model candidates and keeps image requests on vision models", async () => {
  const calls = [];
  const app = createApp({
    env: {
      OPENROUTER_API_KEY: "proxy-test-key",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ULTRON_AVAILABLE_MODELS: "openrouter/free,nvidia/nemotron-3.5-lightning:free,cohere/north-mini-code:free",
      ULTRON_VISION_MODELS: "openrouter/free,nvidia/nemotron-3.5-super-vl:free",
      ULTRON_BROWSER_USE_TOKEN: "proxy-shared-test-token"
    },
    fetchImpl: async (url, options) => {
      const model = JSON.parse(options.body).model;
      calls.push({ url, model });
      if (calls.length % 2 === 1) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
      return new Response(JSON.stringify({ model, choices: [{ message: { role: "assistant", content: "Fallback succeeded." } }] }), { status: 200 });
    },
    logger: { info() {}, warn() {}, error() {} }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const request = (messages) => fetch(base + "/api/internal/browser-use/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer proxy-shared-test-token" },
      body: JSON.stringify({ model: "openrouter/free", messages })
    });
    let response = await request([{ role: "user", content: "Say hello" }]);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(call => call.model), ["openrouter/free", "nvidia/nemotron-3.5-lightning:free"]);
    calls.length = 0;
    response = await request([{ role: "user", content: [
      { type: "text", text: "Describe the image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
    ] }]);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(call => call.model), ["openrouter/free", "nvidia/nemotron-3.5-super-vl:free"]);
    assert.ok(!calls.some(call => call.model === "nvidia/nemotron-3.5-lightning:free" || call.model === "cohere/north-mini-code:free"));
    assert.ok(calls.every(call => call.url === "https://openrouter.ai/api/v1/chat/completions"));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("health does not report private HTTPS provider endpoints as configured", async () => {
  const primary = await health({
    OPENROUTER_API_KEY: "synthetic-test-key",
    OPENROUTER_BASE_URL: "https://192.168.1.10/v1"
  });
  assert.equal(primary.providerConfigured, false);

  const alternate = await health({
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "private-provider", baseUrl: "https://169.254.169.254/latest/meta-data", apiKeyEnv: "PRIVATE_KEY", model: "fake-model" }
    ]),
    PRIVATE_KEY: "synthetic-private-key"
  });
  assert.equal(alternate.providerConfigured, false);
});

test("health recognizes direct-key Groq and Gemini fallbacks only for safe endpoints", async () => {
  const groq = await health({
    GROQ_API_KEY: "synthetic-groq-key",
    GROQ_BASE_URL: "https://api.groq.com/openai/v1"
  });
  assert.equal(groq.providerConfigured, true);
  assert.equal(JSON.stringify(groq).includes("synthetic-groq-key"), false);

  const gemini = await health({
    GEMINI_API_KEY: "synthetic-gemini-key",
    GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai"
  });
  assert.equal(gemini.providerConfigured, true);
  assert.equal(JSON.stringify(gemini).includes("synthetic-gemini-key"), false);

  const rejected = await health({
    GROQ_API_KEY: "synthetic-groq-key",
    GROQ_BASE_URL: "http://localhost:8080/v1"
  });
  assert.equal(rejected.providerConfigured, false);
});
