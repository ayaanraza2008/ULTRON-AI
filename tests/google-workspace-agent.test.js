import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbx0123456789abcdefghijklmnopqrstuv/exec";
const BRIDGE_TOKEN = "test-only-google-workspace-token-with-at-least-32-characters";

test("agent routes Gmail requests to the owner-scoped read-only bridge and summarizes returned data", async () => {
  const calls = { provider: [], bridge: [], supabase: [] };
  const env = {
    OPENROUTER_API_KEY: "synthetic-provider-test-key",
    ULTRON_INTEGRATION_OWNER_USER_ID: OWNER,
    GOOGLE_WORKSPACE_BRIDGE_URL: BRIDGE_URL,
    GOOGLE_WORKSPACE_BRIDGE_TOKEN: BRIDGE_TOKEN
  };
  const supabaseRest = async (_req, table, method, query, body) => {
    calls.supabase.push({ table, method, query, body });
    if (table === "user_preferences" && method === "GET") return [{ memory_enabled: true }];
    if (table === "memory_items" && method === "GET") return [];
    if (table === "memory_items" && method === "POST") return [{ id: "mem-test", ...body }];
    return [];
  };
  const fetchImpl = async (url, options) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const request = JSON.parse(options.body);
      calls.provider.push(request);
      if (calls.provider.length === 1) {
        const names = request.tools.map(tool => tool.function.name);
        assert.ok(names.includes("google_gmail_search"));
        assert.ok(names.includes("google_gmail_list_unread"));
        assert.ok(!names.includes("research_web"));
        assert.ok(names.length < 42);
        return new Response(JSON.stringify({
          choices: [{ message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "google-gmail-search-1",
              type: "function",
              function: {
                name: "google_gmail_search",
                arguments: JSON.stringify({ query: "is:unread from:school.edu", limit: 5 })
              }
            }]
          } }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I found one unread project email from school.edu." } }]
      }), { status: 200 });
    }
    if (url === BRIDGE_URL) {
      calls.bridge.push({ url, options });
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "manual");
      const body = JSON.parse(options.body);
      assert.equal(body.bridgeToken, BRIDGE_TOKEN);
      assert.equal(body.action, "gmail_search");
      assert.deepEqual(body.params, { query: "is:unread from:school.edu", limit: 5 });
      return new Response(JSON.stringify({
        status: "success",
        data: {
          count: 1,
          emails: [{ subject: "Project meeting", from: "teacher@school.edu", date: "2026-10-29T08:00:00.000Z", snippet: "Discuss the project deadline." }]
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected network request: " + url);
  };

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    fetchImpl,
    supabaseRest,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: OWNER }; next(); },
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Search Gmail for unread project emails from school.edu" })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.routing.tier, "medium");
    assert.equal(result.routing.toolSchemasFiltered, true);
    assert.equal(result.toolsUsed[0].name, "google_gmail_search");
    assert.equal(result.toolsUsed[0].ok, true);
    assert.equal(result.toolResults[0].result.state, "completed");
    assert.equal(result.toolResults[0].result.data.count, 1);
    assert.equal(calls.provider.length, 2);
    assert.equal(calls.bridge.length, 1);
    assert.equal(JSON.stringify(result).includes(BRIDGE_TOKEN), false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
