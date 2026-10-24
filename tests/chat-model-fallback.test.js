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

async function withApp(fetchImpl, run) {
  const app = createApp({ env: { ...env }, fetchImpl, logger: { warn() {}, error() {} } });
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
