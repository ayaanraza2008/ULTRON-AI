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
    COMFYUI_BASE_URL: "https://comfy.example.com",
    HEYGEM_API_BASE_URL: "https://avatar.example.com",
    HEYGEM_API_KEY: "private-heygem-secret",
    HEYGEM_JOB_PATH: "/api/generate",
    OMNIVOICE_API_BASE_URL: "https://voice.example.com",
    OMNIVOICE_API_KEY: "private-voice-secret",
    OMNIVOICE_SYNTHESIS_PATH: "/synthesize",
    ULTRON_EMPLOYEES_ENABLED: "true",
    GEO_SLEUTH_ENABLED: "true",
    GEO_SLEUTH_ROOT: ".runtime/geo-sleuth/skills/geo-sleuth",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
    OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp",
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    PAPERCLIP_BASE_URL: "https://paperclip.example.com",
    PAPERCLIP_API_TOKEN: "private-paperclip-secret",
    PAPERCLIP_COMPANY_ID: "company-123"
  };
  await withServer(createApp({ env: configuredEnv, logger: { warn() {}, error() {} } }), async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/integrations", { headers: { Cookie: cookie } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.integrations.length, 15);
    assert.equal(payload.integrations.find(item => item.id === "comfyui").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "heygem").state, "configured_unverified");
    assert.equal(payload.integrations.find(item => item.id === "omnivoice").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "handy").state, "desktop_companion_required");
    assert.equal(payload.integrations.find(item => item.id === "ai-employees").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "geo-sleuth").configured, true);
    assert.equal(payload.integrations.find(item => item.id === "obscura").state, "configured_unverified");
    assert.equal(payload.integrations.find(item => item.id === "cactus-compute").state, "configured_unverified");
    assert.equal(payload.integrations.find(item => item.id === "paperclip").state, "configured_unverified");
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("private-heygem-secret"), false);
    assert.equal(serialized.includes("private-voice-secret"), false);
    assert.equal(serialized.includes("private-paperclip-secret"), false);
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

test("Cactus can serve a normal streaming chat locally without an API key", async () => {
  let seen;
  const cactusEnv = {
    ...env,
    OPENROUTER_API_KEY: "",
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    CACTUS_CONFIDENCE_THRESHOLD: "0.72"
  };
  const app = createApp({
    env: cactusEnv,
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return new Response(JSON.stringify({
        model: "Cactus-Compute/needle",
        confidence: 0.95,
        cloud_handoff: false,
        choices: [{ message: { role: "assistant", content: "Local Cactus response." } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    logger: { warn() {}, error() {}, info() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], stream: true })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ultron-provider"), "cactus");
    const body = await response.text();
    assert.match(body, /Local Cactus response/);
    assert.match(body, /event: done/);
    assert.equal(seen.url, "http://127.0.0.1:8080/v1/chat/completions");
    assert.equal(JSON.parse(seen.options.body).stream, false);
    assert.equal(seen.options.headers.Authorization, undefined);
  });
});

test("Cactus chat falls back to the configured cloud provider when confidence is low", async () => {
  const attempts = [];
  const cactusEnv = {
    ...env,
    OPENROUTER_API_KEY: "test-key",
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    CACTUS_CONFIDENCE_THRESHOLD: "0.72"
  };
  const app = createApp({
    env: cactusEnv,
    fetchImpl: async (url, options) => {
      attempts.push(url);
      if (url === "http://127.0.0.1:8080/v1/chat/completions") {
        return new Response(JSON.stringify({
          confidence: 0.2, cloud_handoff: false,
          choices: [{ message: { role: "assistant", content: "Low confidence answer." } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      return new Response(JSON.stringify({
        model: "test-model", choices: [{ message: { role: "assistant", content: "Fallback from OpenRouter." } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    logger: { warn() {}, error() {}, info() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], stream: false })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, "Fallback from OpenRouter.");
    assert.equal(response.headers.get("x-ultron-provider"), "openrouter");
    assert.equal(response.headers.get("x-ultron-fallback"), "true");
    assert.deepEqual(attempts, [
      "http://127.0.0.1:8080/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions"
    ]);
  });
});

test("Cactus cloud handoff is blocked by default and falls back to the configured provider", async () => {
  const attempts = [];
  const cactusEnv = {
    ...env,
    OPENROUTER_API_KEY: "test-key",
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle"
  };
  const app = createApp({
    env: cactusEnv,
    fetchImpl: async url => {
      attempts.push(url);
      if (url.startsWith("http://127.0.0.1:8080/")) {
        return new Response(JSON.stringify({
          confidence: 0.99, cloud_handoff: true,
          choices: [{ message: { role: "assistant", content: "Do not use this handoff answer." } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        model: "test-model", choices: [{ message: { role: "assistant", content: "Fallback after handoff was blocked." } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    logger: { warn() {}, error() {}, info() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], stream: false })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, "Fallback after handoff was blocked.");
    assert.equal(response.headers.get("x-ultron-provider"), "openrouter");
    assert.deepEqual(attempts, [
      "http://127.0.0.1:8080/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions"
    ]);
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

test("model discovery supports a configured alternate provider without OpenRouter", async () => {
  const alternateEnv = {
    ...env,
    OPENROUTER_API_KEY: "",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      model: "llama-3.3-70b-versatile",
      priority: 1,
      supportsVision: false
    }]),
    GROQ_API_KEY: "synthetic-groq-key"
  };
  const app = createApp({ env: alternateEnv, fetchImpl: async () => { throw new Error("No upstream discovery should be needed"); }, logger: { warn() {}, error() {} } });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/models", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, {
      models: ["ultron/groq/llama-3.3-70b-versatile"],
      defaultModel: "ultron/groq/llama-3.3-70b-versatile"
    });
    assert.equal(JSON.stringify(payload).includes("synthetic-groq-key"), false);
  });
});

test("model discovery includes configured alternate model options alongside free OpenRouter models", async () => {
  const alternateEnv = {
    ...env,
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      model: "llama-3.3-70b-versatile",
      priority: 1
    }]),
    GROQ_API_KEY: "synthetic-groq-key"
  };
  const app = createApp({
    env: alternateEnv,
    fetchImpl: async url => {
      assert.equal(url, "https://openrouter.ai/api/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "test-free-model:free" }] }), { status: 200 });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/models", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      models: ["openrouter/free", "test-free-model:free", "ultron/groq/llama-3.3-70b-versatile"],
      defaultModel: "test-model"
    });
  });
});

test("chat honors a selected alternate provider model before trying fallbacks", async () => {
  const calls = [];
  const alternateEnv = {
    ...env,
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      model: "llama-3.3-70b-versatile",
      priority: 1
    }]),
    GROQ_API_KEY: "synthetic-groq-key"
  };
  const app = createApp({
    env: alternateEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, authorization: options.headers?.Authorization, model: JSON.parse(options.body || "{}").model });
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer synthetic-groq-key");
      assert.equal(JSON.parse(options.body).model, "llama-3.3-70b-versatile");
      return new Response(JSON.stringify({
        model: "llama-3.3-70b-versatile",
        choices: [{ message: { role: "assistant", content: "Selected alternate provider responded." } }]
      }), { status: 200 });
    },
    logger: { warn() {}, error() {}, info() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        model: "ultron/groq/llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Say hello." }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, "Selected alternate provider responded.");
    assert.equal(response.headers.get("x-ultron-provider"), "groq");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  });
});


test("model discovery falls back to configured alternate models when OpenRouter denies discovery", async () => {
  const alternateEnv = {
    ...env,
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      model: "llama-3.3-70b-versatile",
      priority: 1
    }]),
    GROQ_API_KEY: "synthetic-groq-key"
  };
  const app = createApp({
    env: alternateEnv,
    fetchImpl: async url => {
      assert.equal(url, "https://openrouter.ai/api/v1/models");
      return new Response(JSON.stringify({ error: { message: "Synthetic model-list denial." } }), { status: 403 });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/models", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      models: ["ultron/groq/llama-3.3-70b-versatile"],
      defaultModel: "ultron/groq/llama-3.3-70b-versatile"
    });
  });
});

test("model discovery preserves usable options when OpenRouter model listing is unreachable", async () => {
  const alternateEnv = {
    ...env,
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      model: "llama-3.3-70b-versatile",
      priority: 1
    }]),
    GROQ_API_KEY: "synthetic-groq-key"
  };
  const app = createApp({
    env: alternateEnv,
    fetchImpl: async () => { throw new TypeError("Synthetic connection failure"); },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/models", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      models: ["openrouter/free", "ultron/groq/llama-3.3-70b-versatile"],
      defaultModel: "test-model"
    });
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

test("task creation, approval, cancellation and audit use the correct Supabase role", async () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const taskCreateId = "123e4567-e89b-12d3-a456-426614174010";
  const taskApproveId = "123e4567-e89b-12d3-a456-426614174011";
  const taskCancelId = "123e4567-e89b-12d3-a456-426614174012";
  const serviceKey = "test-only-server-role-key";
  const clientToken = "test-only-user-token";
  const calls = [];
  const pendingTask = {
    id: taskApproveId, user_id: userId, title: "Draft brief",
    input: { taskType: "employee", executionMode: "employee_worker", role: "seo-aeo", goal: "Draft a brief", mode: "draft", requiresApproval: true, approved: false },
    status: "WAITING_FOR_PERMISSION"
  };
  const app = createApp({
    env: {
      ...env,
      SUPABASE_URL: "https://ultron-test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: serviceKey
    },
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl);
      const method = options.method || "GET";
      const authorization = options.headers?.Authorization || "";
      calls.push({ path: url.pathname, method, query: url.search, authorization, apikey: options.headers?.apikey, body: options.body ? JSON.parse(options.body) : undefined });

      if (url.pathname === "/auth/v1/user" && method === "GET") {
        assert.equal(authorization, "Bearer " + clientToken);
        assert.equal(options.headers.apikey, "sb_publishable_test");
        return new Response(JSON.stringify({ id: userId, email: "operator@example.test" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/rest/v1/agent_tasks" && method === "POST") {
        assert.equal(authorization, "Bearer " + clientToken, "task insertion remains user-scoped");
        assert.equal(url.searchParams.get("select"), "id,title,input,status,created_at");
        assert.equal(calls.at(-1).body.user_id, userId);
        return new Response(JSON.stringify([{
          id: taskCreateId, title: calls.at(-1).body.title, input: calls.at(-1).body.input,
          status: calls.at(-1).body.status, created_at: "2026-10-25T09:00:00Z"
        }]), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/rest/v1/agent_tasks" && method === "GET") {
        assert.equal(authorization, "Bearer " + clientToken, "task approval lookup stays owner-authenticated");
        assert.match(url.search, new RegExp("user_id=eq\\." + userId));
        assert.match(url.search, new RegExp("id=eq\\." + taskApproveId));
        return new Response(JSON.stringify([pendingTask]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/rest/v1/agent_tasks" && method === "PATCH") {
        assert.equal(authorization, "Bearer " + serviceKey, "guarded state transitions must use server role");
        assert.equal(options.headers.apikey, serviceKey);
        assert.match(url.search, new RegExp("user_id=eq\\." + userId));
        if (url.search.includes(taskApproveId)) {
          assert.match(url.search, /status=eq\.WAITING_FOR_PERMISSION/);
          const updated = { ...pendingTask, ...calls.at(-1).body };
          return new Response(JSON.stringify([updated]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.search.includes(taskCancelId)) {
          assert.match(url.search, /status=in\.\(QUEUED,WAITING_FOR_PERMISSION\)/);
          return new Response(JSON.stringify([{ id: taskCancelId, status: "CANCELLED" }]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error("Unexpected privileged task update.");
      }
      if (url.pathname === "/rest/v1/audit_events" && method === "POST") {
        assert.equal(authorization, "Bearer " + serviceKey, "audit events must be server-authored");
        assert.equal(options.headers.apikey, serviceKey);
        assert.equal(calls.at(-1).body.user_id, userId);
        return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected mocked Supabase request: " + method + " " + rawUrl);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = "ultron_sb_access=" + clientToken;
    const created = await fetch(base + "/api/tasks", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Research a public topic", description: "Collect a concise source-backed overview", taskType: "research", query: "public documentation" })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).task.id, taskCreateId);

    const approved = await fetch(base + "/api/tasks/" + taskApproveId + "/approve", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true })
    });
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.task.status, "QUEUED");
    assert.equal(approvedBody.task.input.approved, true);

    const cancelled = await fetch(base + "/api/tasks/" + taskCancelId + "/cancel", {
      method: "POST", headers: { Cookie: cookie }
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).task.status, "CANCELLED");

    const auditCalls = calls.filter(call => call.path === "/rest/v1/audit_events");
    assert.deepEqual(auditCalls.map(call => call.body.action), ["task.created", "task.approved", "task.cancelled"]);
    assert.equal(calls.some(call => call.authorization === "Bearer " + serviceKey && call.path === "/rest/v1/agent_tasks" && call.method === "POST"), false);
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
        attachments: [{ name: "sample.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfS8AAAAASUVORK5CYII=" }],
        stream: false
      })
    });
    assert.equal(response.status, 200);
    const forwardedUser = forwarded.messages.find(message => message.role === "user");
    assert.equal(forwardedUser.content[0].text, "Describe this.");
    assert.equal(forwardedUser.content[1].type, "image_url");
    assert.equal(forwardedUser.content[1].image_url.url, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfS8AAAAASUVORK5CYII=");
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


test("chat falls back to the next model when a streaming provider closes immediately", async () => {
  const calls = [];
  const configuredEnv = {
    ...env,
    OPENROUTER_DEFAULT_MODEL: "first-model",
    ULTRON_AVAILABLE_MODELS: "first-model,second-model"
  };
  const app = createApp({
    env: configuredEnv,
    fetchImpl: async (_url, options) => {
      const model = JSON.parse(options.body).model;
      calls.push(model);
      if (model === "first-model") {
        return new Response(new ReadableStream({
          start(controller) { controller.close(); }
        }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response(
        'data: {"choices":[{"delta":{"content":"Recovered streamed answer."}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    },
    logger: { warn() {}, error() {} }
  });

  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Say hello" }],
        stream: true
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ultron-model"), "second-model");
    assert.equal(response.headers.get("x-ultron-fallback"), "true");
    assert.match(await response.text(), /Recovered streamed answer/);
    assert.deepEqual(calls, ["first-model", "second-model"]);
  });
});

test("Hermes Agent API is a first-class normal chat provider for its configured owner", async () => {
  let seen;
  const supabaseUrl = "https://test-project.supabase.co";
  const ownerId = "00000000-0000-4000-8000-000000000001";
  const configuredEnv = {
    ...env,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    HERMES_AGENT_ENABLED: "true",
    HERMES_AGENT_CHAT_PROVIDER: "true",
    HERMES_AGENT_BASE_URL: "https://hermes.example.com/v1",
    HERMES_AGENT_API_KEY: "private-hermes-test-key",
    HERMES_AGENT_MODEL: "hermes-agent",
    HERMES_AGENT_PRIORITY: "-5"
  };
  const app = createApp({
    env: configuredEnv,
    fetchImpl: async (url, options = {}) => {
      if (url === supabaseUrl + "/auth/v1/user") {
        return new Response(JSON.stringify({ id: ownerId }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith(supabaseUrl + "/rest/v1/user_preferences")) {
        return new Response(JSON.stringify([{ memory_enabled: false }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      seen = { url, options, body: JSON.parse(options.body) };
      assert.equal(url, "https://hermes.example.com/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer private-hermes-test-key");
      return new Response(JSON.stringify({
        model: "hermes-agent",
        choices: [{ message: { role: "assistant", content: "Hermes completed the tool-enabled agent turn." } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    logger: { warn() {}, error() {}, info() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie + "; ultron_sb_access=test-access-token" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Research how the official API works." }], stream: false })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ultron-provider"), "hermes-agent");
    assert.equal((await response.json()).content, "Hermes completed the tool-enabled agent turn.");
    assert.equal(seen.body.model, "hermes-agent");
    assert.equal(seen.body.stream, false);
    assert.equal(seen.body.messages.some(message => message.role === "system"), true);
  });
});



test("chat dispatcher rejects private HTTPS alternate providers before sending credentials", async () => {
  let providerCalls = 0;
  const configuredEnv = {
    ...env,
    OPENROUTER_API_KEY: "",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      {
        name: "private-upstream",
        baseUrl: "https://192.168.1.10/v1",
        apiKeyEnv: "PRIVATE_UPSTREAM_KEY",
        model: "synthetic-model",
        priority: 1
      },
      {
        name: "metadata-upstream",
        baseUrl: "https://169.254.169.254/latest/meta-data",
        apiKeyEnv: "METADATA_UPSTREAM_KEY",
        model: "synthetic-model",
        priority: 2
      }
    ]),
    PRIVATE_UPSTREAM_KEY: "synthetic-private-token",
    METADATA_UPSTREAM_KEY: "synthetic-metadata-token"
  };
  const app = createApp({
    env: configuredEnv,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("Unsafe configured provider must never be contacted.");
    },
    logger: { info() {}, warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const cookie = await login(base);
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Hello" }]
      })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "PROVIDER_NOT_CONFIGURED");
    assert.equal(providerCalls, 0);
  });
});
