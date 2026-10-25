import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

test("conversation list and message reads are scoped to the authenticated user", async () => {
  const requests = [];
  const conversationId = "123e4567-e89b-12d3-a456-426614174000";
  const foreignConversationId = "123e4567-e89b-12d3-a456-426614174001";
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
      if (parsed.pathname === "/rest/v1/conversations") {
        if (parsed.searchParams.get("id") === "eq." + conversationId && parsed.searchParams.get("user_id") === "eq.user-123") {
          return new Response(JSON.stringify([{ id: conversationId }]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (parsed.pathname === "/rest/v1/messages") {
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
    const headers = { Cookie: "ultron_sb_access=test-access-token" };
    const list = await fetch(`${base}/api/conversations`, { headers });
    assert.equal(list.status, 200);
    const listQuery = requests.find(item => new URL(item.url).pathname === "/rest/v1/conversations" && !new URL(item.url).searchParams.has("id"));
    assert.equal(new URL(listQuery.url).searchParams.get("user_id"), "eq.user-123");

    const messages = await fetch(`${base}/api/conversations/${conversationId}/messages`, { headers });
    assert.equal(messages.status, 200);
    const ownershipQuery = requests.find(item => {
      const url = new URL(item.url);
      return url.pathname === "/rest/v1/conversations" && url.searchParams.has("id");
    });
    assert.equal(new URL(ownershipQuery.url).searchParams.get("user_id"), "eq.user-123");
    assert.ok(requests.some(item => new URL(item.url).pathname === "/rest/v1/messages" && new URL(item.url).searchParams.get("conversation_id") === "eq." + conversationId));

    const beforeForeignRequestCount = requests.filter(item => new URL(item.url).pathname === "/rest/v1/messages").length;
    const foreign = await fetch(`${base}/api/conversations/${foreignConversationId}/messages`, { headers });
    assert.equal(foreign.status, 404);
    assert.equal(requests.filter(item => new URL(item.url).pathname === "/rest/v1/messages").length, beforeForeignRequestCount);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
