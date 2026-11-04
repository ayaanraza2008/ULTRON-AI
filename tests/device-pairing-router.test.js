import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import crypto from "node:crypto";
import {
  createDevicePairingRouter,
  verifyPairedDeviceToken
} from "../integrations/device-pairing-router.js";
import { DeviceHub } from "../integrations/device-hub.js";

const OWNER_A = "00000000-0000-4000-8000-000000000001";
const OWNER_B = "00000000-0000-4000-8000-000000000002";
const SIGNING_SECRET = "device-pairing-test-secret-that-is-32-chars-minimum";
const ENV = {
  SUPABASE_URL: "https://opdjfhwepmcprbqojpat.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  ULTRON_DEVICE_SIGNING_SECRET: SIGNING_SECRET
};

function ownerMiddleware(req, res, next) {
  const owner = req.headers["x-test-owner"];
  if (!owner) return res.status(401).json({ error: { code: "AUTH_REQUIRED" } });
  req.supabaseUser = { id: owner };
  next();
}

async function withRouter(fetchImpl, fn, env = ENV, deviceHub = new DeviceHub({ env: { ULTRON_DEVICE_SIGNING_SECRET: SIGNING_SECRET } })) {
  const app = express();
  app.use(express.json());
  app.use(createDevicePairingRouter({ env, fetchImpl, requireSupabaseUser: ownerMiddleware, deviceHub, logger: { warn() {}, error() {} } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await fn("http://127.0.0.1:" + address.port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function response(data, status = 200) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeDatabase() {
  const pending = new Map();
  const devices = new Map();
  const requests = [];
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method, body, headers: options.headers || {} });
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);

    if (url.pathname.endsWith("/pending_device_pairings") && method === "POST") {
      if (pending.has(body.code)) return response({ code: "23505" }, 409);
      pending.set(body.code, body);
      return response([{ code: body.code, expires_at: body.expires_at }], 201);
    }

    if (url.pathname.endsWith("/rpc/claim_pending_device_pairing") && method === "POST") {
      const pairing = pending.get(body.p_code);
      if (!pairing || !pairing.approved || Date.parse(pairing.expires_at) <= Date.now()) {
        return response({ code: "P0001", message: "invalid or expired" }, 400);
      }
      pending.delete(body.p_code);
      const device = {
        id: pairing.device_id,
        owner_user_id: pairing.approved_by,
        device_name: pairing.device_name,
        platform: pairing.platform,
        token_hash: pairing.token_hash,
        token_prefix: pairing.token_prefix,
        status: "active",
        last_seen_at: new Date().toISOString(),
        paired_at: new Date().toISOString(),
        revoked_at: null
      };
      devices.set(device.id, device);
      return response([{
        device_id: device.id,
        owner_user_id: device.owner_user_id,
        device_name: device.device_name,
        platform: device.platform,
        token_hash: pairing.token_hash,
        token_prefix: pairing.token_prefix,
        encrypted_token: pairing.encrypted_token
      }]);
    }

    if (url.pathname.endsWith("/paired_devices") && method === "GET") {
      const owner = url.searchParams.get("owner_user_id")?.replace(/^eq\./, "");
      const hash = url.searchParams.get("token_hash")?.replace(/^eq\./, "");
      const status = url.searchParams.get("status")?.replace(/^eq\./, "");
      const rows = Array.from(devices.values()).filter(device =>
        (!owner || device.owner_user_id === owner) &&
        (!hash || device.token_hash === hash) &&
        (!status || device.status === status)
      );
      return response(rows);
    }

    if (url.pathname.endsWith("/paired_devices") && method === "PATCH") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      const owner = url.searchParams.get("owner_user_id")?.replace(/^eq\./, "");
      const current = devices.get(id);
      if (!current || current.owner_user_id !== owner) return response([]);
      Object.assign(current, body);
      return response([{ id }]);
    }
    throw new Error("Unexpected mocked Supabase request " + method + " " + url.pathname);
  };
  return { fetchImpl, pending, devices, requests };
}

test("device pairing creates a five-minute owner-approved code and consumes it exactly once", async () => {
  const db = makeDatabase();
  await withRouter(db.fetchImpl, async base => {
    const unauthenticated = await fetch(base + "/devices/pairings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "Owner PC", platform: "windows" })
    });
    assert.equal(unauthenticated.status, 401);

    const createdResponse = await fetch(base + "/devices/pairings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-owner": OWNER_A },
      body: JSON.stringify({ deviceName: "Owner PC", platform: "windows" })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.match(created.pairingCode, /^\d{6}$/);
    assert.ok(Date.parse(created.expiresAt) > Date.now());
    assert.ok(Date.parse(created.expiresAt) - Date.now() <= 5 * 60 * 1000 + 1000);

    const stored = db.pending.get(created.pairingCode);
    assert.ok(stored);
    assert.equal(stored.approved, true);
    assert.equal(stored.approved_by, OWNER_A);
    assert.ok(stored.encrypted_token);
    assert.notEqual(stored.encrypted_token, stored.token_hash);
    assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
    assert.equal(stored.token_prefix.length, 20);
    assert.equal(stored.encrypted_token.includes("ultron_dev_"), false);
    assert.equal(stored.encrypted_token.includes(stored.token_hash), false);

    const claimResponse = await fetch(base + "/devices/pairings/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.pairingCode })
    });
    assert.equal(claimResponse.status, 200);
    const claimed = await claimResponse.json();
    assert.match(claimed.deviceId, /^[0-9a-f-]{36}$/i);
    assert.match(claimed.deviceToken, /^ultron_dev_[a-f0-9]{64}$/);
    assert.equal(claimed.deviceName, "Owner PC");
    assert.equal(claimed.platform, "windows");
    assert.equal(db.pending.has(created.pairingCode), false);

    const replay = await fetch(base + "/devices/pairings/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.pairingCode })
    });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error.code, "PAIRING_CODE_INVALID");
  });
});

test("device registry isolates owners and rotates/revokes per-device tokens", async () => {
  const db = makeDatabase();
  let deviceId;
  let oldToken;
  await withRouter(db.fetchImpl, async base => {
    const created = await (await fetch(base + "/devices/pairings", {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": OWNER_A },
      body: JSON.stringify({ deviceName: "A Workstation", platform: "windows" })
    })).json();
    const claim = await (await fetch(base + "/devices/pairings/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.pairingCode })
    })).json();
    deviceId = claim.deviceId;
    oldToken = claim.deviceToken;

    const ownList = await fetch(base + "/devices", { headers: { "x-test-owner": OWNER_A } });
    assert.equal(ownList.status, 200);
    const ownPayload = await ownList.json();
    assert.equal(ownPayload.devices.length, 1);
    assert.equal(ownPayload.devices[0].id, deviceId);

    const otherList = await fetch(base + "/devices", { headers: { "x-test-owner": OWNER_B } });
    assert.equal((await otherList.json()).devices.length, 0);

    const rotatedResponse = await fetch(base + "/devices/" + deviceId + "/rotate-token", {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": OWNER_A },
      body: "{}"
    });
    assert.equal(rotatedResponse.status, 200);
    const rotated = await rotatedResponse.json();
    assert.notEqual(rotated.deviceToken, oldToken);
    assert.equal(rotated.rotated, true);

    const rotatedDevice = db.devices.get(deviceId);
    assert.equal(rotatedDevice.token_hash, crypto.createHash("sha256").update(rotated.deviceToken).digest("hex"));

    const revoke = await fetch(base + "/devices/" + deviceId, {
      method: "DELETE", headers: { "x-test-owner": OWNER_A }
    });
    assert.equal(revoke.status, 200);
    assert.equal(db.devices.get(deviceId).status, "revoked");

    const wrongOwnerRevoke = await fetch(base + "/devices/" + deviceId, {
      method: "DELETE", headers: { "x-test-owner": OWNER_B }
    });
    assert.equal(wrongOwnerRevoke.status, 404);
  });
});

test("paired-device token verifier accepts only active token hashes and never returns the token", async () => {
  const db = makeDatabase();
  let token;
  await withRouter(db.fetchImpl, async base => {
    const created = await (await fetch(base + "/devices/pairings", {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": OWNER_A },
      body: JSON.stringify({ deviceName: "Owner Android", platform: "android" })
    })).json();
    const claim = await (await fetch(base + "/devices/pairings/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.pairingCode })
    })).json();
    token = claim.deviceToken;
  });
  const device = await verifyPairedDeviceToken({ token, env: ENV, fetchImpl: db.fetchImpl, logger: { warn() {} } });
  assert.equal(device.ownerUserId, OWNER_A);
  assert.equal(device.name, "Owner Android");
  assert.equal(device.authToken, token);
  const revoked = db.devices.get(device.id);
  revoked.status = "revoked";
  assert.equal(await verifyPairedDeviceToken({ token, env: ENV, fetchImpl: db.fetchImpl, logger: { warn() {} } }), null);
});

test("pairing fails closed when its dedicated encryption secret is absent", async () => {
  const db = makeDatabase();
  const env = { ...ENV, ULTRON_DEVICE_SIGNING_SECRET: "" };
  await withRouter(db.fetchImpl, async base => {
    const response = await fetch(base + "/devices/pairings", {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": OWNER_A },
      body: JSON.stringify({ deviceName: "Owner PC", platform: "windows" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "DEVICE_SIGNING_SECRET_REQUIRED");
    assert.equal(db.pending.size, 0);
  }, env);
});

test("pairing code endpoint rate-limits repeated unauthenticated guesses", async () => {
  const db = makeDatabase();
  await withRouter(db.fetchImpl, async base => {
    let last;
    for (let i = 0; i < 9; i++) {
      last = await fetch(base + "/devices/pairings/claim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" })
      });
    }
    assert.equal(last.status, 429);
    assert.equal((await last.json()).error.code, "DEVICE_PAIRING_RATE_LIMITED");
  });
});

test("device-pairing migration installs an atomic single-use claim function restricted to service_role", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../supabase/migrations/20261101180000_durable_paired_devices.sql", import.meta.url), "utf8");
  assert.match(migration, /create or replace function public\.claim_pending_device_pairing\(p_code text\)/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /insert into public\.paired_devices/i);
  assert.match(migration, /delete from public\.pending_device_pairings/i);
  assert.match(migration, /revoke all on function public\.claim_pending_device_pairing\(text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_pending_device_pairing\(text\) to service_role/i);
  const telemetryMigration = await readFile(new URL("../supabase/migrations/20261104110000_paired_device_telemetry.sql", import.meta.url), "utf8");
  assert.match(telemetryMigration, /add column if not exists battery_percent smallint/i);
  assert.match(telemetryMigration, /battery_percent between 0 and 100/i);
  assert.match(telemetryMigration, /add column if not exists is_charging boolean/i);
});


test("paired device self status and heartbeat are owner-scoped and update durable telemetry", async () => {
  const db = makeDatabase();
  const hub = new DeviceHub({ env: { ULTRON_DEVICE_SIGNING_SECRET: SIGNING_SECRET } });
  await withRouter(db.fetchImpl, async base => {
    const pair = async (owner, deviceName, platform) => {
      const created = await fetch(base + "/devices/pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-owner": owner },
        body: JSON.stringify({ deviceName, platform })
      });
      assert.equal(created.status, 201);
      const pairing = await created.json();
      const claimed = await fetch(base + "/devices/pairings/claim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairing.pairingCode })
      });
      assert.equal(claimed.status, 200);
      return claimed.json();
    };

    const android = await pair(OWNER_A, "Owner Android", "android");
    const windows = await pair(OWNER_A, "Owner Windows", "windows");
    await pair(OWNER_B, "Other Owner Windows", "windows");

    const statusResponse = await fetch(base + "/devices/me", {
      headers: { "x-device-token": android.deviceToken }
    });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.deviceId, android.deviceId);
    assert.equal(status.devices.length, 2);
    assert.ok(status.devices.some(device => device.id === windows.deviceId));
    assert.equal(status.devices.some(device => device.name === "Other Owner Windows"), false);

    const heartbeatResponse = await fetch(base + "/devices/me/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-token": android.deviceToken },
      body: JSON.stringify({ batteryPercent: 73, isCharging: true })
    });
    assert.equal(heartbeatResponse.status, 200);
    assert.equal((await heartbeatResponse.json()).success, true);
    const stored = db.devices.get(android.deviceId);
    assert.equal(stored.battery_percent, 73);
    assert.equal(stored.is_charging, true);
    assert.equal(hub.pairedDevices.size, 1);
  }, ENV, hub);
});

test("paired-device runtime self endpoints require a valid active device token", async () => {
  const db = makeDatabase();
  await withRouter(db.fetchImpl, async base => {
    const missing = await fetch(base + "/devices/me");
    assert.equal(missing.status, 401);
    const invalid = await fetch(base + "/devices/me/heartbeat", {
      method: "POST", headers: { "Content-Type": "application/json", "x-device-token": "invalid-token" },
      body: JSON.stringify({ batteryPercent: 40 })
    });
    assert.equal(invalid.status, 401);
  });
});
