import test from "node:test";
import assert from "node:assert/strict";
import { getChromeDevToolsReadiness, runChromeDevToolsAction } from "../integrations/chrome-devtools.js";

const owner = "00000000-0000-4000-8000-000000000001";
const env = {
  ULTRON_CHROME_DEVTOOLS_URL: "https://chrome-bridge.example.com",
  ULTRON_CHROME_DEVTOOLS_TOKEN: "a-test-token-that-is-long-enough-for-the-bridge",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};

test("Chrome DevTools readiness never exposes the configured token", () => {
  const readiness = getChromeDevToolsReadiness(env, owner);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.ownerAuthorized, true);
  assert.equal(readiness.state, "configured_unverified");
  assert.equal(JSON.stringify(readiness).includes(env.ULTRON_CHROME_DEVTOOLS_TOKEN), false);
});

test("Chrome DevTools is blocked for a non-owner before making a network request", async () => {
  let calls = 0;
  const result = await runChromeDevToolsAction({
    env,
    userId: "00000000-0000-4000-8000-000000000002",
    input: { action: "status" },
    fetchImpl: async () => { calls += 1; return new Response("{}"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(calls, 0);
});

test("Chrome DevTools action sends the allowlisted action with server-side token", async () => {
  let captured;
  const result = await runChromeDevToolsAction({
    env,
    userId: owner,
    input: { action: "navigate", url: "https://example.com" },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true, result: { state: "completed", url: "https://example.com/" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(captured.url, "https://chrome-bridge.example.com/action");
  assert.equal(captured.options.headers.Authorization, "Bearer " + env.ULTRON_CHROME_DEVTOOLS_TOKEN);
  assert.equal(captured.options.redirect, "error");
  assert.deepEqual(JSON.parse(captured.options.body), { action: "navigate", url: "https://example.com" });
  assert.equal(JSON.stringify(result).includes(env.ULTRON_CHROME_DEVTOOLS_TOKEN), false);
});

test("Chrome DevTools adapter rejects unsupported actions before network access", async () => {
  let calls = 0;
  await assert.rejects(() => runChromeDevToolsAction({
    env,
    userId: owner,
    input: { action: "evaluate_javascript", script: "alert(1)" },
    fetchImpl: async () => { calls += 1; return new Response("{}"); }
  }), /Unsupported Chrome DevTools action/);
  assert.equal(calls, 0);
});

test("Chrome DevTools is unavailable without a strong token or secure endpoint", () => {
  assert.equal(getChromeDevToolsReadiness({ ...env, ULTRON_CHROME_DEVTOOLS_TOKEN: "short" }, owner).configured, false);
  assert.equal(getChromeDevToolsReadiness({ ...env, ULTRON_CHROME_DEVTOOLS_URL: "http://example.com" }, owner).configured, false);
});
