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
      assert.equal(JSON.parse(options.body).max_tokens, 128);
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

test("smoke check rejects non-empty completions that do not satisfy the challenge", async () => {
  const privateResponseText = "Provider said it cannot complete this request.";
  const report = await runModelProviderSmoke({
    env: { OPENROUTER_API_KEY: "test-secret", OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    fetchImpl: async () => success("openrouter/free", privateResponseText)
  });
  assert.equal(report.status, "failed");
  assert.equal(report.reason, "ALL_CONFIGURED_PROVIDERS_FAILED");
  assert.equal(report.attempts[0].code, "UNEXPECTED_COMPLETION");
  assert.equal(JSON.stringify(report).includes(privateResponseText), false);
  assert.equal(JSON.stringify(report).includes("test-secret"), false);
});

test("smoke check verifies the challenge token despite harmless surrounding text", async () => {
  const report = await runModelProviderSmoke({
    env: { OPENROUTER_API_KEY: "test-secret", OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    fetchImpl: async () => success("openrouter/free", "ULTRON_SMOKE_OK.")
  });
  assert.equal(report.status, "passed");
  assert.equal(report.challengeVerified, true);
  assert.equal(JSON.stringify(report).includes("ULTRON_SMOKE_OK"), false);
});


test("smoke check tries configured free model IDs after the OpenRouter router is rate limited", async () => {
  const secret = "smoke-free-fallback-test-secret";
  const seen = [];
  const report = await runModelProviderSmoke({
    env: {
      OPENROUTER_API_KEY: secret,
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ULTRON_AVAILABLE_MODELS: "openrouter/free,nvidia/nemotron-3.5-lightning:free,openai/gpt-4.1,https://bad.example/model:free,nvidia/nemotron-3.5-lightning:free"
    },
    fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      seen.push({ url, model: request.model, authorization: options.headers.Authorization });
      if (request.model === "openrouter/free") return new Response("{}", { status: 429 });
      assert.equal(request.model, "nvidia/nemotron-3.5-lightning:free");
      return success(request.model);
    }
  });

  assert.equal(report.status, "passed");
  assert.equal(report.provider, "openrouter-free-fallback-1");
  assert.equal(report.model, "nvidia/nemotron-3.5-lightning:free");
  assert.equal(report.challengeVerified, true);
  assert.equal(report.attempts[0].code, "RATE_LIMITED");
  assert.equal(report.successfulAttempt, 2);
  assert.deepEqual(seen.map(item => item.model), ["openrouter/free", "nvidia/nemotron-3.5-lightning:free"]);
  assert.ok(seen.every(item => item.authorization === "Bearer " + secret));
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.ok(!seen.some(item => item.model === "openai/gpt-4.1" || item.model.includes("bad.example")));
});


test("smoke check rejects HTTPS private, loopback, and metadata destinations before sending credentials", async () => {
  const unsafeUrls = [
    "https://localhost/v1",
    "https://192.168.1.10/v1",
    "https://10.0.0.4/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://[fd00::1]/v1",
    "https://127.1/v1"
  ];
  for (const baseUrl of unsafeUrls) {
    let called = false;
    const report = await runModelProviderSmoke({
      env: {
        OPENROUTER_API_KEY: "private-target-test-secret",
        OPENROUTER_BASE_URL: baseUrl,
        OPENROUTER_DEFAULT_MODEL: "openrouter/free"
      },
      fetchImpl: async () => { called = true; return success(); }
    });
    assert.equal(report.status, "blocked", baseUrl);
    assert.equal(called, false, baseUrl);
    assert.equal(JSON.stringify(report).includes("private-target-test-secret"), false);
  }
});


test("smoke diagnostics identify token-truncated reasoning-only responses without logging private text", async () => {
  const privateReasoning = "PRIVATE_PROVIDER_REASONING_MUST_NOT_BE_RETURNED";
  const report = await runModelProviderSmoke({
    env: { OPENROUTER_API_KEY: "test-secret", OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: null, reasoning: privateReasoning } }]
    }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })
  });
  assert.equal(report.status, "failed");
  assert.equal(report.attempts[0].code, "COMPLETION_TRUNCATED");
  assert.equal(report.attempts[0].finishReason, "length");
  assert.equal(report.attempts[0].contentShape, "missing");
  assert.equal(report.attempts[0].contentLength, 0);
  assert.equal(report.attempts[0].reasoningPresent, true);
  assert.equal(report.attempts[0].contentType, "application/json");
  assert.equal(JSON.stringify(report).includes(privateReasoning), false);
  assert.equal(JSON.stringify(report).includes("test-secret"), false);
});
