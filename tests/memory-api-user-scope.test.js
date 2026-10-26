import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

test("memory expiry is validated on create and can be updated or cleared without cross-user writes", async () => {
  const requests = [];
  const memoryId = "123e4567-e89b-12d3-a456-426614174000";
  const app = createApp({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/rpc/ultron_is_current_session_active") {
        return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/memory_items") {
        const body = options.body ? JSON.parse(options.body) : null;
        requests.push({ method: options.method || "GET", url: String(url), body });
        const row = {
          ...(body || {}), id: memoryId, kind: body?.kind || "project_fact",
          title: body?.title || "Test memory", content: body?.content || "test content",
          source: "user_approved", is_active: body?.is_active ?? true,
          expires_at: body?.expires_at ?? null,
          created_at: "2026-10-25T08:00:00.000Z", updated_at: "2026-10-25T08:00:00.000Z"
        };
        return new Response(JSON.stringify(options.method === "POST" || options.method === "PATCH" ? [row] : []), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error("Unexpected upstream request: " + url);
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const headers = { Cookie: "ultron_sb_access=test-access-token", "Content-Type": "application/json" };
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await fetch(base + "/api/memory", {
      method: "POST", headers,
      body: JSON.stringify({ kind: "project_fact", title: "Expiring note", content: "Keep this only temporarily", expires_at: expiry })
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.item.expires_at, new Date(expiry).toISOString());
    assert.equal(requests[0].body.expires_at, new Date(expiry).toISOString());
    assert.equal(new URL(requests[0].url).searchParams.get("select")?.includes("expires_at"), true);

    const writesBeforeInvalid = requests.length;
    const invalid = await fetch(base + "/api/memory", {
      method: "POST", headers,
      body: JSON.stringify({ kind: "project_fact", title: "Past note", content: "must not save", expires_at: "2020-01-01T00:00:00.000Z" })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_MEMORY_EXPIRY");
    assert.equal(requests.length, writesBeforeInvalid, "invalid expiry must be rejected before any database write");

    const clear = await fetch(base + "/api/memory/" + memoryId, {
      method: "PATCH", headers, body: JSON.stringify({ expires_at: null })
    });
    assert.equal(clear.status, 200);
    assert.equal(requests[1].method, "PATCH");
    assert.equal(requests[1].body.expires_at, null);
    assert.equal(new URL(requests[1].url).searchParams.get("user_id"), "eq.user-123");

    const malformed = await fetch(base + "/api/memory/" + memoryId, {
      method: "PATCH", headers, body: JSON.stringify({ expires_at: "tomorrow" })
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "INVALID_MEMORY_EXPIRY");
    assert.equal(requests.length, 2, "invalid expiry updates must not reach Supabase");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("memory expiry rejects normalized invalid calendar dates and invalid timezone offsets before writes", async () => {
  let databaseWrites = 0;
  const app = createApp({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-publishable-key" },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } }); if (parsed.pathname === "/rest/v1/rpc/ultron_is_current_session_active") return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
      if (parsed.pathname === "/rest/v1/memory_items") {
        databaseWrites += 1;
        return new Response(JSON.stringify([{ id: "123e4567-e89b-12d3-a456-426614174000" }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected upstream request.");
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const headers = { Cookie: "ultron_sb_access=test-access-token", "Content-Type": "application/json" };
    const invalidValues = [
      "2026-02-30T12:00:00Z",
      "2026-13-01T12:00:00Z",
      "2026-01-01T25:00:00Z",
      "2026-01-01T12:00:00+14:30"
    ];
    for (const expires_at of invalidValues) {
      const response = await fetch(base + "/api/memory", {
        method: "POST", headers,
        body: JSON.stringify({ kind: "project_fact", title: "Invalid expiry", content: "must not be saved", expires_at })
      });
      assert.equal(response.status, 400, expires_at);
      assert.equal((await response.json()).error.code, "INVALID_MEMORY_EXPIRY");
    }
    assert.equal(databaseWrites, 0, "invalid timestamps must be rejected before touching Supabase");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("memory list, update, and delete queries are scoped to the authenticated user", async () => {
  const requests = [];
  const app = createApp({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      requests.push({ url: String(url), method: options.method || "GET" });
      if (parsed.pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/rpc/ultron_is_current_session_active") {
        return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/memory_items" && options.method === "DELETE") {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/memory_items") {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected upstream request: " + url);
    }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Cookie: "ultron_sb_access=test-access-token", "Content-Type": "application/json" };
    const list = await fetch(`${base}/api/memory`, { headers });
    assert.equal(list.status, 200);

    const id = "123e4567-e89b-12d3-a456-426614174000";
    const update = await fetch(`${base}/api/memory/${id}`, {
      method: "PATCH", headers, body: JSON.stringify({ is_active: false })
    });
    assert.equal(update.status, 404);
    const remove = await fetch(`${base}/api/memory/${id}`, { method: "DELETE", headers });
    assert.equal(remove.status, 200);

    const memoryRequests = requests.filter(item => new URL(item.url).pathname === "/rest/v1/memory_items");
    assert.equal(memoryRequests.length, 3);
    for (const item of memoryRequests) {
      assert.equal(new URL(item.url).searchParams.get("user_id"), "eq.user-123");
    }
    assert.equal(new URL(memoryRequests[1].url).searchParams.get("id"), `eq.${id}`);
    assert.equal(new URL(memoryRequests[2].url).searchParams.get("id"), `eq.${id}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
