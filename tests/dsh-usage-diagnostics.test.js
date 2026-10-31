import test from "node:test";
import assert from "node:assert/strict";
import {
  recordUsageTurn,
  getUsageSummary,
  getRecentRequests,
  clearUsage,
} from "../integrations/dsh-god/usage-monitor.js";
import { classifyError, ERROR_CODES } from "../integrations/dsh-god/model-diagnostics.js";

test("DSH Usage Diagnostics: records turn metrics, token counts, and calculates summary", () => {
  clearUsage();

  recordUsageTurn({
    model: "opencode:deepseek-chat",
    channel: "free",
    latencyMs: 340,
    ttftMs: 120,
    success: true,
    tokens: { prompt_tokens: 100, completion_tokens: 50 },
  });

  recordUsageTurn({
    model: "combo:fast-free",
    underlyingModel: "kilo:free-qwen",
    channel: "combo",
    latencyMs: 450,
    ttftMs: 160,
    success: true,
    tokens: { prompt_tokens: 80, completion_tokens: 40 },
  });

  recordUsageTurn({
    model: "groq/llama-3.3-70b-versatile",
    channel: "aggregate",
    latencyMs: 110,
    success: false,
    error: "Connection refused",
  });

  const summary = getUsageSummary();
  assert.equal(summary.totalRequests, 3);
  assert.equal(summary.successfulRequests, 2);
  assert.equal(summary.failedRequests, 1);
  assert.equal(summary.totalTokensUsed, 270);
  assert.ok(summary.averageLatencyMs > 0);

  const recent = getRecentRequests(10);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].model, "groq/llama-3.3-70b-versatile");

  clearUsage();
  assert.equal(getUsageSummary().totalRequests, 0);
});

test("DSH Failure Classifier: maps HTTP statuses and errors to standard codes", () => {
  const rateLimit = classifyError(429, "FreeUsageLimitError: per-session quota reached");
  assert.equal(rateLimit.code, ERROR_CODES.RATE_LIMIT);
  assert.equal(rateLimit.retryable, true);

  const freeTierGate = classifyError(403, "FreeTierError: fingerprint tool mismatch");
  assert.equal(freeTierGate.code, ERROR_CODES.FREE_TIER_GATE);
  assert.equal(freeTierGate.retryable, false);

  const regionError = classifyError(403, "RegionError: unsupported country");
  assert.equal(regionError.code, ERROR_CODES.REGION_REFUSAL);

  const authError = classifyError(401, "Unauthorized: invalid API key sk-12345");
  assert.equal(authError.code, ERROR_CODES.AUTH_REFUSAL);
  assert.ok(!authError.message.includes("sk-12345")); // Key must be redacted

  const serverError = classifyError(503, "Service temporarily unavailable");
  assert.equal(serverError.code, ERROR_CODES.UPSTREAM_5XX);
  assert.equal(serverError.retryable, true);

  const timeoutError = classifyError(408, "The request timed out");
  assert.equal(timeoutError.code, ERROR_CODES.TIMEOUT);
});
