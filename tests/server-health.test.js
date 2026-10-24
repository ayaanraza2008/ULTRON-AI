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


test("security headers follow the configured God’s Eye origin and reject unsafe origins", async () => {
  async function headersFor(url) {
    const app = createApp({
      env: { WORLD_INTELLIGENCE_URL: url },
      logger: { info() {}, warn() {}, error() {} }
    });
    const server = await new Promise(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
      assert.equal(response.status, 200);
      return {
        csp: response.headers.get("content-security-policy") || "",
        permissions: response.headers.get("permissions-policy") || ""
      };
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  const configured = await headersFor("https://globe.example.org/path");
  assert.match(configured.csp, /frame-src 'self' https:\/\/globe\.example\.org/);
  assert.match(configured.permissions, /microphone=\(self "https:\/\/globe\.example\.org"\)/);
  assert.doesNotMatch(configured.csp, /ultron-world-intelligence\.onrender\.com/);

  const unsafe = await headersFor("http://attacker.example");
  assert.match(unsafe.csp, /frame-src 'self' https:\/\/ultron-world-intelligence-live\.onrender\.com/);
  assert.match(unsafe.permissions, /microphone=\(self "https:\/\/ultron-world-intelligence-live\.onrender\.com"\)/);
});
