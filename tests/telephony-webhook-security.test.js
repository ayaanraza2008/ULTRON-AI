import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createTelephonyWebhookGuard,
  validateTwilioWebhook
} from "../telephony/webhook-security.js";

const SHARED_SECRET = "test-webhook-secret-that-is-at-least-32-characters";

function invokeGuard(guard, req) {
  let nextCalled = false;
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  guard(req, res, () => { nextCalled = true; });
  return { nextCalled, res };
}

test("telephony webhook guard fails closed when no provider auth is configured", () => {
  const guard = createTelephonyWebhookGuard({ env: {} });
  const result = invokeGuard(guard, { headers: {}, originalUrl: "/api/telephony/incoming-call" });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.res.payload.error.code, "TELEPHONY_WEBHOOK_AUTH_NOT_CONFIGURED");
});

test("telephony webhook guard accepts a constant-time shared-secret match", () => {
  const guard = createTelephonyWebhookGuard({
    env: { ULTRON_TELEPHONY_WEBHOOK_SECRET: SHARED_SECRET }
  });
  const result = invokeGuard(guard, {
    headers: { "x-ultron-telephony-secret": SHARED_SECRET },
    originalUrl: "/api/telephony/incoming-call"
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, 200);
});

test("telephony webhook guard rejects a missing or incorrect shared secret", () => {
  const guard = createTelephonyWebhookGuard({
    env: { ULTRON_TELEPHONY_WEBHOOK_SECRET: SHARED_SECRET }
  });
  const result = invokeGuard(guard, {
    headers: { "x-ultron-telephony-secret": "wrong-secret" },
    originalUrl: "/api/telephony/incoming-call"
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.payload.error.code, "TELEPHONY_WEBHOOK_AUTH_FAILED");
});

test("Twilio webhook verification accepts the configured public URL and signed form parameters", () => {
  const req = {
    originalUrl: "/api/telephony/incoming-call?route=owner",
    body: {
      CallSid: "CA123",
      From: "+919876543210",
      To: "+18005550199"
    },
    headers: {}
  };
  const publicBaseUrl = "https://ultron.example.com";
  const authToken = "twilio-test-auth-token";
  const url = new URL(req.originalUrl, publicBaseUrl).toString();
  const payload = url + "CallSidCA123" + "From+919876543210" + "To+18005550199";
  req.headers["x-twilio-signature"] = createHmac("sha1", authToken).update(payload).digest("base64");

  assert.equal(validateTwilioWebhook(req, { authToken, publicBaseUrl }), true);
  assert.equal(validateTwilioWebhook(req, { authToken, publicBaseUrl: "https://wrong.example.com" }), false);
});

test("Twilio webhook verification rejects a missing signature and non-HTTPS public URL", () => {
  const req = {
    originalUrl: "/api/telephony/incoming-call",
    body: { CallSid: "CA123" },
    headers: {}
  };

  assert.equal(validateTwilioWebhook(req, {
    authToken: "token",
    publicBaseUrl: "https://ultron.example.com"
  }), false);
  assert.equal(validateTwilioWebhook(req, {
    authToken: "token",
    publicBaseUrl: "http://ultron.example.com"
  }), false);
});

test("shared-secret configuration shorter than 32 characters cannot authenticate webhooks", () => {
  const guard = createTelephonyWebhookGuard({
    env: { ULTRON_TELEPHONY_WEBHOOK_SECRET: "short" }
  });
  const result = invokeGuard(guard, {
    headers: { "x-ultron-telephony-secret": "short" },
    originalUrl: "/api/telephony/incoming-call"
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
});
