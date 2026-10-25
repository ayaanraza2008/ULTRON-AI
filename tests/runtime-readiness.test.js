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
      ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
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
      ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
      OLLAMA_BASE_URL: "http://localhost:11434"
    }
  });
  assert.equal(result.components.find((item) => item.id === "browser_automation").state, "configured_unverified");
  assert.equal(result.components.find((item) => item.id === "windows_companion").state, "configured_unverified");
  assert.equal(result.components.find((item) => item.id === "local_models").state, "configured_unverified");
});


test("readiness blocks private, metadata, and local HTTPS service endpoints", () => {
  for (const unsafeUrl of [
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.10",
    "https://10.0.0.4",
    "https://metadata.google.internal",
    "https://printer.local",
    "https://[::1]",
    "https://[fd00::1]"
  ]) {
    const result = buildRuntimeReadiness({
      env: {
        ULTRON_BROWSER_USE_URL: unsafeUrl,
        ULTRON_BROWSER_USE_TOKEN: "synthetic-test-token",
        ULTRON_DESKTOP_AGENT_URL: unsafeUrl,
        ULTRON_DESKTOP_AGENT_TOKEN: "synthetic-test-token",
        TTS_API_BASE_URL: unsafeUrl,
        TTS_API_KEY: "synthetic-test-token",
        STT_API_BASE_URL: unsafeUrl,
        STT_API_KEY: "synthetic-test-token"
      }
    });
    assert.equal(result.components.find(item => item.id === "browser_automation").state, "blocked", unsafeUrl);
    assert.equal(result.components.find(item => item.id === "windows_companion").state, "blocked", unsafeUrl);
    assert.equal(result.components.find(item => item.id === "premium_speech").state, "optional", unsafeUrl);
    assert.equal(JSON.stringify(result).includes("synthetic-test-token"), false);
  }
});

test("an intentionally unavailable optional capability does not permanently block core readiness", () => {
  const result = buildRuntimeReadiness({
    env: {
      ULTRON_EMPLOYEES_ENABLED: "true",
      ULTRON_BROWSER_USE_URL: "https://browser.example.com",
      ULTRON_BROWSER_USE_TOKEN: "test-token",
      ULTRON_DESKTOP_AGENT_URL: "https://desktop.example.com",
      ULTRON_DESKTOP_AGENT_TOKEN: "test-token",
      ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
      TAVILY_API_KEY: "test-key",
      ULTRON_AUTH_CALLBACK_URL: "https://ultron.example.com/api/auth/google/callback"
    },
    modelProviderConfigured: true,
    supabaseConfigured: true,
    workerStatus: { state: "running" }
  });

  assert.equal(result.components.find((item) => item.id === "safe_code_execution").state, "not_available");
  assert.equal(result.overallState, "ready_for_live_verification");
  assert.equal(result.summary.blockerCount, 0);
});

test("Windows local automation reports configured-but-unverified only with the full private config", () => {
  const absent = buildRuntimeReadiness({ env: {} });
  assert.equal(absent.components.find(item => item.id === "windows_local_automation").state, "optional");

  const configured = buildRuntimeReadiness({
    env: {
      ULTRON_DESKTOP_POLL_TOKEN: "synthetic-poll-token",
      ULTRON_DESKTOP_DEVICE_ID: "desktop-test-01",
      ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
    }
  });
  const component = configured.components.find(item => item.id === "windows_local_automation");
  assert.equal(component.state, "configured_unverified");
  assert.match(component.note, /allowlisted launching/i);
  assert.equal(JSON.stringify(configured).includes("synthetic-poll-token"), false);
});

