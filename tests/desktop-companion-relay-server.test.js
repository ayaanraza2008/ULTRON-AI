import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const RECORD = "33333333-3333-4333-8333-333333333333";
const ACCESS_TOKEN = "test-user-access-token";
const SERVICE_KEY = "sb_secret_companion_test_key";

async function withServer(app, run) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const relayEnv = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY
};
const ownerCookie = "ultron_sb_access=" + ACCESS_TOKEN;

test("server mounts authenticated pairing code creation with owner access token only", async () => {
  const calls = [];
  const app = createApp({
    env: relayEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: OWNER }), { status: 200 });
      if (url.endsWith("/rest/v1/desktop_companion_pairings")) return new Response(null, { status: 201 });
      throw new Error("Unexpected upstream request: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const unauthorized = await fetch(base + "/api/desktop-companion/pairings", { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(base + "/api/desktop-companion/pairings", {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: "{}"
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.match(payload.pairingCode, /^[A-Za-z0-9_-]{32}$/);
    const auth = calls.find(call => call.url.endsWith("/auth/v1/user"));
    const insert = calls.find(call => call.url.endsWith("/rest/v1/desktop_companion_pairings"));
    assert.equal(auth.options.headers.Authorization, "Bearer " + ACCESS_TOKEN);
    assert.equal(insert.options.headers.Authorization, "Bearer " + ACCESS_TOKEN);
    assert.equal(insert.options.headers.apikey, relayEnv.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(insert.options.headers.Prefer, "return=minimal");
    assert.equal(JSON.parse(insert.options.body).user_id, OWNER);
    assert.equal(JSON.stringify(calls).includes(SERVICE_KEY), false);
  });
});

test("server-side pairing RPC uses the narrow service-role credential path and never returns its token", async () => {
  const calls = [];
  const app = createApp({
    env: relayEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/rest/v1/rpc/complete_desktop_companion_pairing")) {
        return new Response(JSON.stringify([{ owner_user_id: OWNER, companion_device_id: RECORD }]), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error("Unexpected upstream request: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/desktop-companion/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: "P".repeat(32), deviceId: DEVICE, deviceName: "Ayaan-PC" })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.match(payload.deviceToken, /^[A-Za-z0-9_-]{43}$/);
    const rpc = calls[0];
    assert.equal(rpc.url, relayEnv.SUPABASE_URL + "/rest/v1/rpc/complete_desktop_companion_pairing");
    assert.equal(rpc.options.headers.apikey, SERVICE_KEY);
    assert.equal(rpc.options.headers.Authorization, undefined, "sb_secret_ keys are used as apikey only");
    assert.equal(JSON.parse(rpc.options.body).p_device_id, DEVICE);
    assert.equal(JSON.parse(rpc.options.body).p_token_hash.length, 64);
    assert.equal(JSON.stringify(payload).includes(SERVICE_KEY), false);
  });
});

test("server-side heartbeat is restricted to its named RPC and returns no device credential", async () => {
  const calls = [];
  const app = createApp({
    env: relayEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/rest/v1/rpc/record_desktop_companion_heartbeat")) {
        return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected upstream request: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const deviceToken = "T".repeat(43);
    const response = await fetch(base + "/api/desktop-companion/heartbeat", {
      method: "POST",
      headers: { Authorization: "Bearer " + deviceToken, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, "online");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.apikey, SERVICE_KEY);
    assert.equal(JSON.parse(calls[0].options.body).p_token_hash.length, 64);
    assert.equal(JSON.stringify(payload).includes(deviceToken), false);
  });
});

test("device inventory cannot be accessed with a password-only web session", async () => {
  const app = createApp({
    env: relayEnv,
    fetchImpl: async () => { throw new Error("Supabase should not be contacted without a user token."); },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/desktop-companion/devices");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "SUPABASE_AUTH_REQUIRED");
  });
});

const ACTION = "88888888-8888-4888-8888-888888888888";

test("server queues a fixed local action through the signed-in owner's Supabase token", async () => {
  const calls = [];
  const app = createApp({
    env: relayEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: OWNER }), { status: 200 });
      if (url.includes("/rest/v1/desktop_companion_devices?")) {
        return new Response(JSON.stringify([{
          id: RECORD, device_id: DEVICE, device_name: "Ayaan-PC", platform: "windows",
          last_seen_at: new Date().toISOString(), revoked_at: null
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/rest/v1/desktop_companion_actions?")) {
        return new Response(JSON.stringify([{ id: ACTION, status: "pending", expires_at: new Date(Date.now() + 120_000).toISOString() }]), {
          status: 201, headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error("Unexpected upstream request: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const response = await fetch(base + "/api/desktop-companion/devices/" + RECORD + "/actions", {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "launch_application", target: "notepad" })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.actionId, ACTION);
    assert.equal(payload.requiresLocalApproval, true);
    const insert = calls.find(call => call.url.includes("/rest/v1/desktop_companion_actions?"));
    assert.equal(insert.options.headers.Authorization, "Bearer " + ACCESS_TOKEN);
    assert.equal(insert.options.headers.apikey, relayEnv.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(insert.options.headers.Prefer, "return=representation");
    const inserted = JSON.parse(insert.options.body);
    assert.deepEqual({
      user_id: inserted.user_id,
      device_record_id: inserted.device_record_id,
      device_id: inserted.device_id,
      action_name: inserted.action_name,
      action_target: inserted.action_target
    }, {
      user_id: OWNER, device_record_id: RECORD, device_id: DEVICE,
      action_name: "launch_application", action_target: "notepad"
    });
    assert.equal(JSON.stringify(calls).includes(SERVICE_KEY), false);
  });
});

test("server-side action claim uses the allowlisted service-role RPC and returns no token", async () => {
  const calls = [];
  const app = createApp({
    env: relayEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/rest/v1/rpc/claim_desktop_companion_action")) {
        return new Response(JSON.stringify([{
          action_id: ACTION, action_name: "launch_application", action_target: "calculator",
          expires_at: "2026-10-31T12:02:00.000Z"
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected upstream request: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const deviceToken = "C".repeat(43);
    const response = await fetch(base + "/api/desktop-companion/actions/next", {
      method: "POST",
      headers: { Authorization: "Bearer " + deviceToken, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.action, {
      id: ACTION, name: "launch_application", target: "calculator",
      expiresAt: "2026-10-31T12:02:00.000Z", requiresLocalApproval: true
    });
    assert.equal(calls[0].url, relayEnv.SUPABASE_URL + "/rest/v1/rpc/claim_desktop_companion_action");
    assert.equal(calls[0].options.headers.apikey, SERVICE_KEY);
    assert.equal(JSON.parse(calls[0].options.body).p_token_hash.length, 64);
    assert.equal(JSON.stringify(payload).includes(deviceToken), false);
  });
});

test("server-side action completion uses the named RPC and accepts no arbitrary outcome", async () => {
  const calls = [];
  const app = createApp({
    env: relayEnv,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/rest/v1/rpc/complete_desktop_companion_action")) {
        return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected upstream request: " + url);
    },
    logger: { warn() {}, error() {} }
  });
  await withServer(app, async base => {
    const deviceToken = "R".repeat(43);
    const response = await fetch(base + "/api/desktop-companion/actions/" + ACTION + "/complete", {
      method: "POST",
      headers: { Authorization: "Bearer " + deviceToken, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE, status: "denied", resultCode: "USER_DENIED" })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.accepted, true);
    assert.equal(calls[0].url, relayEnv.SUPABASE_URL + "/rest/v1/rpc/complete_desktop_companion_action");
    assert.equal(JSON.parse(calls[0].options.body).p_status, "denied");
    assert.equal(JSON.parse(calls[0].options.body).p_result_code, "USER_DENIED");
  });
});
