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


test("desktop action creation permits only fixed targets and relies on the owner-scoped RPC", async () => {
  let call;
  await withRelay({
    supabaseRest: async (...args) => {
      call = args;
      return [{
        command_id: "88888888-8888-4888-8888-888888888888",
        command_status: "pending",
        command_expires_at: new Date(1_800_000_060_000).toISOString()
      }];
    }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType: "launch_application", target: "notepad" })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.approvalRequiredOnDevice, true);
    assert.equal(payload.command.actionType, "launch_application");
    assert.equal(payload.command.target, "notepad");
    assert.equal(call[1], "rpc/create_desktop_companion_command");
    assert.deepEqual(call[4], {
      p_device_record_id: RECORD,
      p_action_type: "launch_application",
      p_target: "notepad"
    });
  });

  let calls = 0;
  await withRelay({
    supabaseRest: async () => { calls += 1; return []; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType: "run_shell", target: "powershell" })
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0, "Unsupported remote actions must not reach Supabase.");
  });
});

test("paired device can atomically claim only its own fixed action", async () => {
  const deviceToken = "D".repeat(43);
  let call;
  await withRelay({
    privilegedSupabaseRpc: async (...values) => {
      call = values;
      return [{
        command_id: "88888888-8888-4888-8888-888888888888",
        action_type: "open_known_folder",
        target: "documents",
        expires_at: new Date(1_800_000_060_000).toISOString()
      }];
    }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/commands/next", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + deviceToken },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.command.actionType, "open_known_folder");
    assert.equal(payload.command.target, "documents");
    assert.equal(call[0], "claim_desktop_companion_command");
    assert.equal(call[1].p_token_hash, hash(deviceToken));
    assert.equal(call[1].p_device_id, DEVICE);
    assert.equal(JSON.stringify(payload).includes(deviceToken), false);
  });

  let calls = 0;
  await withRelay({
    privilegedSupabaseRpc: async () => { calls += 1; return []; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/commands/next", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer malformed" },
      body: JSON.stringify({ deviceId: DEVICE })
    });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });
});

test("paired device result endpoint accepts only one of the explicit result states", async () => {
  const deviceToken = "E".repeat(43);
  let call;
  await withRelay({
    privilegedSupabaseRpc: async (...values) => { call = values; return true; }
  }, async base => {
    const commandId = "88888888-8888-4888-8888-888888888888";
    const response = await fetch(base + "/desktop-companion/commands/" + commandId + "/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + deviceToken },
      body: JSON.stringify({ deviceId: DEVICE, status: "rejected", resultCode: "USER_REJECTED" })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.recorded, true);
    assert.equal(call[0], "complete_desktop_companion_command");
    assert.deepEqual(call[1], {
      p_token_hash: hash(deviceToken),
      p_device_id: DEVICE,
      p_command_id: commandId,
      p_status: "rejected",
      p_result_code: "USER_REJECTED"
    });
  });

  let calls = 0;
  await withRelay({
    privilegedSupabaseRpc: async () => { calls += 1; return true; }
  }, async base => {
    const response = await fetch(base + "/desktop-companion/commands/88888888-8888-4888-8888-888888888888/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + deviceToken },
      body: JSON.stringify({ deviceId: DEVICE, status: "completed", resultCode: "SHELL_EXECUTED" })
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test("action history returns only bounded status fields and never token hashes", async () => {
  await withRelay({
    supabaseRest: async () => [{
      id: "88888888-8888-4888-8888-888888888888",
      device_record_id: RECORD,
      action_type: "launch_application",
      target: "notepad",
      status: "completed",
      created_at: "2026-10-31T00:00:00.000Z",
      expires_at: "2026-10-31T00:01:00.000Z",
      completed_at: "2026-10-31T00:00:10.000Z",
      result_code: "ACTION_COMPLETED",
      token_hash: "must-not-appear"
    }]
  }, async base => {
    const response = await fetch(base + "/desktop-companion/devices/" + RECORD + "/commands");
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.commands[0].status, "completed");
    assert.equal(payload.commands[0].resultCode, "ACTION_COMPLETED");
    assert.equal(JSON.stringify(payload).includes("must-not-appear"), false);
  });
});
