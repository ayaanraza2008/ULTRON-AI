import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function withAuthenticatedServer(run, providerStream) {
  const secret = "test-session-secret-that-is-at-least-32-characters";
  const app = createApp({
    env: {
      APP_ACCESS_PASSWORD: "test-password",
      SESSION_SECRET: secret,
      OPENROUTER_API_KEY: "synthetic-provider-key",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free"
    },
    fetchImpl: async () => new Response(providerStream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }),
    logger: { info() {}, warn() {}, error() {} }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const login = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    await run(base, cookie);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function requestChat(base, cookie) {
  return fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], stream: true })
  });
}

test("chat stream flushes a final delta without a trailing newline", async () => {
  const finalEvent = 'data: {"choices":[{"delta":{"content":"last token"}}]}';
  await withAuthenticatedServer(async (base, cookie) => {
    const response = await requestChat(base, cookie);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /"delta":"last token"/);
    assert.equal((body.match(/event: done/g) || []).length, 1);
  }, finalEvent);
});

test("chat stream does not emit duplicate done events when provider sends [DONE]", async () => {
  const providerStream = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]';
  await withAuthenticatedServer(async (base, cookie) => {
    const response = await requestChat(base, cookie);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /"delta":"hello"/);
    assert.equal((body.match(/event: done/g) || []).length, 1);
  }, providerStream);
});


test("chat stream aborts an oversized unfinished provider event", async () => {
  const oversizedUnterminatedEvent = "x".repeat(1_000_001);
  await withAuthenticatedServer(async (base, cookie) => {
    const response = await requestChat(base, cookie);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /PROVIDER_STREAM_INTERRUPTED/);
    assert.doesNotMatch(body, /x{1000}/);
  }, oversizedUnterminatedEvent);
});
