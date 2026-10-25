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

test("employee/coding readiness accepts a configured Hermes Agent gateway", () => {
  assert.equal(hasEmployeeModelProvider({
    HERMES_AGENT_ENABLED: "true",
    HERMES_AGENT_CHAT_PROVIDER: "true",
    HERMES_AGENT_BASE_URL: "https://hermes.example/v1",
    HERMES_AGENT_API_KEY: "synthetic-hermes-key",
    HERMES_AGENT_MODEL: "hermes-agent"
  }), true);
});

test("employee/coding readiness ignores Hermes when its explicit enable flag is off", () => {
  assert.equal(hasEmployeeModelProvider({
    HERMES_AGENT_ENABLED: "false",
    HERMES_AGENT_BASE_URL: "https://hermes.example/v1",
    HERMES_AGENT_API_KEY: "synthetic-hermes-key",
    HERMES_AGENT_MODEL: "hermes-agent"
  }), false);
});

test("employee readiness accepts an already-running local Cactus model without an API key", () => {
  assert.equal(hasEmployeeModelProvider({
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle"
  }), true);
});

test("employee readiness rejects a remote Cactus endpoint without an API key", () => {
  assert.equal(hasEmployeeModelProvider({
    CACTUS_BASE_URL: "https://cactus.example/v1",
    CACTUS_MODEL: "Cactus-Compute/needle"
  }), false);
});

test("employee readiness recognizes the OpenRouter runtime default model", () => {
  assert.equal(hasEmployeeModelProvider({ OPENROUTER_API_KEY: "synthetic-test-key" }), true);
});

test("employee readiness never treats malformed provider configuration as ready", () => {
  assert.equal(hasEmployeeModelProvider({ ULTRON_MODEL_PROVIDERS_JSON: "not-json" }), false);
});
