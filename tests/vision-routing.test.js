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
        attachments: [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfS8AAAAASUVORK5CYII=" }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, "vendor/vision-a:free");
    assert.equal(seen[0].messages.at(-1).content[1].image_url.url, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfS8AAAAASUVORK5CYII=");
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
        attachments: [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfS8AAAAASUVORK5CYII=" }]
      })
    });
    assert.equal(response.status, 502);
    assert.deepEqual(seen.map(item => item.model), ["vendor/vision-a:free", "vendor/vision-b:free"]);
  });
});

test("image chat rejects non-image bytes before contacting the model provider", async () => {
  let providerCalled = false;
  await withApp({ ...baseEnv }, async () => {
    providerCalled = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: "should not run" } }] }), { status: 200 });
  }, async (base, cookie) => {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Describe this image" }],
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }]
      })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_IMAGE");
    assert.equal(providerCalled, false);
  });
});
