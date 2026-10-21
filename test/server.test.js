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

test("model discovery returns only model identifiers from the configured provider", async () => {
  const app = createApp({
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://router.bynara.id/v1/models");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b", owned_by: "provider" }, { name: "bad-entry" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/models", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { models: ["model-a", "model-b"], defaultModel: "test-model" });
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

test("Supabase conversation APIs require an authenticated user and respect the caller JWT", async () => {
  let restRequest;
  const supabaseEnv = {
    ...env,
    SUPABASE_URL: "https://ultron-test.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
  };
  const app = createApp({
    env: supabaseEnv,
    fetchImpl: async (url, options = {}) => {
      if (url === "https://ultron-test.supabase.co/auth/v1/user") {
        assert.equal(options.headers.Authorization, "Bearer test-user-token");
        return new Response(JSON.stringify({ id: "123e4567-e89b-12d3-a456-426614174000", email: "operator@example.test" }), { status: 200 });
      }
      if (url.startsWith("https://ultron-test.supabase.co/rest/v1/conversations")) {
        restRequest = { url, options };
        return new Response(JSON.stringify([{ id: "123e4567-e89b-12d3-a456-426614174001", title: "Hello", created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" }]), { status: 200 });
      }
      throw new Error("Unexpected mocked URL: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const denied = await fetch(base + "/api/conversations");
    assert.equal(denied.status, 401);
    const response = await fetch(base + "/api/conversations", { headers: { Cookie: "ultron_sb_access=test-user-token" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).conversations[0].title, "Hello");
    assert.equal(restRequest.options.headers.apikey, "sb_publishable_test");
    assert.equal(restRequest.options.headers.Authorization, "Bearer test-user-token");
  });
});

test("Supabase signup validates credentials before making an upstream request", async () => {
  let calls = 0;
  const app = createApp({
    env: { ...env, SUPABASE_URL: "https://ultron-test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
    fetchImpl: async () => { calls++; throw new Error("unexpected upstream call"); },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "short" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
    assert.equal(calls, 0);
  });
});

test("expired Supabase access tokens refresh before database requests", async () => {
  const supabaseEnv = { ...env, SUPABASE_URL: "https://ultron-test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
  let restAuthorization = "";
  const app = createApp({
    env: supabaseEnv,
    fetchImpl: async (url, options = {}) => {
      if (url === "https://ultron-test.supabase.co/auth/v1/user") {
        return new Response(JSON.stringify({ message: "expired" }), { status: 401 });
      }
      if (url === "https://ultron-test.supabase.co/auth/v1/token?grant_type=refresh_token") {
        assert.equal(JSON.parse(options.body).refresh_token, "old-refresh");
        return new Response(JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
          user: { id: "123e4567-e89b-12d3-a456-426614174000", email: "operator@example.test" }
        }), { status: 200 });
      }
      if (url.startsWith("https://ultron-test.supabase.co/rest/v1/conversations")) {
        restAuthorization = options.headers.Authorization;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error("Unexpected mocked URL: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/conversations", {
      headers: { Cookie: "ultron_sb_access=old-access; ultron_sb_refresh=old-refresh" }
    });
    assert.equal(response.status, 200);
    assert.equal(restAuthorization, "Bearer fresh-access");
    assert.match(response.headers.get("set-cookie") || "", /ultron_sb_access=fresh-access/);
  });
});
