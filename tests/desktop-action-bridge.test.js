import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDesktopActionRouter, validateDesktopAction } from "../desktop-action-bridge.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const TOKEN = "synthetic-desktop-bridge-token-with-more-than-32-characters";
const ACTION_ID = "00000000-0000-4000-8000-000000000101";
const API_ENV = {
  ULTRON_INTEGRATION_OWNER_USER_ID: OWNER,
  ULTRON_DESKTOP_BRIDGE_TOKEN: TOKEN
};

function makeHarness({ env = API_ENV, authUserId = OWNER } = {}) {
  const store = new Map();
  let sequence = 0;

  const privilegedSupabaseRest = async (_req, table, method, query = "", body) => {
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    if (table === "rpc/ultron_claim_next_desktop_action" && method === "POST") {
      const ownerId = body?.p_user_id;
      const now = Date.now();
      const candidates = [...store.values()]
        .filter(row => row.user_id === ownerId && row.attempts < 3 &&
          (row.status === "QUEUED" || (row.status === "RUNNING" && Date.parse(row.lease_expires_at || "") <= now)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const row = candidates[0];
      if (!row) return [];
      row.status = "RUNNING";
      row.attempts += 1;
      row.started_at = new Date(now).toISOString();
      row.lease_expires_at = new Date(now + 90_000).toISOString();
      row.updated_at = new Date(now).toISOString();
      return [structuredClone(row)];
    }
    if (table !== "desktop_actions") throw new Error("Unexpected privileged table: " + table);

    const matches = row => {
      const id = params.get("id") || "";
      const userId = params.get("user_id") || "";
      const status = params.get("status") || "";
      const attempts = params.get("attempts") || "";
      if (id.startsWith("eq.") && row.id !== id.slice(3)) return false;
      if (userId.startsWith("eq.") && row.user_id !== userId.slice(3)) return false;
      if (status.startsWith("eq.") && row.status !== status.slice(3)) return false;
      if (attempts.startsWith("eq.") && Number(row.attempts) !== Number(attempts.slice(3))) return false;
      if (status.startsWith("in.(")) {
        const allowed = status.slice(4, -1).split(",");
        if (!allowed.includes(row.status)) return false;
      }
      return true;
    };

    if (method === "POST") {
      sequence += 1;
      const now = new Date().toISOString();
      const id = sequence === 1 ? ACTION_ID : "00000000-0000-4000-8000-" + String(100 + sequence).padStart(12, "0");
      const row = {
        id, user_id: body.user_id, action_type: body.action_type, payload: structuredClone(body.payload),
        status: body.status, attempts: body.attempts ?? 0, approved_at: null, started_at: null,
        lease_expires_at: null, finished_at: null, result: null, error_code: null,
        created_at: now, updated_at: now
      };
      store.set(id, row);
      return [structuredClone(row)];
    }
    const selected = [...store.values()].filter(matches);
    if (method === "GET") {
      if (params.get("limit")) selected.splice(Number(params.get("limit")));
      if (params.get("order") === "created_at.desc") selected.reverse();
      return selected.map(row => structuredClone(row));
    }
    if (method === "PATCH") {
      const updated = [];
      for (const row of selected) {
        Object.assign(row, structuredClone(body), { updated_at: new Date().toISOString() });
        updated.push(structuredClone(row));
      }
      return updated;
    }
    throw new Error("Unexpected method: " + method);
  };

  const app = express();
  app.use(express.json());
  app.use("/api", createDesktopActionRouter({
    env,
    now: () => new Date(),
    logger: { warn() {} },
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: authUserId };
      return next();
    },
    privilegedSupabaseRest
  }));
  const server = app.listen(0);
  const base = new Promise(resolve => server.once("listening", () => resolve("http://127.0.0.1:" + server.address().port)));
  return {
    store,
    async request(method, path, { body, token } = {}) {
      const origin = await base;
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token === undefined ? {} : { Authorization: "Bearer " + token })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      return { status: response.status, payload };
    },
    close() { server.close(); }
  };
}

test("desktop action validator accepts only the narrow allowlist", () => {
  assert.deepEqual(validateDesktopAction("launch_app", { app: "calculator" }), { app: "calculator" });
  assert.deepEqual(validateDesktopAction("system_info", {}), {});
  assert.equal(validateDesktopAction("open_url", { url: "https://example.com/docs?topic=ultron" }).url, "https://example.com/docs?topic=ultron");
  assert.throws(() => validateDesktopAction("run_shell", { command: "whoami" }), { code: "DESKTOP_ACTION_NOT_ALLOWED" });
  assert.throws(() => validateDesktopAction("launch_app", { app: "powershell.exe" }), { code: "DESKTOP_ACTION_PAYLOAD_INVALID" });
  assert.throws(() => validateDesktopAction("launch_app", { app: "notepad", args: ["secret.txt"] }), { code: "DESKTOP_ACTION_PAYLOAD_INVALID" });
  assert.throws(() => validateDesktopAction("open_url", { url: "file:///C:/Windows/win.ini" }), { code: "DESKTOP_ACTION_UNSAFE_URL" });
  assert.throws(() => validateDesktopAction("open_url", { url: "http://127.0.0.1:8080/" }), { code: "DESKTOP_ACTION_UNSAFE_URL" });
  assert.throws(() => validateDesktopAction("open_url", { url: "https://user:password@example.com/" }), { code: "DESKTOP_ACTION_UNSAFE_URL" });
  assert.throws(() => validateDesktopAction("system_info", { includeEnvironment: true }), { code: "DESKTOP_ACTION_PAYLOAD_INVALID" });
});

test("owner must explicitly approve a desktop action before the Windows bridge can claim it", async t => {
  const h = makeHarness();
  t.after(() => h.close());

  const requested = await h.request("POST", "/api/desktop/actions", {
    body: { actionType: "launch_app", payload: { app: "calculator" }, status: "QUEUED", approved: true }
  });
  assert.equal(requested.status, 201);
  assert.equal(requested.payload.requiresApproval, true);
  assert.equal(requested.payload.action.status, "PENDING_APPROVAL");

  const beforeApproval = await h.request("POST", "/api/desktop/bridge/next", { token: TOKEN, body: {} });
  assert.equal(beforeApproval.status, 200);
  assert.equal(beforeApproval.payload.action, null);

  const approved = await h.request("POST", "/api/desktop/actions/" + ACTION_ID + "/approve");
  assert.equal(approved.status, 200);
  assert.equal(approved.payload.action.status, "QUEUED");

  const claimed = await h.request("POST", "/api/desktop/bridge/next", { token: TOKEN, body: {} });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.payload.action.id, ACTION_ID);
  assert.equal(claimed.payload.action.actionType, "launch_app");
  assert.equal(claimed.payload.action.payload.app, "calculator");
  assert.equal(claimed.payload.action.attempts, 1);
  assert.equal(Object.hasOwn(claimed.payload.action, "user_id"), false);
});

test("bridge token is required and a failed approval cannot claim work", async t => {
  const h = makeHarness();
  t.after(() => h.close());
  const created = await h.request("POST", "/api/desktop/actions", { body: { actionType: "system_info", payload: {} } });
  assert.equal(created.status, 201);
  const wrongToken = await h.request("POST", "/api/desktop/bridge/next", { token: "wrong-token", body: {} });
  assert.equal(wrongToken.status, 401);
  assert.equal(h.store.get(ACTION_ID).status, "PENDING_APPROVAL");
});

test("only the configured owner may request or approve local PC actions", async t => {
  const h = makeHarness({ authUserId: OTHER });
  t.after(() => h.close());
  const requested = await h.request("POST", "/api/desktop/actions", { body: { actionType: "system_info", payload: {} } });
  assert.equal(requested.status, 403);
  assert.equal(h.store.size, 0);
});

test("bridge result is bounded and must match the approved action", async t => {
  const h = makeHarness();
  t.after(() => h.close());
  await h.request("POST", "/api/desktop/actions", { body: { actionType: "open_url", payload: { url: "https://example.com/path" } } });
  await h.request("POST", "/api/desktop/actions/" + ACTION_ID + "/approve");
  await h.request("POST", "/api/desktop/bridge/next", { token: TOKEN, body: {} });

  const mismatch = await h.request("POST", "/api/desktop/bridge/ack", {
    token: TOKEN,
    body: { actionId: ACTION_ID, attempts: 1, state: "completed", result: { ok: true, summary: "Opened URL", host: "evil.example", platform: "windows" } }
  });
  assert.equal(mismatch.status, 400);
  assert.equal(h.store.get(ACTION_ID).status, "RUNNING");

  const acknowledged = await h.request("POST", "/api/desktop/bridge/ack", {
    token: TOKEN,
    body: { actionId: ACTION_ID, attempts: 1, state: "completed", result: { ok: true, summary: "Opened destination", host: "example.com", platform: "windows" } }
  });
  assert.equal(acknowledged.status, 200);
  assert.equal(acknowledged.payload.action.status, "COMPLETED");
  assert.equal(acknowledged.payload.action.result.host, "example.com");
  assert.equal(JSON.stringify(acknowledged.payload).includes("evil.example"), false);
});

test("queued desktop action may be cancelled before the bridge claims it", async t => {
  const h = makeHarness();
  t.after(() => h.close());
  await h.request("POST", "/api/desktop/actions", { body: { actionType: "launch_app", payload: { app: "notepad" } } });
  const cancelled = await h.request("POST", "/api/desktop/actions/" + ACTION_ID + "/cancel");
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.action.status, "CANCELLED");
  const next = await h.request("POST", "/api/desktop/bridge/next", { token: TOKEN, body: {} });
  assert.equal(next.payload.action, null);
});

test("stale bridge attempts and expired leases cannot acknowledge an action", async t => {
  const h = makeHarness();
  t.after(() => h.close());
  await h.request("POST", "/api/desktop/actions", { body: { actionType: "launch_app", payload: { app: "calculator" } } });
  await h.request("POST", "/api/desktop/actions/" + ACTION_ID + "/approve");
  await h.request("POST", "/api/desktop/bridge/next", { token: TOKEN, body: {} });

  const row = h.store.get(ACTION_ID);
  row.attempts = 2;
  row.lease_expires_at = new Date(Date.now() + 90_000).toISOString();
  const stale = await h.request("POST", "/api/desktop/bridge/ack", {
    token: TOKEN,
    body: { actionId: ACTION_ID, attempts: 1, state: "completed", result: { ok: true, summary: "Launched", app: "calculator" } }
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.error.code, "DESKTOP_ACTION_STALE_ATTEMPT");
  assert.equal(row.status, "RUNNING");

  row.lease_expires_at = new Date(Date.now() - 1000).toISOString();
  const expired = await h.request("POST", "/api/desktop/bridge/ack", {
    token: TOKEN,
    body: { actionId: ACTION_ID, attempts: 2, state: "completed", result: { ok: true, summary: "Launched", app: "calculator" } }
  });
  assert.equal(expired.status, 409);
  assert.equal(expired.payload.error.code, "DESKTOP_ACTION_LEASE_EXPIRED");
  assert.equal(row.status, "RUNNING");
});

