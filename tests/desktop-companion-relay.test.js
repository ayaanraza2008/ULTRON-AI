import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createDesktopCompanionRelayRouter } from "../integrations/desktop-companion-relay.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const RECORD = "33333333-3333-4333-8333-333333333333";
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");

async function withRelay({ supabaseRest = async () => [], privilegedSupabaseRpc = async () => true, now = () => 1_800_000_000_000 } = {}, run) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(createDesktopCompanionRelayRouter({
    requireSupabaseUser(req, _res, next) { req.supabaseUser = { id: OWNER }; next(); },
    supabaseRest,
    privilegedSupabaseRpc,
    now,
    logger: { warn() {} }
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("pairing-code creation is authenticated, hashed at rest, one-time and non-cacheable", async () => {
  let call;
  await withRelay({
    supabaseRest: async (...args) => { call = args; return null; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/pairings", { method: "POST" });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.match(payload.pairingCode, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(payload.expiresInSeconds, 300);
    assert.equal(call[1], "desktop_companion_pairings");
    assert.equal(call[2], "POST");
    assert.equal(call[4].user_id, OWNER);
    assert.equal(call[4].code_hash, hash(payload.pairingCode));
    assert.notEqual(call[4].code_hash, payload.pairingCode);
    assert.equal(call[4].expires_at, new Date(1_800_000_300_000).toISOString());
    // call[0] is the Express request; inspect only the adapter arguments.
    assert.equal(JSON.stringify(call.slice(1)).includes(payload.pairingCode), false);
  });
});

test("pair exchange validates identity and returns a token only after atomic database redemption", async () => {
  let call;
  await withRelay({
    privilegedSupabaseRpc: async (...args) => {
      call = args;
      return [{ owner_user_id: OWNER, companion_device_id: RECORD }];
    }
  }, async base => {
    const pairingCode = "A".repeat(32);
    const response = await fetch(base + "/desktop-companion/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode, deviceId: DEVICE, deviceName: "Ayaan-PC" })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.deviceId, DEVICE);
    assert.equal(payload.deviceName, "Ayaan-PC");
    assert.equal(payload.platform, "windows");
    assert.match(payload.deviceToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(call[0], "complete_desktop_companion_pairing");
    assert.equal(call[1].p_code_hash, hash(pairingCode));
    assert.equal(call[1].p_device_id, DEVICE);
    assert.equal(call[1].p_device_name, "Ayaan-PC");
    assert.equal(call[1].p_token_hash, hash(payload.deviceToken));
    assert.notEqual(call[1].p_token_hash, payload.deviceToken);
    assert.equal(JSON.stringify(call).includes(payload.deviceToken), false);
  });
});

test("invalid or previously redeemed pairing codes are rejected without leaking credentials", async () => {
  let calls = 0;
  await withRelay({
    privilegedSupabaseRpc: async () => { calls += 1; return []; }
  }, async base => {
    const invalid = await fetch(base + "/desktop-companion/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: "bad", deviceId: DEVICE })
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);

    const expired = await fetch(base + "/desktop-companion/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: "B".repeat(32), deviceId: DEVICE })
    });
    assert.equal(expired.status, 410);
    assert.equal((await expired.json()).error.code, "PAIRING_CODE_EXPIRED_OR_USED");
    assert.equal(calls, 1);
  });
});

test("heartbeat stores only the token hash and rejects revoked or unknown devices", async () => {
  const deviceToken = "C".repeat(43);
  let args;
  await withRelay({
    privilegedSupabaseRpc: async (...values) => { args = values; return true; }
  }, async base => {
    const accepted = await fetch(base + "/desktop-companion/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + deviceToken },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    const payload = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(payload.status, "online");
    assert.equal(payload.nextHeartbeatSeconds, 30);
    assert.equal(args[0], "record_desktop_companion_heartbeat");
    assert.equal(args[1].p_token_hash, hash(deviceToken));
    assert.equal(args[1].p_device_id, DEVICE);
    assert.equal(JSON.stringify(payload).includes(deviceToken), false);
  });

  await withRelay({
    privilegedSupabaseRpc: async () => false
  }, async base => {
    const response = await fetch(base + "/desktop-companion/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + deviceToken },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "DEVICE_TOKEN_REVOKED_OR_UNKNOWN");
  });
});

test("heartbeat refuses malformed credentials before invoking privileged RPC", async () => {
  let calls = 0;
  await withRelay({
    privilegedSupabaseRpc: async () => { calls += 1; return true; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer short" },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });
});

test("device inventory computes online state and omits token hashes", async () => {
  const now = 1_800_000_000_000;
  let query;
  await withRelay({
    now: () => now,
    supabaseRest: async (...args) => {
      query = args;
      return [
        { id: RECORD, device_id: DEVICE, device_name: "Ayaan-PC", platform: "windows", created_at: "2026-09-01T00:00:00.000Z", last_seen_at: new Date(now - 20_000).toISOString(), revoked_at: null, token_hash: "never-show-hash" },
        { id: "44444444-4444-4444-8444-444444444444", device_id: "55555555-5555-4555-8555-555555555555", device_name: "Old PC", platform: "windows", last_seen_at: new Date(now - 120_000).toISOString(), revoked_at: null },
        { id: "66666666-6666-4666-8666-666666666666", device_id: "77777777-7777-4777-8777-777777777777", device_name: "Revoked PC", platform: "windows", last_seen_at: new Date(now).toISOString(), revoked_at: new Date(now).toISOString() }
      ];
    }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices");
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(query[1], "desktop_companion_devices");
    assert.match(query[3], /select=id,device_id,device_name,platform,created_at,last_seen_at,revoked_at/);
    assert.equal(payload.devices[0].online, true);
    assert.equal(payload.devices[1].online, false);
    assert.equal(payload.devices[2].online, false);
    assert.equal(payload.devices[2].revoked, true);
    assert.equal(JSON.stringify(payload).includes("never-show-hash"), false);
  });
});

test("revocation uses the caller-scoped RLS RPC and distinguishes inactive devices", async () => {
  let call;
  await withRelay({
    supabaseRest: async (...args) => { call = args; return true; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/revoke", { method: "POST" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.revoked, true);
    assert.equal(call[1], "rpc/revoke_desktop_companion_device");
    assert.deepEqual(call[4], { p_device_id: RECORD });
  });

  await withRelay({
    supabaseRest: async () => false
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/revoke", { method: "POST" });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "DEVICE_NOT_FOUND");
  });
});

const ACTION = "88888888-8888-4888-8888-888888888888";

test("owner can queue only a fixed action for a recently online, unrevoked Windows device", async () => {
  const now = 1_800_000_000_000;
  const calls = [];
  await withRelay({
    now: () => now,
    supabaseRest: async (...args) => {
      calls.push(args);
      if (args[1] === "desktop_companion_devices" && args[2] === "GET") {
        return [{ id: RECORD, device_id: DEVICE, device_name: "Ayaan-PC", platform: "windows",
          last_seen_at: new Date(now - 10_000).toISOString(), revoked_at: null }];
      }
      if (args[1] === "desktop_companion_actions" && args[2] === "POST") {
        return [{ id: ACTION, status: "pending", expires_at: new Date(now + 120_000).toISOString() }];
      }
      throw new Error("unexpected database operation");
    }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "launch_application", target: "notepad" })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.actionId, ACTION);
    assert.equal(payload.requiresLocalApproval, true);
    assert.equal(payload.status, "pending");
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1], "desktop_companion_actions");
    assert.equal(calls[1][4].user_id, OWNER);
    assert.equal(calls[1][4].device_record_id, RECORD);
    assert.equal(calls[1][4].device_id, DEVICE);
    assert.equal(calls[1][4].action_name, "launch_application");
    assert.equal(calls[1][4].action_target, "notepad");
    assert.equal(calls[1][4].expires_at, new Date(now + 120_000).toISOString());
    assert.equal(calls[1][5], "return=representation");
  });
});

test("desktop action queue rejects arbitrary shell-like input before database access", async () => {
  let calls = 0;
  await withRelay({ supabaseRest: async () => { calls++; return []; } }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "launch_application", target: "powershell", command: "Remove-Item" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_DESKTOP_ACTION");
    assert.equal(calls, 0);
  });
});

test("desktop action queue rejects an offline device", async () => {
  const now = 1_800_000_000_000;
  let inserts = 0;
  await withRelay({
    now: () => now,
    supabaseRest: async (_req, table, method) => {
      if (table === "desktop_companion_devices" && method === "GET") {
        return [{ id: RECORD, device_id: DEVICE, platform: "windows",
          last_seen_at: new Date(now - 120_000).toISOString(), revoked_at: null }];
      }
      if (method === "POST") inserts++;
      return [];
    }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open_known_folder", target: "documents" })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "DEVICE_OFFLINE");
    assert.equal(inserts, 0);
  });
});

test("paired device claims one fixed local action using its hashed device credential", async () => {
  const token = "D".repeat(43);
  let call;
  await withRelay({
    privilegedSupabaseRpc: async (...args) => {
      call = args;
      return [{ action_id: ACTION, action_name: "open_known_folder", action_target: "documents",
        expires_at: "2026-10-31T12:02:00.000Z" }];
    }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/actions/next", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(call[0], "claim_desktop_companion_action");
    assert.equal(call[1].p_token_hash, hash(token));
    assert.equal(call[1].p_device_id, DEVICE);
    assert.deepEqual(payload.action, {
      id: ACTION, name: "open_known_folder", target: "documents",
      expiresAt: "2026-10-31T12:02:00.000Z", requiresLocalApproval: true
    });
  });
});

test("paired device can acknowledge only a matching allowlisted action outcome", async () => {
  const token = "E".repeat(43);
  let call;
  await withRelay({
    privilegedSupabaseRpc: async (...args) => { call = args; return true; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/actions/" + ACTION + "/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ deviceId: DEVICE, status: "denied", resultCode: "USER_DENIED" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(call, ["complete_desktop_companion_action", {
      p_token_hash: hash(token), p_device_id: DEVICE, p_action_id: ACTION,
      p_status: "denied", p_result_code: "USER_DENIED"
    }]);
    assert.equal((await response.json()).accepted, true);
  });

  let calls = 0;
  await withRelay({ privilegedSupabaseRpc: async () => { calls++; return true; } }, async base => {
    const response = await fetch(base + "/desktop-companion/actions/" + ACTION + "/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ deviceId: DEVICE, status: "completed", resultCode: "USER_DENIED" })
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});
