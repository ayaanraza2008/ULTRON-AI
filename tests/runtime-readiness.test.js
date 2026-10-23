import test from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeReadiness } from "../runtime-readiness.js";

test("readiness is explicit about missing runtime dependencies", () => {
  const result = buildRuntimeReadiness({ env: {}, now: new Date("2026-01-01T00:00:00.000Z") });
  assert.equal(result.overallState, "partially_ready");
  assert.equal(result.verification, "configuration_and_process_snapshot_only");
  assert.equal(result.components.find((item) => item.id === "windows_companion").state, "blocked");
  assert.equal(result.components.find((item) => item.id === "safe_code_execution").state, "not_available");
  assert.equal(result.generatedAt, "2026-01-01T00:00:00.000Z");
});

test("readiness reports configured integrations as unverified and never exposes secrets", () => {
  const secret = "synthetic-secret-must-not-leak";
  const result = buildRuntimeReadiness({
    env: {
      OPENROUTER_API_KEY: secret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      ULTRON_BROWSER_USE_URL: "https://browser.example.com",
      ULTRON_BROWSER_USE_TOKEN: secret,
      ULTRON_DESKTOP_AGENT_URL: "https://desktop.example.com",
      ULTRON_DESKTOP_AGENT_TOKEN: secret,
      TAVILY_API_KEY: secret,
      ULTRON_EMPLOYEES_ENABLED: "true"
    },
    modelProviderConfigured: true,
    supabaseConfigured: true,
    workerStatus: {
      state: "running", tasksCompleted: 3, tasksRetried: 2, tasksFailed: 1, tasksBlocked: 4,
      tasksDiscarded: 5, taskStateUpdateFailures: 6, taskLeaseRenewalFailures: 7,
      lastErrorCode: "SYNTHETIC_TEST_ERROR", internalToken: secret
    }
  });
  const output = JSON.stringify(result);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("public-test-key"), false);
  assert.equal(result.components.find((item) => item.id === "browser_automation").state, "configured_unverified");
  assert.equal(result.components.find((item) => item.id === "windows_companion").state, "configured_unverified");
  assert.equal(result.worker.state, "running");
  assert.equal(result.worker.tasksCompleted, 3);
  assert.equal(result.worker.tasksRetried, 2);
  assert.equal(result.worker.tasksBlocked, 4);
  assert.equal(result.worker.tasksDiscarded, 5);
  assert.equal(result.worker.taskStateUpdateFailures, 6);
  assert.equal(result.worker.taskLeaseRenewalFailures, 7);
  assert.equal(Object.hasOwn(result.worker, "internalToken"), false);
});

test("invalid or insecure integration URLs are not treated as configured", () => {
  const result = buildRuntimeReadiness({
    env: {
      ULTRON_BROWSER_USE_URL: "http://browser.example.com",
      ULTRON_BROWSER_USE_TOKEN: "test-token",
      OLLAMA_BASE_URL: "http://ollama.example.com",
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "unsafe", baseUrl: "http://provider.example.com/v1", apiKeyEnv: "UNSAFE_KEY", model: "test" }
      ]),
      UNSAFE_KEY: "test-key"
    }
  });
  assert.equal(result.components.find((item) => item.id === "browser_automation").state, "blocked");
  assert.equal(result.components.find((item) => item.id === "local_models").state, "optional");
});

test("readiness rejects non-HTTP local URLs, embedded credentials, query strings, and fragments", () => {
  const result = buildRuntimeReadiness({
    env: {
      ULTRON_BROWSER_USE_URL: "ftp://localhost:9000",
      ULTRON_BROWSER_USE_TOKEN: "test-token",
      ULTRON_DESKTOP_AGENT_URL: "https://user:password@desktop.example.com",
      ULTRON_DESKTOP_AGENT_TOKEN: "test-token",
      OLLAMA_BASE_URL: "http://localhost:11434?token=unexpected"
    }
  });
  assert.equal(result.components.find((item) => item.id === "browser_automation").state, "blocked");
  assert.equal(result.components.find((item) => item.id === "windows_companion").state, "blocked");
  assert.equal(result.components.find((item) => item.id === "local_models").state, "optional");
});

test("readiness accepts HTTPS services and plain HTTP loopback development services", () => {
  const result = buildRuntimeReadiness({
    env: {
      ULTRON_BROWSER_USE_URL: "https://browser.example.com",
      ULTRON_BROWSER_USE_TOKEN: "test-token",
      ULTRON_DESKTOP_AGENT_URL: "http://127.0.0.1:8787",
      ULTRON_DESKTOP_AGENT_TOKEN: "test-token",
      OLLAMA_BASE_URL: "http://localhost:11434"
    }
  });
  assert.equal(result.components.find((item) => item.id === "browser_automation").state, "configured_unverified");
  assert.equal(result.components.find((item) => item.id === "windows_companion").state, "configured_unverified");
  assert.equal(result.components.find((item) => item.id === "local_models").state, "configured_unverified");
});
