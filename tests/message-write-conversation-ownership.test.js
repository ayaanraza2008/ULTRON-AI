import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

test("message writes require ownership of the target conversation", async () => {
  const requests = [];
  const ownedId = "123e4567-e89b-12d3-a456-426614174000";
  const foreignId = "123e4567-e89b-12d3-a456-426614174001";
  const app = createApp({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      const method = options.method || "GET";
      requests.push({ url: String(url), method });
      if (parsed.pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: "user-123" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/conversations") {
        const allowed = parsed.searchParams.get("id") === "eq." + ownedId && parsed.searchParams.get("user_id") === "eq.user-123";
        return new Response(JSON.stringify(allowed ? [{ id: ownedId }] : []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/messages" && method === "POST") {
        const body = JSON.parse(options.body);
        return new Response(JSON.stringify([{ id: "message-1", conversation_id: body.conversation_id, role: body.role, content: body.content }]), { status: 201, headers: { "Content-Type": "application/json" } });
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
    const body = JSON.stringify({ role: "user", content: "Hello ULTRON" });

    const owned = await fetch(`${base}/api/conversations/${ownedId}/messages`, { method: "POST", headers, body });
    assert.equal(owned.status, 201);
    const ownershipRequest = requests.find(item => new URL(item.url).pathname === "/rest/v1/conversations");
    assert.equal(new URL(ownershipRequest.url).searchParams.get("user_id"), "eq.user-123");

    const writesBeforeForeign = requests.filter(item => new URL(item.url).pathname === "/rest/v1/messages" && item.method === "POST").length;
    const foreign = await fetch(`${base}/api/conversations/${foreignId}/messages`, { method: "POST", headers, body });
    assert.equal(foreign.status, 404);
    assert.equal(requests.filter(item => new URL(item.url).pathname === "/rest/v1/messages" && item.method === "POST").length, writesBeforeForeign);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
