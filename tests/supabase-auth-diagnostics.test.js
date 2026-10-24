import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseSupabaseAuth } from "../scripts/supabase-auth-diagnostics.mjs";
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-test-key-not-to-echo" };
const response = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("reads public runtime settings and reports email confirmation without sending mail", async () => {
  let request;
  const result = await diagnoseSupabaseAuth({
    env, now: () => "fixed-time",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ external: { email: true, google: false, phone: true }, disable_signup: false,
        mailer_autoconfirm: false, phone_autoconfirm: false, sms_provider: "private-provider-label" });
    }
  });
  assert.equal(request.url, "https://example.supabase.co/auth/v1/settings");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(result.status, "passed");
  assert.equal(result.emailProviderEnabled, true);
  assert.equal(result.emailConfirmationRequired, true);
  assert.equal(result.googleProviderEnabled, false);
  assert.equal(result.phoneProviderEnabled, true);
  assert.equal(result.phoneAutoconfirm, false);
  assert.equal(result.smsProviderConfigured, true);
  assert.equal(result.emailDeliveryVerified, false);
  assert.equal(JSON.stringify(result).includes(env.SUPABASE_PUBLISHABLE_KEY), false);
  assert.equal(JSON.stringify(result).includes("private-provider-label"), false);
});

test("supports legacy anon key and represents absent settings as unknown", async () => {
  const result = await diagnoseSupabaseAuth({
    env: { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: "legacy-public-key" },
    fetchImpl: async () => response({ external: { email: true }, autoconfirm: true })
  });
  assert.equal(result.status, "passed");
  assert.equal(result.emailProviderEnabled, true);
  assert.equal(result.emailConfirmationRequired, false);
  assert.equal(result.googleProviderEnabled, null);
  assert.equal(result.phoneProviderEnabled, null);
  assert.equal(result.smsProviderConfigured, false);
});

test("blocks missing keys and unsafe URLs before networking", async () => {
  let called = false;
  const result = await diagnoseSupabaseAuth({
    env: { SUPABASE_URL: "http://example.supabase.co?token=secret" },
    fetchImpl: async () => { called = true; return response({}); }
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "SAFE_SUPABASE_URL_AND_PUBLISHABLE_KEY_REQUIRED");
  assert.equal(called, false);
});

test("sanitizes HTTP errors and never returns raw error body", async () => {
  const result = await diagnoseSupabaseAuth({
    env, fetchImpl: async () => response("smtp-password-and-key-details", 403)
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "AUTH_SETTINGS_KEY_REJECTED");
  assert.equal(result.httpStatus, 403);
  assert.equal(JSON.stringify(result).includes("smtp-password"), false);
  assert.equal(JSON.stringify(result).includes(env.SUPABASE_PUBLISHABLE_KEY), false);
});

test("sanitizes invalid JSON body", async () => {
  const result = await diagnoseSupabaseAuth({
    env, fetchImpl: async () => response("{smtp-secret-fragment", 200)
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "AUTH_SETTINGS_INVALID_RESPONSE");
  assert.equal(JSON.stringify(result).includes("smtp-secret-fragment"), false);
});

test("reports timeouts without exposing error details", async () => {
  const result = await diagnoseSupabaseAuth({
    env, fetchImpl: async () => { const error = new Error("synthetic network secret"); error.name = "TimeoutError"; throw error; }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "AUTH_SETTINGS_TIMEOUT");
  assert.equal(JSON.stringify(result).includes("synthetic network secret"), false);
});