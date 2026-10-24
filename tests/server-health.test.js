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


test("OpenRouter proxy falls back on rate limits and unusable successful responses", async () => {
  const attempts = [];
  const app = createApp({
    env: {
      OPENROUTER_API_KEY: "synthetic-openrouter-key",
      OPENROUTER_DEFAULT_MODEL: "model-primary",
      ULTRON_AVAILABLE_MODELS: "model-primary,model-fallback-a,model-fallback-b",
      ULTRON_BROWSER_USE_TOKEN: "synthetic-bridge-token"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer synthetic-openrouter-key");
      const model = JSON.parse(options.body).model;
      attempts.push(model);
      if (attempts.length === 1) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
      if (attempts.length === 2) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Fallback model is healthy." } }] }), { status: 200 });
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/browser-use/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-bridge-token" },
      body: JSON.stringify({ model: "model-primary", messages: [{ role: "user", content: "hello" }] })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ultron-model"), "model-fallback-b");
    assert.match((await response.json()).choices[0].message.content, /Fallback model is healthy/);
    assert.deepEqual(attempts, ["model-primary", "model-fallback-a", "model-fallback-b"]);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("OpenRouter proxy does not retry a non-retryable invalid-request response", async () => {
  let attempts = 0;
  const app = createApp({
    env: {
      OPENROUTER_API_KEY: "synthetic-openrouter-key",
      OPENROUTER_DEFAULT_MODEL: "model-primary",
      ULTRON_AVAILABLE_MODELS: "model-primary,model-fallback",
      ULTRON_BROWSER_USE_TOKEN: "synthetic-bridge-token"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: { message: "invalid request" } }), { status: 400 });
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/browser-use/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-bridge-token" },
      body: JSON.stringify({ model: "model-primary", messages: [{ role: "user", content: "hello" }] })
    });
    assert.equal(response.status, 502);
    assert.equal(attempts, 1, "invalid requests must not be retried against another model");
    const body = await response.json();
    assert.equal(body.error.type, "provider_request_failed");
    assert.equal(JSON.stringify(body).includes("synthetic-openrouter-key"), false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
