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
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_DEFAULT_MODEL: "test-model",
  OPENROUTER_TIMEOUT_SECONDS: "10"
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

test("integration catalog requires an authenticated session", async () => {
  await withServer(createApp({ env, logger: { warn() {}, error() {} } }), async base => {
    const response = await fetch(base + "/api/integrations");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
  });
});

test("integration catalog reports readiness without exposing secret values", async () => {
  const configuredEnv = {
    ...env,
    COMFYUI_BASE_URL: "https://comfy.example.test",
    HEYGEM_API_BASE_URL: "https://avatar.example.test",
    HEYGEM_API_KEY: "private-heygem-secret",
    HEYGEM_JOB_PATH: "/api/generate",
    OMNIVOICE_API_BASE_URL: "https://voice.example.test",
    OMNIVOICE_API_KEY: "private-voice-secret",
    OMNIVOICE_SYNTHESIS_PATH: "/synthesize",
    ULTRON_EMPLOYEES_ENABLED: "true",
    GEO_SLEUTH_ENABLED: "true",
    GEO_SLEUTH_ROOT: ".runtime/geo-sleuth/skills/geo-sleuth"
  };
  await withServer(createApp({ env: configuredEnv, logger: { warn() {}, error() {} } }), async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/integrations", { headers: { Cookie: cookie } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.integrations.length, 7);
    assert.equal(payload.integrations.find(item => item.id === "comfyui").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "heygem").state, "configured_unverified");
    assert.equal(payload.integrations.find(item => item.id === "omnivoice").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "handy").state, "desktop_companion_required");
    assert.equal(payload.integrations.find(item => item.id === "ai-employees").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "geo-sleuth").configured, true);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("private-heygem-secret"), false);
    assert.equal(serialized.includes("private-voice-secret"), false);
  });
});

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

test("chat calls OpenRouter with a server-side key and returns the mocked response", async () => {
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
    assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
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

test("chat falls back when OpenRouter denies access to the default model", async () => {
  const attemptedModels = [];
  const app = createApp({
    env,
    fetchImpl: async (_url, options) => {
      const model = JSON.parse(options.body).model;
      attemptedModels.push(model);
      if (model === "test-model") {
        return new Response(JSON.stringify({ error: { code: "model_not_entitled", message: "private provider details" } }), { status: 403 });
      }
      return new Response(JSON.stringify({ model, choices: [{ message: { content: "Fallback worked" } }] }), {
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
    assert.equal((await response.json()).content, "Fallback worked");
    assert.deepEqual(attemptedModels, ["test-model", "openrouter/free"]);
    assert.equal(response.headers.get("x-ultron-fallback"), "true");
  });
});

test("model discovery returns only model identifiers from the configured provider", async () => {
  const app = createApp({
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/models");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      return new Response(JSON.stringify({ data: [{ id: "model-a:free" }, { id: "model-b", pricing: { prompt: "0", completion: "0" }, owned_by: "provider" }, { name: "bad-entry" }] }), {
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
    assert.deepEqual(await response.json(), { models: ["openrouter/free", "model-a:free", "model-b"], defaultModel: "test-model" });
  });
});

test("model gateway rejects private, reserved and credentialed provider URLs before network access", async () => {
  for (const providerUrl of [
    "https://127.0.0.1:8080",
    "https://10.0.0.5/v1",
    "https://192.168.1.4/v1",
    "https://192.0.2.10/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal",
    "https://user:password@openrouter.ai/api/v1",
    "http://openrouter.ai/api/v1"
  ]) {
    let calls = 0;
    const app = createApp({
      env: { ...env, OPENROUTER_BASE_URL: providerUrl, ULTRON_BROWSER_USE_TOKEN: "bridge-test-token" },
      fetchImpl: async () => { calls++; throw new Error("unsafe provider URL must not be contacted"); },
      logger: { warn() {}, error() {} }
    });
    await withServer(app, async base => {
      const response = await fetch(base + "/api/internal/browser-use/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer bridge-test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "test" }] })
      });
      assert.equal(response.status, 500, providerUrl);
      assert.equal((await response.json()).error.type, "provider_config_error", providerUrl);
      assert.equal(calls, 0, providerUrl);
    });
  }
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

test("phone sign-in validates input and completes provider verification", async () => {
  const supabaseEnv = { ...env, SUPABASE_URL: "https://ultron-test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
  const calls = [];
  const app = createApp({
    env: supabaseEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (url.endsWith("/auth/v1/otp")) return new Response(JSON.stringify({ message: "sent" }), { status: 200 });
      if (url.endsWith("/auth/v1/verify")) return new Response(JSON.stringify({ access_token: "access-test", refresh_token: "refresh-test", expires_in: 3600, user: { id: "123e4567-e89b-12d3-a456-426614174000", phone: "+19999999999" } }), { status: 200 });
      throw new Error("Unexpected mocked URL");
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const invalid = await fetch(base + "/api/auth/phone/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "invalid" }) });
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 0);
    const requested = await fetch(base + "/api/auth/phone/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+19999999999" }) });
    assert.equal(requested.status, 200);
    assert.equal((await requested.json()).ok, true);
    assert.deepEqual(calls[0].body, { phone: "+19999999999", create_user: true });
    const repeated = await fetch(base + "/api/auth/phone/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+19999999999" }) });
    assert.equal(repeated.status, 429);
    assert.equal(repeated.headers.get("cache-control"), "no-store");
    assert.ok(Number(repeated.headers.get("retry-after")) > 0);
    assert.equal(calls.length, 1, "cooldown must block the repeated provider request");
    const verified = await fetch(base + "/api/auth/phone/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+19999999999", token: "123456" }) });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).authenticated, true);
    assert.match(verified.headers.get("set-cookie"), /ultron_sb_access=access-test/);
    assert.deepEqual(calls[1].body, { phone: "+19999999999", token: "123456", type: "sms" });
  });
});

test("phone OTP verification rejects malformed codes without contacting Supabase", async () => {
  let calls = 0;
  const app = createApp({
    env: { ...env, SUPABASE_URL: "https://ultron-test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
    fetchImpl: async () => { calls++; throw new Error("invalid OTP must not reach provider"); },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    for (const input of [
      { phone: "not-a-phone", token: "123456" },
      { phone: "+19999999999", token: "abc123" },
      { phone: "+19999999999", token: "123" }
    ]) {
      const response = await fetch(base + "/api/auth/phone/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_PHONE_OTP");
    }
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

test("memory API refuses requests without a Supabase account", async () => {
  let calls = 0;
  const app = createApp({
    env: { ...env, SUPABASE_URL: "https://ultron-test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
    fetchImpl: async () => { calls++; throw new Error("unauthenticated request must not reach Supabase"); },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/memory");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "SUPABASE_AUTH_REQUIRED");
    assert.equal(calls, 0);
  });
});

test("chat uses an explicitly selected allowlisted model", async () => {
  let forwarded;
  const app = createApp({
    env: { ...env, ULTRON_AVAILABLE_MODELS: "poolside/laguna-s-2.1:free,minimax/minimax-m3.1-flash:free" },
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({ model: forwarded.model, choices: [{ message: { content: "Selected model response" } }] }), { status: 200 });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "What is in this picture?" }], model: "minimax/minimax-m3.1-flash:free", stream: false })
    });
    assert.equal(response.status, 200);
    assert.equal(forwarded.model, "minimax/minimax-m3.1-flash:free");
  });
});

test("chat forwards validated image input as multimodal content to the selected model", async () => {
  let forwarded;
  const app = createApp({
    env: { ...env, ULTRON_AVAILABLE_MODELS: "minimax/minimax-m3.1-flash:free" },
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({ model: forwarded.model, choices: [{ message: { content: "A test image." } }] }), { status: 200 });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Describe this." }],
        model: "minimax/minimax-m3.1-flash:free",
        attachments: [{ name: "sample.png", dataUrl: "data:image/png;base64,aGVsbG8=" }],
        stream: false
      })
    });
    assert.equal(response.status, 200);
    const forwardedUser = forwarded.messages.find(message => message.role === "user");
    assert.equal(forwardedUser.content[0].text, "Describe this.");
    assert.equal(forwardedUser.content[1].type, "image_url");
    assert.equal(forwardedUser.content[1].image_url.url, "data:image/png;base64,aGVsbG8=");
  });
});

test("chat rejects image inputs with unsupported data URLs", async () => {
  let calls = 0;
  const app = createApp({
    env,
    fetchImpl: async () => { calls++; throw new Error("must not call provider"); },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Check this." }], attachments: [{ dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }], stream: false })
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});
