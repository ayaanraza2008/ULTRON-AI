import test from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeReadiness } from "../runtime-readiness.js";

test("readiness distinguishes configured Google OAuth and phone OTP from verified delivery", () => {
  const result = buildRuntimeReadiness({
    env: {
      SUPABASE_URL: "https://project.example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
      ULTRON_AUTH_CALLBACK_URL: "https://ultron.example.com/api/auth/google/callback"
    },
    supabaseConfigured: true,
    now: new Date("2026-10-24T00:00:00.000Z")
  });
  assert.equal(result.components.find(item => item.id === "google_auth").state, "configured_unverified");
  assert.equal(result.components.find(item => item.id === "phone_otp").state, "configured_unverified");
  assert.match(result.components.find(item => item.id === "google_auth").note, /still need verification/i);
  assert.match(result.components.find(item => item.id === "phone_otp").note, /SMS provider/i);
  assert.equal(JSON.stringify(result).includes("synthetic-publishable-key"), false);
});

test("readiness blocks Google OAuth without a secure callback and blocks phone OTP without Supabase", () => {
  const result = buildRuntimeReadiness({
    env: {
      SUPABASE_URL: "https://project.example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
      ULTRON_AUTH_CALLBACK_URL: "http://untrusted.example/api/auth/google/callback"
    },
    supabaseConfigured: false
  });
  assert.equal(result.components.find(item => item.id === "google_auth").state, "blocked");
  assert.equal(result.components.find(item => item.id === "phone_otp").state, "blocked");
});
