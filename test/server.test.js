import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server.js";

async function withServer(app, fn) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await fn("http://127.0.0.1:" + address.port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const env = {
  NODE_ENV: "test",
  APP_ACCESS_PASSWORD: "test-password",
  SESSION_SECRET: "a".repeat(48),
  NARA_ROUTER_BASE_URL: "https://router.bynara.id/v1",
  NARA_ROUTER_API_KEY: "test-key",
  NARA_ROUTER_DEFAULT_MODEL: "test-model",
  NARA_ROUTER_TIMEOUT_SECONDS: "10"
};
async function login(base) {
  const response = await fetch(base + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: env.APP_ACCESS_PASSWORD })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("health reports configuration without exposing secrets", async () => {
  await withServer(createApp({ env, logger: { warn() {}, error() {} } }), async base => {
    const response = await fetch(base + "/api/health");
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.status, "ok");
    assert.equal(data.providerConfigured, true);
    assert.equal(JSON.stringify(data).includes("test-key"), false);
  });
});

test("chat is gated until a valid session is supplied", async () => {
  await withServer(createApp({ env, logger: { warn() {}, error() {} } }), async base => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
  });
});

test("chat rejects malformed messages before provider call", async () => {
  let calls = 0;
  const app = createApp({ env, fetchImpl: async () => { calls++; throw new Error("should not run"); }, logger: { warn() {}, error() {} } });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "system", content: 123 }] })
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test("chat calls NaraRouter with a server-side key and returns the mocked response", async () => {
  let seen;
  const app = createApp({
    env,
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Hello from mocked model" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], stream: false })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, "Hello from mocked model");
    assert.equal(seen.url, "https://router.bynara.id/v1/chat/completions");
    assert.equal(seen.options.headers.Authorization, "Bearer test-key");
    assert.equal(JSON.parse(seen.options.body).model, "test-model");
  });
});

test("provider authentication failures do not return secret values", async () => {
  const app = createApp({
    env,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "private provider diagnostics" } }), { status: 401 }),
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], stream: false })
    });
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error.code, "PROVIDER_AUTH");
    assert.equal(JSON.stringify(payload).includes("test-key"), false);
  });
});

test("missing access password fails closed", async () => {
  const app = createApp({ env: { ...env, APP_ACCESS_PASSWORD: "" }, logger: { warn() {}, error() {} } });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "ACCESS_NOT_CONFIGURED");
  });
});
