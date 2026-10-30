import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function withApp(env, fetchImpl, run) {
  const app = createApp({ env, fetchImpl, logger: { warn() {} } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const login = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.APP_ACCESS_PASSWORD })
    });
    assert.equal(login.status, 200, "test session should authenticate");
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("ultron_session="), "session cookie should be present");
    await run(base, cookie);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function fakeChatFetch(seen) {
  return async (_url, options) => {
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      model: seen.at(-1).model,
      choices: [{ message: { content: "Test response" } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

const baseEnv = {
  APP_ACCESS_PASSWORD: "test-password",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
  OPENROUTER_API_KEY: "test-provider-key",
  OPENROUTER_DEFAULT_MODEL: "vendor/text-model",
  ULTRON_AVAILABLE_MODELS: "vendor/text-model,vendor/vision-a:free,vendor/vision-b:free",
  ULTRON_VISION_MODELS: "vendor/vision-a:free,vendor/vision-b:free"
};

test("chat with image attachments prefers explicitly configured vision models", async () => {
  const seen = [];
  await withApp({ ...baseEnv }, fakeChatFetch(seen), async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Describe this image" }],
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, "vendor/vision-a:free");
    assert.equal(seen[0].messages.at(-1).content[1].image_url.url, "data:image/png;base64,aGVsbG8=");
  });
});

test("text-only chat keeps the normal default model when vision models are configured", async () => {
  const seen = [];
  await withApp({ ...baseEnv }, fakeChatFetch(seen), async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Hello ULTRON" }],
        attachments: []
      })
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, "vendor/text-model");
  });
});

test("image chat does not silently fall back to text-only model IDs", async () => {
  const seen = [];
  const fetchImpl = async (_url, options) => {
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ error: { code: "model_unavailable" } }), { status: 404, headers: { "Content-Type": "application/json" } });
  };
  await withApp({ ...baseEnv }, fetchImpl, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "What is shown?" }],
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }]
      })
    });
    assert.equal(response.status, 502);
    assert.deepEqual(seen.map(item => item.model), ["vendor/vision-a:free", "vendor/vision-b:free"]);
  });
});


test("image chat refuses to send image bytes to an OpenRouter text model when no vision model is configured", async () => {
  const seen = [];
  const fetchImpl = async (_url, options) => {
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Should not be reached" } }] }), { status: 200 });
  };
  await withApp({
    ...baseEnv,
    ULTRON_VISION_MODELS: "",
    OPENROUTER_VISION_MODEL: "",
    ULTRON_AVAILABLE_MODELS: "vendor/text-model"
  }, fetchImpl, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Describe this image" }],
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }]
      })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "VISION_MODEL_NOT_CONFIGURED");
    assert.equal(seen.length, 0, "no text-only model should receive the image request");
  });
});

test("image chat permits an explicitly vision-enabled alternate provider", async () => {
  const seen = [];
  const visionEnv = {
    ...baseEnv,
    ULTRON_VISION_MODELS: "",
    OPENROUTER_VISION_MODEL: "",
    ULTRON_AVAILABLE_MODELS: "vendor/text-model",
    ALT_VISION_KEY: "alternate-vision-test-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      {
        name: "alternate-vision",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyEnv: "ALT_VISION_KEY",
        model: "provider/vision-model",
        priority: 10,
        supportsVision: true
      }
    ])
  };
  const fetchImpl = async (url, options) => {
    seen.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      model: "provider/vision-model",
      choices: [{ message: { content: "The image is a test image." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withApp(visionEnv, fetchImpl, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "What is in the image?" }],
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(seen[0].auth, "Bearer alternate-vision-test-secret");
    assert.equal(seen[0].body.model, "provider/vision-model");
    assert.ok(Array.isArray(seen[0].body.messages.at(-1).content));
  });
});

test("image chat rejects non-canonical base64 before contacting providers", async () => {
  let calls = 0;
  await withApp({ ...baseEnv }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Unexpected" } }] }), { status: 200 });
  }, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Inspect this" }],
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8" }]
      })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_IMAGE");
    assert.equal(calls, 0);
  });
});
