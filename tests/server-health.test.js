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
