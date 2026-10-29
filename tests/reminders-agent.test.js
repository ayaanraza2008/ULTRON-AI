import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";
import { classifyTaskRoute } from "../task-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const REMINDER_ID = "40000000-0000-4000-8000-000000000001";

async function withAgentServer(env, fetchImpl, supabaseRest, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ...env, ULTRON_INTEGRATION_OWNER_USER_ID: USER_ID },
    fetchImpl,
    supabaseRest,
    privilegedSupabaseRest: supabaseRest,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: USER_ID };
      next();
    },
    logger: { warn() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function providerReply(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function sendPrompt(base, prompt) {
  return fetch(base + "/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
}

test("task router narrows reminder requests to only reminder tools", () => {
  const route = classifyTaskRoute("List my reminders");
  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["reminders"]);
  assert.equal(route.filtered, true);
  assert.deepEqual(route.toolNames, ["list_reminders", "create_reminder", "update_reminder"]);
});

test("agent lists reminders with authenticated-user filtering and no notification claims", async () => {
  let providerCalls = 0;
  let dbReads = 0;
  let firstToolSchema;
  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await withAgentServer({ OPENROUTER_API_KEY: "reminders-list-test-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    firstToolSchema ||= payload.tools.map(tool => tool.function.name);
    const hasReminderResult = payload.messages.some(message => message.role === "tool"
      && typeof message.content === "string" && message.content.includes('"title":"Call dentist"'));
    if (hasReminderResult) {
      return providerReply({ role: "assistant", content: "You have one saved reminder: Call dentist. This is a stored record, not proof of an alert." });
    }
    return providerReply({
      content: null,
      tool_calls: [{
        id: "reminders-list-call",
        type: "function",
        function: { name: "list_reminders", arguments: JSON.stringify({ status: "scheduled", limit: 5 }) }
      }]
    });
  }, async (req, table, method, query) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    dbReads += 1;
    assert.equal(table, "user_reminders");
    assert.equal(method, "GET");
    assert.ok(query.includes("user_id=eq." + USER_ID));
    assert.ok(query.includes("status=eq.scheduled"));
    assert.equal(req.supabaseUser.id, USER_ID);
    return [{
      id: REMINDER_ID,
      user_id: USER_ID,
      title: "Call dentist",
      body: "Ask about the appointment",
      due_at: dueAt,
      status: "scheduled",
      created_at: dueAt,
      updated_at: dueAt
    }];
  }, async base => {
    const response = await sendPrompt(base, "List my reminders");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Call dentist/);
    assert.deepEqual(firstToolSchema, ["list_reminders", "create_reminder", "update_reminder"]);
    assert.equal(body.toolResults[0].result.state, "completed");
    assert.equal(body.toolResults[0].result.reminders[0].id, REMINDER_ID);
    assert.match(body.toolResults[0].result.notice, /does not prove a notification/i);
  });
  assert.equal(providerCalls, 2);
  assert.equal(dbReads, 1);
});

test("agent saves a reminder only when the user supplied its exact future ISO timestamp", async () => {
  let providerCalls = 0;
  let reminderWrites = 0;
  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const dueAtWire = dueAt;
  await withAgentServer({ OPENROUTER_API_KEY: "reminders-create-test-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasCreateResult = payload.messages.some(message => message.role === "tool"
      && typeof message.content === "string" && message.content.includes('"state":"created"'));
    if (hasCreateResult) return providerReply({
      role: "assistant",
      content: "I saved the Call dentist reminder for the exact time you provided. No alert delivery is configured."
    });
    return providerReply({
      content: null,
      tool_calls: [{
        id: "reminders-create-call",
        type: "function",
        function: {
          name: "create_reminder",
          arguments: JSON.stringify({
            title: "Call dentist",
            body: "Ask about the appointment",
            dueAt: dueAtWire,
            user_id: "99999999-9999-4999-8999-999999999999"
          })
        }
      }]
    });
  }, async (_req, table, method, query, body) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    reminderWrites += 1;
    assert.equal(table, "user_reminders");
    assert.equal(method, "POST");
    assert.equal(query, "");
    assert.equal(body.user_id, USER_ID, "the authenticated session is the only source of owner ID");
    assert.equal(body.due_at, dueAt);
    assert.equal(body.status, "scheduled");
    return [{ ...body, id: REMINDER_ID, created_at: dueAt, updated_at: dueAt }];
  }, async base => {
    const response = await sendPrompt(base, "Remind me to call the dentist at " + dueAt);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /saved the Call dentist reminder/i);
    assert.equal(body.toolsUsed[0].name, "create_reminder");
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.state, "created");
    assert.equal(body.toolResults[0].result.reminder.id, REMINDER_ID);
    assert.match(body.toolResults[0].result.notice, /no notification delivery/i);
  });
  assert.equal(providerCalls, 2);
  assert.equal(reminderWrites, 1);
});

test("agent refuses to save a provider-invented due time when the user only says tomorrow", async () => {
  let providerCalls = 0;
  let reminderWrites = 0;
  const inventedDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await withAgentServer({ OPENROUTER_API_KEY: "reminders-no-inferred-time-test-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasClarification = payload.messages.some(message => message.role === "tool"
      && typeof message.content === "string" && message.content.includes('"state":"clarification_required"'));
    if (hasClarification) return providerReply({
      role: "assistant",
      content: "What exact date, time and timezone should I use? I have not saved a reminder."
    });
    return providerReply({
      content: null,
      tool_calls: [{
        id: "reminders-invented-time-call",
        type: "function",
        function: {
          name: "create_reminder",
          arguments: JSON.stringify({ title: "Call dentist", dueAt: inventedDueAt })
        }
      }]
    });
  }, async (_req, table, method) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    if (table === "user_reminders" && method === "POST") reminderWrites += 1;
    throw new Error("A relative-time request must not be written to the reminders table.");
  }, async base => {
    const response = await sendPrompt(base, "Remind me to call the dentist tomorrow");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /exact date, time and timezone/i);
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.state, "clarification_required");
    assert.equal(body.toolResults[0].result.dueAt, null);
  });
  assert.equal(providerCalls, 2);
  assert.equal(reminderWrites, 0);
});

test("agent can mark an existing reminder complete through an owner-filtered update", async () => {
  let providerCalls = 0;
  let updates = 0;
  await withAgentServer({ OPENROUTER_API_KEY: "reminders-update-test-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasUpdated = payload.messages.some(message => message.role === "tool"
      && typeof message.content === "string" && message.content.includes('"state":"updated"'));
    if (hasUpdated) return providerReply({ role: "assistant", content: "I marked your Call dentist reminder as completed." });
    return providerReply({
      content: null,
      tool_calls: [{
        id: "reminders-update-call",
        type: "function",
        function: { name: "update_reminder", arguments: JSON.stringify({ id: REMINDER_ID, status: "completed" }) }
      }]
    });
  }, async (_req, table, method, query, patch) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    updates += 1;
    assert.equal(table, "user_reminders");
    assert.equal(method, "PATCH");
    assert.ok(query.includes("id=eq." + REMINDER_ID));
    assert.ok(query.includes("user_id=eq." + USER_ID));
    assert.deepEqual(patch, { status: "completed" });
    return [{
      id: REMINDER_ID, title: "Call dentist", body: "", due_at: new Date(Date.now() + 3600000).toISOString(),
      status: "completed", created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }];
  }, async base => {
    const response = await sendPrompt(base, "Mark reminder " + REMINDER_ID + " as completed");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /marked your Call dentist reminder as completed/i);
    assert.equal(body.toolResults[0].result.state, "updated");
    assert.equal(body.toolResults[0].result.reminder.status, "completed");
  });
  assert.equal(providerCalls, 2);
  assert.equal(updates, 1);
});
