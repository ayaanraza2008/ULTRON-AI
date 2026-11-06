import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function startApp(app) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return { server, base: "http://127.0.0.1:" + server.address().port };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function createPreferencesApp(fetchImpl) {
  return createApp({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl
  });
}

test("voice output preferences merge into the authenticated user's JSONB settings", async () => {
  const calls = [];
  const existingPreferences = { theme: "dark", custom_setting: true, voice_output_name: "Old voice" };
  const app = createPreferencesApp(async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || "GET";
    if (parsed.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (parsed.pathname === "/rest/v1/user_preferences") {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ method, url: String(url), body });
      if (method === "GET") {
        return new Response(JSON.stringify([{ preferences: existingPreferences }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([{
        ...body,
        history_retention_days: null,
        preferences: body.preferences || existingPreferences
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected upstream request: " + url);
  });
  const { server, base } = await startApp(app);
  try {
    const response = await fetch(base + "/api/preferences", {
      method: "PUT",
      headers: { Cookie: "ultron_sb_access=test-access-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        voice_input_locale: "en-IN",
        voice_enabled: true,
        memory_enabled: true,
        voice_output_name: "Google UK English Male",
        voice_output_lang: "en-GB"
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "GET");
    assert.equal(new URL(calls[0].url).searchParams.get("user_id"), "eq.user-123");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].body.preferences.theme, "dark");
    assert.equal(calls[1].body.preferences.custom_setting, true);
    assert.equal(calls[1].body.preferences.voice_output_name, "Google UK English Male");
    assert.equal(calls[1].body.preferences.voice_output_lang, "en-GB");
    assert.equal(payload.preferences.preferences.voice_output_name, "Google UK English Male");
  } finally {
    await closeServer(server);
  }
});

test("invalid voice output preferences are rejected before any preference database access", async () => {
  let preferenceRequests = 0;
  const app = createPreferencesApp(async url => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (parsed.pathname === "/rest/v1/user_preferences") {
      preferenceRequests += 1;
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected upstream request: " + url);
  });
  const { server, base } = await startApp(app);
  try {
    const headers = { Cookie: "ultron_sb_access=test-access-token", "Content-Type": "application/json" };
    const badName = await fetch(base + "/api/preferences", {
      method: "PUT", headers,
      body: JSON.stringify({ voice_input_locale: "en-IN", voice_output_name: "x".repeat(121), voice_output_lang: "en-GB" })
    });
    const badLang = await fetch(base + "/api/preferences", {
      method: "PUT", headers,
      body: JSON.stringify({ voice_input_locale: "en-IN", voice_output_name: "Valid", voice_output_lang: "not a locale" })
    });
    const badControl = await fetch(base + "/api/preferences", {
      method: "PUT", headers,
      body: JSON.stringify({ voice_input_locale: "en-IN", voice_output_name: "bad" + String.fromCharCode(10) + "voice", voice_output_lang: "en-GB" })
    });
    assert.equal(badName.status, 400);
    assert.equal(badLang.status, 400);
    assert.equal(badControl.status, 400);
    assert.equal(preferenceRequests, 0);
  } finally {
    await closeServer(server);
  }
});
