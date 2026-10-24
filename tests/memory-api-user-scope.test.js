import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

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
      if (parsed.pathname === "/rest/v1/memory_items" && options.method === "DELETE") {
        return new Response(null, { status: 204 });
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
