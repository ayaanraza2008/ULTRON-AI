import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../server.js";

const validEnv = {
  SUPABASE_URL: "https://project.example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  ULTRON_AUTH_CALLBACK_URL: "https://ultron.example.com/api/auth/google/callback",
  NODE_ENV: "production"
};

async function withServer({ env = validEnv, fetchImpl = async () => new Response("{}", { status: 200 }) } = {}, run) {
  const app = createApp({ env, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

test("phone OTP request validates international format before contacting Supabase", async () => {
  const calls = [];
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({});
    }
  }, async base => {
    const invalid = await fetch(base + "/api/auth/phone/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "9876543210" })
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 0);

    const valid = await fetch(base + "/api/auth/phone/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" })
    });
    assert.equal(valid.status, 200);
    assert.match((await valid.json()).message, /verification code has been sent/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://project.example.supabase.co/auth/v1/otp");
    assert.deepEqual(JSON.parse(calls[0].options.body), { phone: "+919876543210", create_user: true });
  });
});

test("phone OTP verification creates HttpOnly session cookies without returning tokens", async () => {
  const calls = [];
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        expires_in: 3600,
        user: { id: "user-1", phone: "+919876543210" }
      });
    }
  }, async base => {
    const invalid = await fetch(base + "/api/auth/phone/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", token: "abc123" })
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 0);

    const response = await fetch(base + "/api/auth/phone/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", token: "123456" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.phone, "+919876543210");
    assert.equal(JSON.stringify(body).includes("synthetic-access-token"), false);
    assert.equal(calls[0].url, "https://project.example.supabase.co/auth/v1/verify");
    assert.deepEqual(JSON.parse(calls[0].options.body), { phone: "+919876543210", token: "123456", type: "sms" });
    const cookies = response.headers.get("set-cookie") || "";
    assert.match(cookies, /ultron_sb_access=.*HttpOnly/i);
    assert.match(cookies, /ultron_sb_refresh=.*HttpOnly/i);
    assert.match(cookies, /Secure/i);
  });
});

test("Google OAuth uses PKCE, short-lived HttpOnly state cookies, and validates callback state", async () => {
  const calls = [];
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({
        access_token: "synthetic-google-access-token",
        refresh_token: "synthetic-google-refresh-token",
        expires_in: 3600,
        user: { id: "google-user", email: "person@example.com" }
      });
    }
  }, async base => {
    const start = await fetch(base + "/api/auth/google", { redirect: "manual" });
    assert.equal(start.status, 302);
    assert.equal(calls.length, 0);
    assert.match(start.headers.get("cache-control") || "", /no-store/i);
    const setCookie = start.headers.get("set-cookie") || "";
    const verifier = setCookie.match(/ultron_oauth_verifier=([^;,]+)/)?.[1];
    const state = setCookie.match(/ultron_oauth_state=([^;,]+)/)?.[1];
    assert.ok(verifier);
    assert.ok(state);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);

    const authorize = new URL(start.headers.get("location"));
    assert.equal(authorize.searchParams.get("provider"), "google");
    assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
    assert.ok(authorize.searchParams.get("code_challenge"));
    const callback = new URL(authorize.searchParams.get("redirect_to"));
    assert.equal(callback.pathname, "/api/auth/google/callback");
    assert.equal(callback.searchParams.get("state"), state);

    const finish = await fetch(base + "/api/auth/google/callback?code=synthetic-code&state=" + encodeURIComponent(state), {
      headers: { Cookie: "ultron_oauth_verifier=" + verifier + "; ultron_oauth_state=" + state }
    });
    assert.equal(finish.status, 200);
    const body = await finish.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.provider, "google");
    assert.equal(body.email, "person@example.com");
    assert.equal(JSON.stringify(body).includes("synthetic-google-access-token"), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://project.example.supabase.co/auth/v1/token?grant_type=pkce");
    assert.deepEqual(JSON.parse(calls[0].options.body), { auth_code: "synthetic-code", code_verifier: verifier });
  });
});

test("Google OAuth rejects callback state mismatches and fails closed when callback configuration is missing", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse({}); };
  await withServer({ fetchImpl }, async base => {
    const response = await fetch(base + "/api/auth/google/callback?code=synthetic-code&state=attacker-state", {
      headers: { Cookie: "ultron_oauth_state=expected-state; ultron_oauth_verifier=expected-verifier" }
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });

  await withServer({
    env: { SUPABASE_URL: validEnv.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: validEnv.SUPABASE_PUBLISHABLE_KEY },
    fetchImpl
  }, async base => {
    const response = await fetch(base + "/api/auth/google", { redirect: "manual" });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  });
});


test("signup rejects a known compromised password before contacting Supabase", async () => {
  const calls = [];
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith("https://api.pwnedpasswords.com/range/")) {
        assert.equal(url, "https://api.pwnedpasswords.com/range/5BAA6");
        assert.equal(options.body, undefined);
        assert.equal(options.headers["Add-Padding"], "true");
        assert.match(options.headers["User-Agent"], /ULTRON-AI/);
        return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:123\r\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }
      throw new Error("Supabase must not receive a compromised password");
    }
  }, async base => {
    const response = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "password" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "COMPROMISED_PASSWORD");
    assert.equal(calls.length, 1);
  });
});

test("signup screens a password using only its five-character hash prefix then sends it to Supabase", async () => {
  const calls = [];
  const password = "Ultron-safe-phrase-2026!";
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith("https://api.pwnedpasswords.com/range/")) {
        assert.equal(url, "https://api.pwnedpasswords.com/range/" + hash.slice(0, 5));
        assert.equal(options.body, undefined);
        assert.equal(JSON.stringify(options.headers).includes(password), false);
        return new Response("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }
      assert.equal(url, "https://project.example.supabase.co/auth/v1/signup");
      assert.equal(JSON.parse(options.body).password, password);
      return jsonResponse({ user: { email: "person@example.com" } });
    }
  }, async base => {
    const response = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password })
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).confirmationRequired, true);
    assert.equal(calls.length, 2);
  });
});

test("signup rejects safely when the privacy-preserving password screening service is unavailable", async () => {
  const calls = [];
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      throw new TypeError("synthetic screening network failure");
    }
  }, async base => {
    const response = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "Ultron-safe-phrase-2026!" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "PASSWORD_SCREENING_UNAVAILABLE");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
  });
});

test("signup fails closed when breached-password screening returns a malformed successful response", async () => {
  const calls = [];
  await withServer({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith("https://api.pwnedpasswords.com/range/")) {
        return new Response("<html>temporarily unavailable</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        });
      }
      throw new Error("Malformed screening response must not reach Supabase");
    }
  }, async base => {
    const response = await fetch(base + "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "Ultron-safe-phrase-2026!" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "PASSWORD_SCREENING_UNAVAILABLE");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
  });
});

