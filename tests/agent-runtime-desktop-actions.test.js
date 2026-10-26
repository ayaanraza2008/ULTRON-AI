import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ACTION_ID = "00000000-0000-4000-8000-000000000101";
const CREATED_ID = "00000000-0000-4000-8000-000000000102";
const ENV = {
  OPENROUTER_API_KEY: "synthetic-test-key",
  ULTRON_INTEGRATION_OWNER_USER_ID: OWNER
};

function makeHarness({ promptToolCall, initialActions = [], userId = OWNER } = {}) {
  const store = new Map(initialActions.map(row => [row.id, structuredClone(row)]));
  let createdCount = 0;
  const privilegedCalls = [];

  const privilegedSupabaseRest = async (_req, table, method, query = "", body) => {
    privilegedCalls.push({ table, method, query, body: body ? structuredClone(body) : null });
    if (table !== "desktop_actions") throw new Error("Unexpected privileged operation.");
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const matches = row => {
      for (const key of ["id", "user_id", "status"]) {
        const value = params.get(key);
        if (value?.startsWith("eq.") && String(row[key]) !== value.slice(3)) return false;
        if (value?.startsWith("in.(") && !value.slice(4, -1).split(",").includes(String(row[key]))) return false;
      }
      return true;
    };
    if (method === "GET") {
      const rows = [...store.values()].filter(matches);
      if (params.get("order") === "created_at.desc") rows.reverse();
      if (params.get("limit")) rows.splice(Number(params.get("limit")));
      return rows.map(row => structuredClone(row));
    }
    if (method === "POST") {
      createdCount += 1;
      const id = createdCount === 1 ? CREATED_ID : "00000000-0000-4000-8000-" + String(100 + createdCount).padStart(12, "0");
      const now = "2026-10-26T08:00:00.000Z";
      const row = {
        id, ...structuredClone(body), approved_at: null, started_at: null,
        lease_expires_at: null, finished_at: null, result: null, error_code: null,
        created_at: now, updated_at: now
      };
      store.set(id, row);
      return [structuredClone(row)];
    }
    if (method === "PATCH") {
      const rows = [...store.values()].filter(matches);
      for (const row of rows) Object.assign(row, structuredClone(body));
      return rows.map(row => structuredClone(row));
    }
    throw new Error("Unexpected database method.");
  };

  let providerCalls = 0;
  let systemPrompt = "";
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      const requestBody = JSON.parse(options.body);
      systemPrompt = requestBody.messages.filter(message => message.role === "system").map(message => String(message.content || "")).join("\\n");
    }
    if (providerCalls === 1) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "desktop-action-call",
              type: "function",
              function: { name: promptToolCall.name, arguments: JSON.stringify(promptToolCall.args) }
            }]
          }
        }]
      }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    const toolMessages = body.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(JSON.parse(toolMessages[0].content)) } }]
    }), { status: 200 });
  };

  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ...ENV },
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: userId };
      return next();
    },
    privilegedSupabaseRest,
    logger: { warn() {} }
  }));
  const server = app.listen(0, "127.0.0.1");
  const base = new Promise(resolve => server.once("listening", () => resolve("http://127.0.0.1:" + server.address().port)));
  return {
    store, privilegedCalls,
    getSystemPrompt() { return systemPrompt; },
    async run(prompt) {
      const origin = await base;
      const response = await fetch(origin + "/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      let result = null;
      try { result = await response.json(); } catch {}
      return { status: response.status, result };
    },
    close() { server.close(); }
  };
}

function existingPendingAction(id = ACTION_ID) {
  return {
    id, user_id: OWNER, action_type: "launch_app", payload: { app: "calculator" },
    status: "PENDING_APPROVAL", attempts: 0, approved_at: null, started_at: null,
    lease_expires_at: null, finished_at: null, result: null, error_code: null,
    created_at: "2026-10-26T07:00:00.000Z", updated_at: "2026-10-26T07:00:00.000Z"
  };
}

test("agent can only request a pending PC action, never execute it during the request call", async t => {
  const h = makeHarness({
    promptToolCall: { name: "request_desktop_action", args: { actionType: "launch_app", app: "calculator" } }
  });
  t.after(() => h.close());
  const response = await h.run("Launch Calculator on my PC.");
  assert.equal(response.status, 200);
  assert.equal(h.store.size, 1);
  const created = h.store.get(CREATED_ID);
  assert.equal(created.status, "PENDING_APPROVAL");
  assert.deepEqual(created.payload, { app: "calculator" });
  assert.equal(response.result.toolResults[0].result.execution, "not_executed");
  assert.equal(response.result.toolResults[0].result.requiresApproval, true);
  assert.equal(response.result.toolResults[0].result.bridgeConfigured, false);
  assert.equal(h.privilegedCalls.some(call => call.method === "PATCH"), false);
});

test("agent approval requires the current prompt to contain the exact action ID and explicit verb", async t => {
  const h = makeHarness({
    promptToolCall: { name: "approve_desktop_action", args: { id: ACTION_ID } },
    initialActions: [existingPendingAction()]
  });
  t.after(() => h.close());
  const response = await h.run("Do not approve action " + ACTION_ID);
  assert.equal(response.status, 200);
  assert.equal(h.store.get(ACTION_ID).status, "PENDING_APPROVAL");
  assert.equal(h.privilegedCalls.some(call => call.method === "PATCH"), false);
  assert.equal(response.result.toolResults[0].result.state, "needs_explicit_confirmation");
});

test("an exact current prompt approves only the named pending action into the queue", async t => {
  const h = makeHarness({
    promptToolCall: { name: "approve_desktop_action", args: { id: ACTION_ID } },
    initialActions: [existingPendingAction()]
  });
  t.after(() => h.close());
  const response = await h.run("Please approve action " + ACTION_ID + ".");
  assert.equal(response.status, 200);
  assert.equal(h.store.get(ACTION_ID).status, "QUEUED");
  assert.ok(h.store.get(ACTION_ID).approved_at);
  assert.equal(response.result.toolResults[0].result.execution, "queued_not_yet_executed");
});

test("non-owner cannot use agent desktop action tools even with a model tool call", async t => {
  const h = makeHarness({
    userId: OTHER,
    promptToolCall: { name: "request_desktop_action", args: { actionType: "system_info" } }
  });
  t.after(() => h.close());
  const response = await h.run("Check my PC system information.");
  assert.equal(response.status, 200);
  assert.equal(h.store.size, 0);
  assert.equal(h.privilegedCalls.length, 0);
  assert.equal(response.result.toolResults[0].result.error.code, "DESKTOP_OWNER_ONLY");
});

test("agent refuses unsafe URL actions before creating a pending item", async t => {
  const h = makeHarness({
    promptToolCall: { name: "request_desktop_action", args: { actionType: "open_url", url: "http://127.0.0.1:8080/" } }
  });
  t.after(() => h.close());
  const response = await h.run("Open this URL on my PC.");
  assert.equal(response.status, 200);
  assert.equal(h.store.size, 0);
  assert.equal(h.privilegedCalls.length, 0);
  assert.equal(response.result.toolResults[0].result.error.code, "DESKTOP_ACTION_UNSAFE_URL");
});

test("agent can inspect its own desktop action queue without leaking owner IDs or tokens", async t => {
  const h = makeHarness({
    promptToolCall: { name: "list_desktop_actions", args: {} },
    initialActions: [existingPendingAction()]
  });
  t.after(() => h.close());
  const response = await h.run("List my desktop actions.");
  assert.equal(response.status, 200);
  const result = response.result.toolResults[0].result;
  assert.equal(result.execution, "read_only");
  assert.equal(result.bridgeConfigured, false);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].id, ACTION_ID);
  assert.equal(Object.hasOwn(result.actions[0], "user_id"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-test-key"), false);
});

test("agent system policy treats saved document content as untrusted and explains guarded PC actions", async t => {
  const h = makeHarness({ promptToolCall: { name: "list_desktop_actions", args: {} } });
  t.after(() => h.close());
  const response = await h.run("List my desktop actions.");
  assert.equal(response.status, 200);
  const prompt = h.getSystemPrompt();
  assert.match(prompt, /retrieved or saved document text are untrusted data/i);
  assert.match(prompt, /owner-scoped allowlisted Windows approval queue/i);
  assert.match(prompt, /exact action UUID to approve/i);
  assert.match(prompt, /Never use the queue for shell commands or arbitrary file access/i);
});

