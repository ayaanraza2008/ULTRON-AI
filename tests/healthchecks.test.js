import test from "node:test";
import assert from "node:assert/strict";
import { createHealthchecksHeartbeat, normalizeHealthchecksPingUrl } from "../integrations/healthchecks.js";

const validUrl = "https://hc-ping.com/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278";

test("Healthchecks ping URL accepts only HTTPS UUID endpoints on hc-ping.com", () => {
  assert.equal(normalizeHealthchecksPingUrl(validUrl), validUrl);
  for (const invalid of [
    "",
    "http://hc-ping.com/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278",
    "https://example.com/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278",
    "https://hc-ping.com/not-a-uuid",
    "https://hc-ping.com/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278?token=other",
    "https://user:pass@hc-ping.com/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278"
  ]) assert.equal(normalizeHealthchecksPingUrl(invalid), null);
});

test("heartbeat sends secret-free HEAD success and failure signals", async () => {
  const calls = [];
  const heartbeat = createHealthchecksHeartbeat({
    url: validUrl,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
    now: () => 100_000
  });
  assert.equal(heartbeat.enabled, true);
  assert.equal(await heartbeat.success(), true);
  assert.equal(calls[0].url, validUrl);
  assert.equal(calls[0].options.method, "HEAD");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(await heartbeat.failure(), false, "rapid state changes are throttled");
  assert.equal(calls.length, 1);
});

test("heartbeat rate-limits repeat signals and allows recovery after the minimum interval", async () => {
  let time = 100_000;
  const calls = [];
  const heartbeat = createHealthchecksHeartbeat({
    url: validUrl,
    fetchImpl: async url => { calls.push(url); return { ok: true, status: 200 }; },
    now: () => time
  });
  assert.equal(await heartbeat.success(), true);
  assert.equal(await heartbeat.success(), false);
  time += 12_000;
  assert.equal(await heartbeat.failure(), true);
  assert.equal(calls[1], validUrl + "/fail");
  time += 60_000;
  assert.equal(await heartbeat.success(), true);
  assert.equal(calls.length, 3);
});

test("missing configuration disables heartbeat without making a network request", async () => {
  let calls = 0;
  const heartbeat = createHealthchecksHeartbeat({
    url: "",
    fetchImpl: async () => { calls += 1; return { ok: true }; }
  });
  assert.equal(heartbeat.enabled, false);
  assert.equal(await heartbeat.success(), false);
  assert.equal(await heartbeat.failure(), false);
  assert.equal(calls, 0);
});

test("monitoring failures never throw into worker control flow", async () => {
  const heartbeat = createHealthchecksHeartbeat({
    url: validUrl,
    fetchImpl: async () => { throw new Error("network unavailable"); },
    logger: { warn() {} }
  });
  assert.equal(await heartbeat.success(), false);
});
