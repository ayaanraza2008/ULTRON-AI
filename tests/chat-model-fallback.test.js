import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

const env = {
  NODE_ENV: "test",
  APP_ACCESS_PASSWORD: "test-password",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
  OPENROUTER_API_KEY: "test-provider-key",
  OPENROUTER_DEFAULT_MODEL: "vendor/model-a",
  ULTRON_AVAILABLE_MODELS: "vendor/model-a,vendor/model-b"
};

async function withApp(fetchImpl, run, overrides = {}) {
  const testEnv = { ...env, ...overrides };
  const app = createApp({ env: testEnv, fetchImpl, logger: { warn() {}, error() {} } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const login = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: testEnv.APP_ACCESS_PASSWORD })
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    await run(base, cookie);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function chat(base, cookie) {
  return fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ stream: false, messages: [{ role: "user", content: "Say hello" }] })
  });
}

function success(content) {
  return new Response(JSON.stringify({
    model: "vendor/model-b",
    choices: [{ message: { role: "assistant", content } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("chat falls back to the next model after a network failure", async () => {
  const calls = [];
  await withApp(async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    if (model === "vendor/model-a") throw new TypeError("synthetic network failure");
    return success("Recovered after network failure.");
  }, async (base, cookie) => {
    const response = await chat(base, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered after network failure/);
    assert.equal(response.headers.get("x-ultron-model"), "vendor/model-b");
    assert.equal(response.headers.get("x-ultron-fallback"), "true");
    assert.deepEqual(calls, ["vendor/model-a", "vendor/model-b"]);
  });
});

test("chat falls back when a model returns malformed JSON with HTTP 200", async () => {
  const calls = [];
  await withApp(async (_url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    if (model === "vendor/model-a") return new Response("{malformed", { status: 200 });
    return success("Recovered from malformed JSON.");
  }, async (base, cookie) => {
    const response = await chat(base, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered from malformed JSON/);
    assert.deepEqual(calls, ["vendor/model-a", "vendor/model-b"]);
  });
});

test("chat falls back when a model returns an empty HTTP 200 completion", async () => {
  const calls = [];
  await withApp(async (_url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    if (model === "vendor/model-a") {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), { status: 200 });
    }
    return success("Recovered from an empty completion.");
  }, async (base, cookie) => {
    const response = await chat(base, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered from an empty completion/);
    assert.deepEqual(calls, ["vendor/model-a", "vendor/model-b"]);
  });
});


test("chat falls back from exhausted OpenRouter models to a configured alternate provider", async () => {
  const calls = [];
  const overrides = {
    FALLBACK_API_KEY: "fallback-provider-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "secondary", baseUrl: "https://secondary.example/v1", apiKeyEnv: "FALLBACK_API_KEY", model: "secondary-chat-model", priority: 1 }
    ])
  };
  await withApp(async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push({ url, model, authorization: options.headers.Authorization });
    if (url.startsWith("https://openrouter.ai/")) {
      return new Response(JSON.stringify({ error: { code: "rate_limit" } }), { status: 429 });
    }
    assert.equal(url, "https://secondary.example/v1/chat/completions");
    return success("Secondary provider recovered the chat.");
  }, async (base, cookie) => {
    const response = await chat(base, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Secondary provider recovered the chat/);
    assert.equal(response.headers.get("x-ultron-provider"), "secondary");
    assert.equal(response.headers.get("x-ultron-fallback"), "true");
    assert.deepEqual(calls.map(call => call.model), ["vendor/model-a", "vendor/model-b", "openrouter/free", "secondary-chat-model"]);
    assert.equal(calls.at(-1).authorization, "Bearer fallback-provider-secret");
  }, overrides);
});

test("chat works with a configured alternate provider even when OpenRouter is not configured", async () => {
  const calls = [];
  const overrides = {
    OPENROUTER_API_KEY: "",
    FALLBACK_API_KEY: "fallback-only-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "secondary", baseUrl: "https://secondary.example/v1", apiKeyEnv: "FALLBACK_API_KEY", model: "secondary-chat-model", priority: 1 }
    ])
  };
  await withApp(async (url, options) => {
    calls.push({ url, model: JSON.parse(options.body).model, authorization: options.headers.Authorization });
    return success("Chat works without the primary provider.");
  }, async (base, cookie) => {
    const response = await chat(base, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Chat works without the primary provider/);
    assert.equal(response.headers.get("x-ultron-provider"), "secondary");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "secondary-chat-model");
    assert.equal(calls[0].authorization, "Bearer fallback-only-secret");
  }, overrides);
});


test("chat falls back when a provider times out before returning response headers", async () => {
  const calls = [];
  await withApp(async (_url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    if (model === "vendor/model-a") {
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason || new Error("aborted"));
        options.signal.addEventListener("abort", () => {
          reject(options.signal.reason || new Error("aborted"));
        }, { once: true });
      });
    }
    return success("Recovered after provider first-response timeout.");
  }, async (base, cookie) => {
    const response = await chat(base, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recovered after provider first-response timeout/);
    assert.equal(response.headers.get("x-ultron-model"), "vendor/model-b");
    assert.equal(response.headers.get("x-ultron-fallback"), "true");
    assert.deepEqual(calls, ["vendor/model-a", "vendor/model-b"]);
  }, { OPENROUTER_ATTEMPT_TIMEOUT_MS: "250" });
});


test("chat memory retrieval explicitly scopes its query to the authenticated Supabase user", async () => {
  const supabaseUrl = "https://test-project.supabase.co";
  const requestedMemoryUrls = [];
  await withApp(async (url, options = {}) => {
    if (url === supabaseUrl + "/auth/v1/user") {
      return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith(supabaseUrl + "/rest/v1/user_preferences")) {
      return new Response(JSON.stringify([{ memory_enabled: true }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith(supabaseUrl + "/rest/v1/memory_items")) {
      requestedMemoryUrls.push(url);
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      return success("Memory-scoped response.");
    }
    throw new Error("Unexpected upstream request: " + url);
  }, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie + "; ultron_sb_access=test-access-token"
      },
      body: JSON.stringify({ stream: false, messages: [{ role: "user", content: "Say hello" }] })
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Memory-scoped response/);
    assert.equal(requestedMemoryUrls.length, 1);
    const query = new URL(requestedMemoryUrls[0]).searchParams;
    assert.equal(query.get("user_id"), "eq.user-123");
  }, {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
  });
});


test("chat does not use the integration owner's Hermes provider for another authenticated account", async () => {
  const supabaseUrl = "https://test-project.supabase.co";
  const calls = [];
  const overrides = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    HERMES_AGENT_ENABLED: "true",
    HERMES_AGENT_CHAT_PROVIDER: "true",
    HERMES_AGENT_BASE_URL: "https://hermes.example/v1",
    HERMES_AGENT_API_KEY: "private-hermes-test-key",
    HERMES_AGENT_MODEL: "hermes-agent",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  };
  await withApp(async (url, options = {}) => {
    if (url === supabaseUrl + "/auth/v1/user") {
      return new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000002" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith(supabaseUrl + "/rest/v1/user_preferences")) {
      return new Response(JSON.stringify([{ memory_enabled: false }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    calls.push({ url, authorization: options.headers?.Authorization, model: JSON.parse(options.body || "{}").model });
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-provider-key");
    return success("Fallback provider safely handled this account.");
  }, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie + "; ultron_sb_access=test-access-token"
      },
      body: JSON.stringify({ stream: false, messages: [{ role: "user", content: "Say hello" }] })
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Fallback provider safely handled this account/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  }, overrides);
});
