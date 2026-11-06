import test from "node:test";
import assert from "node:assert/strict";
import { runModelProviderSmoke } from "../scripts/model-provider-smoke.mjs";

test("Live AI inference acceptance: executes authenticated live inference or blocks cleanly without mock substitution", async () => {
  const hasLiveSecret = Boolean(
    (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()) ||
    (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) ||
    (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() && !process.env.GEMINI_API_KEY.startsWith("ya29.") && !process.env.GEMINI_API_KEY.startsWith("AQ."))
  );

  if (hasLiveSecret) {
    // When real credentials are provided in the environment, run genuine live inference without mocks
    const report = await runModelProviderSmoke({ env: process.env });
    assert.ok(report);
    assert.ok(["passed", "failed", "blocked"].includes(report.status));

    // Secret protection: absolutely no configured API keys must appear anywhere in the serialized report
    for (const envKey of ["OPENROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY"]) {
      const val = process.env[envKey];
      if (val && val.length > 5) {
        assert.equal(
          JSON.stringify(report).includes(val),
          false,
          `Configured secret from ${envKey} must never appear in report output`
        );
      }
    }
  } else {
    // In unconfigured / offline test environments, verify that the smoke check fails closed and NEVER fabricates fake completions
    const report = await runModelProviderSmoke({ env: {} });
    assert.equal(report.status, "blocked");
    assert.equal(report.reason, "NO_ELIGIBLE_PROVIDER");
    assert.equal(report.completionReceived, undefined, "Must never fabricate mock completion when unconfigured");
  }
});

test("Live AI inference acceptance: credential masking and secret zero-leakage guarantee", async () => {
  const secretKey = "mock_test_token_provider_key_never_leak_98765";
  const fakeEnv = {
    OPENROUTER_API_KEY: secretKey,
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free"
  };

  let capturedAuthHeader = null;
  const mockFetch = async (url, init) => {
    capturedAuthHeader = init?.headers?.Authorization;
    return new Response(JSON.stringify({
      model: "openrouter/free",
      choices: [{ message: { content: "ULTRON_SMOKE_OK" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const report = await runModelProviderSmoke({ env: fakeEnv, fetchImpl: mockFetch });
  assert.equal(report.status, "passed");
  assert.equal(report.completionReceived, true);
  assert.equal(capturedAuthHeader, "Bearer " + secretKey);

  // Masking verification: verify zero secret leakage in JSON report
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(secretKey), false, "Secret must never be present in the report JSON");
  assert.equal(serialized.includes("never_leak"), false);
  assert.equal(serialized.includes("ULTRON_SMOKE_OK"), false, "Challenge token must not be leaked in output");
});

test("Live AI inference acceptance: enforces provider fallback without claiming false durability", async () => {
  const primarySecret = "mock_primary_openrouter_secret_test_key_111";
  const fallbackSecret = "mock_fallback_groq_secret_test_key_222";

  const fakeEnv = {
    OPENROUTER_API_KEY: primarySecret,
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    GROQ_API_KEY: fallbackSecret,
    GROQ_DEFAULT_MODEL: "llama-3.3-70b-versatile"
  };

  let attemptCount = 0;
  const mockFetch = async (url) => {
    attemptCount++;
    if (url.includes("openrouter.ai")) {
      // Primary provider rate limits (429)
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), { status: 429 });
    }
    // Fallback succeeds with verified challenge token
    return new Response(JSON.stringify({
      model: "llama-3.3-70b-versatile",
      choices: [{ message: { content: "ULTRON_SMOKE_OK" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const report = await runModelProviderSmoke({ env: fakeEnv, fetchImpl: mockFetch });
  assert.equal(report.status, "passed");
  assert.equal(report.provider, "groq");
  assert.equal(report.successfulAttempt, 2);
  assert.equal(attemptCount, 2);

  const reportJson = JSON.stringify(report);
  assert.equal(reportJson.includes(primarySecret), false);
  assert.equal(reportJson.includes(fallbackSecret), false);
  assert.equal(reportJson.includes("ULTRON_SMOKE_OK"), false);
});
