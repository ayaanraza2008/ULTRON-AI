import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

const env = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
};

async function withServer(runtimeEnv, fetchImpl, run) {
  const app = createApp({ env: { ...env, ...runtimeEnv }, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" }
});

test("confirmation resend uses signup type, configured redirect, and a generic no-store response", async () => {
  let request;
  await withServer({
    ULTRON_AUTH_REDIRECT_URL: "https://ultron.example.com/auth/confirm"
  }, async (url, options) => {
    request = { url, options };
    return json({});
  }, async base => {
    const response = await fetch(base + "/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", redirectTo: "https://attacker.example/steal" })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: true,
      message: "If this account can receive a confirmation email, instructions will be sent."
    });
    assert.equal(request.url, "https://example.supabase.co/auth/v1/resend");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), {
      type: "signup",
      email: "user@example.com",
      options: { emailRedirectTo: "https://ultron.example.com/auth/confirm" }
    });
    assert.equal(request.options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
  });
});

test("confirmation resend rejects malformed emails before making an upstream request", async () => {
  let called = false;
  await withServer({}, async () => {
    called = true;
    return json({});
  }, async base => {
    const response = await fetch(base + "/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_EMAIL");
    assert.equal(called, false);
  });
});

test("confirmation resend hides upstream account-existence errors", async () => {
  await withServer({}, async () => json({
    error: "email_not_confirmed",
    message: "sensitive provider detail that must not leak"
  }, 400), async base => {
    const response = await fetch(base + "/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.message, /If this account can receive/);
    assert.equal(JSON.stringify(body).includes("sensitive provider detail"), false);
  });
});

test("confirmation resend returns sanitized throttling for HTTP 429", async () => {
  await withServer({}, async () => json({ message: "provider private detail" }, 429), async base => {
    const response = await fetch(base + "/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" })
    });
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.error.code, "RESEND_RATE_LIMITED");
    assert.equal(JSON.stringify(body).includes("provider private detail"), false);
  });
});

test("confirmation resend fails closed for unsafe configured redirect URLs", async () => {
  let called = false;
  await withServer({
    ULTRON_AUTH_REDIRECT_URL: "https://trusted.example/confirm?token=unexpected"
  }, async () => {
    called = true;
    return json({});
  }, async base => {
    const response = await fetch(base + "/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "AUTH_REDIRECT_MISCONFIGURED");
    assert.equal(called, false);
  });
});

test("confirmation resend sanitizes provider outages", async () => {
  await withServer({}, async () => json({ message: "database credentials in raw errors" }, 503), async base => {
    const response = await fetch(base + "/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "RESEND_UNAVAILABLE");
    assert.equal(JSON.stringify(body).includes("database credentials"), false);
  });
});
