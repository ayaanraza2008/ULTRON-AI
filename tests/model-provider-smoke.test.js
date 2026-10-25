import test from "node:test";
import assert from "node:assert/strict";
import { runModelProviderSmoke } from "../scripts/model-provider-smoke.mjs";

const success = (model = "fixture-model", content = "ULTRON_SMOKE_OK") => new Response(JSON.stringify({
  model, choices: [{ message: { content } }]
}), { status: 200, headers: { "content-type": "application/json" } });

test("smoke check proves a real non-empty completion without returning text or secrets", async () => {
  const secret = "never-return-this-test-key";
  const report = await runModelProviderSmoke({
    env: { OPENROUTER_API_KEY: secret, OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer " + secret);
      return success();
    },
    now: () => "fixed-time"
  });
  assert.equal(report.status, "passed");
  assert.equal(report.completionReceived, true);
  assert.equal(report.provider, "openrouter");
  assert.equal(report.generatedAt, "fixed-time");
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes("ULTRON_SMOKE_OK"), false);
});

test("smoke check falls back after a rate-limited primary provider", async () => {
  const seen = [];
  const report = await runModelProviderSmoke({
    env: {
      OPENROUTER_API_KEY: "primary-test-secret",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "fallback", baseUrl: "https://fallback.example.com/v1", apiKeyEnv: "FALLBACK_KEY", model: "free-model", priority: 10 }
      ]),
      FALLBACK_KEY: "fallback-test-secret"
    },
    fetchImpl: async (url) => {
      seen.push(url);
      return url.includes("openrouter.ai") ? new Response("{}", { status: 429 }) : success("free-model");
    }
  });
  assert.equal(report.status, "passed");
  assert.equal(report.provider, "fallback");
  assert.equal(report.successfulAttempt, 2);
  assert.equal(seen.length, 2);
  assert.equal(JSON.stringify(report).includes("test-secret"), false);
});

test("smoke check refuses unsafe provider URLs before networking", async () => {
  let called = false;
  const report = await runModelProviderSmoke({
    env: {
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "unsafe", baseUrl: "http://provider.example.com/v1", apiKeyEnv: "UNSAFE_KEY", model: "test-model" }
      ]),
      UNSAFE_KEY: "test-secret"
    },
    fetchImpl: async () => { called = true; return success(); }
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.reason, "NO_ELIGIBLE_PROVIDER");
  assert.equal(called, false);
});

test("smoke check reports empty completions as failure and never includes provider response text", async () => {
  const report = await runModelProviderSmoke({
    env: { OPENROUTER_API_KEY: "test-secret", OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    fetchImpl: async () => success("openrouter/free", " ")
  });
  assert.equal(report.status, "failed");
  assert.equal(report.attempts[0].code, "EMPTY_COMPLETION");
  assert.equal(JSON.stringify(report).includes("test-secret"), false);
  assert.equal(JSON.stringify(report).includes("ULTRON_SMOKE_OK"), false);
});

test("smoke check clearly blocks when no provider is configured", async () => {
  const report = await runModelProviderSmoke({ env: {}, fetchImpl: async () => success() });
  assert.equal(report.status, "blocked");
  assert.equal(report.reason, "NO_ELIGIBLE_PROVIDER");
});
test("provider smoke blocks private, loopback, metadata, and unusual numeric upstream hosts before networking", async () => {
  const unsafeBases = [
    "https://127.0.0.1/v1",
    "https://192.168.1.10/v1",
    "https://127.1/v1",
    "https://localhost/v1",
    "https://[::1]/v1",
    "https://metadata.google.internal/v1"
  ];
  for (const baseUrl of unsafeBases) {
    let called = false;
    const report = await runModelProviderSmoke({
      env: {
        ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
          { name: "unsafe", baseUrl, apiKeyEnv: "UNSAFE_KEY", model: "fixture-model" }
        ]),
        UNSAFE_KEY: "must-not-be-forwarded"
      },
      fetchImpl: async () => { called = true; return success(); }
    });
    assert.equal(report.status, "blocked", baseUrl);
    assert.equal(called, false, baseUrl);
  }
});
