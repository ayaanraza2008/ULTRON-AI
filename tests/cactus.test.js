import test from "node:test";
import assert from "node:assert/strict";
import { checkCactusService, getCactusReadiness, resolveCactusProvider } from "../integrations/cactus.js";

const ownerId = "00000000-0000-4000-8000-000000000001";

test("Cactus stays optional and does not trigger model downloads", () => {
  const ready = getCactusReadiness({});
  assert.equal(ready.configured, false);
  assert.equal(ready.state, "desktop_companion_required");
  assert.equal(ready.modelDownloadedByUltron, undefined);
  assert.equal(resolveCactusProvider({}), null);
});

test("Cactus remote model endpoints require an API key", async () => {
  let calls = 0;
  const result = await checkCactusService({
    env: { CACTUS_BASE_URL: "https://cactus.example/v1", CACTUS_MODEL: "needle" },
    userId: ownerId,
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "CACTUS_NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("Cactus rejects a different signed-in account when an owner UUID is configured", async () => {
  let calls = 0;
  const result = await checkCactusService({
    env: {
      ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
      CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
      CACTUS_MODEL: "Cactus-Compute/needle"
    },
    userId: "00000000-0000-4000-8000-000000000002",
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("Cactus readiness does not expose API key values and uses the local endpoint when configured", () => {
  const ready = getCactusReadiness({
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    CACTUS_API_KEY: "private-cactus-secret",
    CACTUS_CONFIDENCE_THRESHOLD: "0.81"
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.localEndpoint, true);
  assert.equal(ready.localFirst, true);
  assert.equal(ready.confidenceThreshold, 0.81);
  assert.equal(JSON.stringify(ready).includes("private-cactus-secret"), false);
});

test("Cactus model-list health check is read-only, bounded and redacts authorization", async () => {
  let request;
  const result = await checkCactusService({
    env: {
      ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
      CACTUS_BASE_URL: "https://cactus.example/v1",
      CACTUS_MODEL: "Cactus-Compute/needle",
      CACTUS_API_KEY: "private-cactus-secret"
    },
    userId: ownerId,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ data: [
        { id: "Cactus-Compute/needle" }, { id: "Cactus-Compute/gemma-4-E2B-it" }
      ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.endpointReachable, true);
  assert.equal(result.configuredModelListed, true);
  assert.equal(result.availableModels.length, 2);
  assert.equal(request.url, "https://cactus.example/v1/models");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer private-cactus-secret");
  assert.equal(request.options.redirect, "error");
  assert.equal(JSON.stringify(result).includes("private-cactus-secret"), false);
});

test("Cactus provider is local-first by default and exposes confidence threshold to the router", () => {
  const provider = resolveCactusProvider({
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    CACTUS_CONFIDENCE_THRESHOLD: "0.8"
  });
  assert.equal(provider.name, "cactus");
  assert.equal(provider.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(provider.priority, -10);
  assert.equal(provider.apiKey, "");
  assert.equal(provider.confidenceThreshold, 0.8);
  assert.equal(provider.supportsTools, true);
  assert.equal(resolveCactusProvider({
    CACTUS_BASE_URL: "https://cactus.example/v1",
    CACTUS_MODEL: "needle"
  }), null);
});


test("Cactus refuses remote private and metadata endpoints before contacting them", async () => {
  for (const url of [
    "https://192.168.1.10/v1",
    "https://10.1.2.3/v1",
    "https://169.254.169.254/v1",
    "https://metadata.google.internal/v1",
    "https://[fd00::1]/v1"
  ]) {
    let called = false;
    const env = {
      ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
      CACTUS_BASE_URL: url,
      CACTUS_MODEL: "needle",
      CACTUS_API_KEY: "synthetic-token"
    };
    assert.equal(getCactusReadiness(env).configured, false, url);
    const result = await checkCactusService({
      env, userId: ownerId,
      fetchImpl: async () => { called = true; throw new Error("Unsafe URL must not be contacted."); }
    });
    assert.equal(result.state, "blocked", url);
    assert.equal(called, false, url);
  }
});
