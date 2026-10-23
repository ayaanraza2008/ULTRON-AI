import test from "node:test";
import assert from "node:assert/strict";
import { hasEmployeeModelProvider } from "../features.js";

test("employee readiness accepts a valid alternate provider without OpenRouter", () => {
  assert.equal(hasEmployeeModelProvider({
    GROQ_API_KEY: "synthetic-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: "llama-3.3-70b-versatile", priority: 1 }
    ])
  }), true);
});

test("employee readiness rejects alternate providers with missing credentials or insecure URLs", () => {
  assert.equal(hasEmployeeModelProvider({
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: "test-model" }
    ])
  }), false);
  assert.equal(hasEmployeeModelProvider({
    GROQ_API_KEY: "synthetic-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "unsafe", baseUrl: "http://127.0.0.1:1234/v1", apiKeyEnv: "GROQ_API_KEY", model: "test-model" }
    ])
  }), false);
});

test("employee readiness recognizes the OpenRouter runtime default model", () => {
  assert.equal(hasEmployeeModelProvider({ OPENROUTER_API_KEY: "synthetic-test-key" }), true);
});

test("employee readiness never treats malformed provider configuration as ready", () => {
  assert.equal(hasEmployeeModelProvider({ ULTRON_MODEL_PROVIDERS_JSON: "not-json" }), false);
});
