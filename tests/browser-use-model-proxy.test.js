import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function withServer(app, run) {
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("Browser Use model proxy requires the shared token and keeps provider key server-side", async () => {
  let forwarded;
  const app = createApp({
    env: {
      ULTRON_BROWSER_USE_TOKEN: "shared-test-token",
      OPENROUTER_API_KEY: "provider-secret",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ULTRON_AVAILABLE_MODELS: "openrouter/free,provider/approved:free"
    },
    fetchImpl: async (url, options) => {
      forwarded = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const url = base + "/api/internal/browser-use/v1/chat/completions";
    const denied = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "user", content: "hello" }] }) });
    assert.equal(denied.status, 401);
    assert.equal(forwarded, undefined);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer shared-test-token" },
      body: JSON.stringify({ model: "unapproved/model", messages: [{ role: "user", content: "hello" }], stream: true })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, "ok");
    assert.equal(forwarded.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(forwarded.options.headers.Authorization, "Bearer provider-secret");
    const payload = JSON.parse(forwarded.options.body);
    assert.equal(payload.model, "openrouter/free");
    assert.equal(payload.stream, false);
  });
});
