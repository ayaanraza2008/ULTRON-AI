import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { createAgentRouter } from "../agent-runtime.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BASE_ENV = {
  OPENROUTER_API_KEY: "test-only-provider-key",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_DEFAULT_MODEL: "openrouter/free",
  ULTRON_EMPLOYEES_ENABLED: "true",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role"
};

async function withServer({ fetchImpl, supabaseRest, privilegedSupabaseRest = supabaseRest }, run, userId = USER_ID) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: BASE_ENV,
    fetchImpl,
    supabaseRest,
    privilegedSupabaseRest,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: userId };
      next();
    },
    logger: { info() {}, warn() {}, error() {} }
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

function providerFetchImpl() {
  return async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    if (Array.isArray(body.tools) && body.tools.some(tool => tool.function?.name === "enqueue_employee_task")) {
      const prompt = body.messages.filter(message => message.role === "user").at(-1)?.content || "Queue a web-dev review in the background";
      const role = /chief-of-staff/i.test(prompt) ? "chief-of-staff" : "web-dev";
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "enqueue-task-call",
              type: "function",
              function: {
                name: "enqueue_employee_task",
                arguments: JSON.stringify({ role, goal: prompt, mode: "review" })
              }
            }]
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Task request processed." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

function taskStore({ raceLookups = false } = {}) {
  const tasks = [];
  const auditEvents = [];
  let idSequence = 0;
  let keyedLookups = 0;
  let releaseKeyedLookups;
  const keyedLookupGate = new Promise(resolve => { releaseKeyedLookups = resolve; });

  const supabaseRest = async (req, table, method, query = "", body) => {
    if (table === "user_preferences" || table === "memory_items") return [];
    if (table === "audit_events") {
      auditEvents.push(body);
      return [];
    }
    if (table !== "agent_tasks") return [];

    if (method === "GET" && query.includes("input->>idempotencyKey")) {
      keyedLookups += 1;
      if (raceLookups && keyedLookups <= 2) {
        if (keyedLookups === 2) releaseKeyedLookups();
        await keyedLookupGate;
      }
      const match = query.match(/input->>idempotencyKey=eq\.([a-f0-9]{64})/);
      const keyHash = match?.[1];
      return keyHash
        ? tasks.filter(task => task.user_id === req.supabaseUser.id && task.input.idempotencyKey === keyHash)
        : [];
    }

    if (method === "POST") {
      const keyHash = body.input?.idempotencyKey;
      if (keyHash && tasks.some(task => task.user_id === body.user_id && task.input.idempotencyKey === keyHash)) {
        throw Object.assign(new Error("Unique task idempotency key conflict"), { status: 409 });
      }
      const task = {
        id: "task-" + (++idSequence),
        user_id: body.user_id,
        title: body.title,
        input: body.input,
        status: body.status,
        created_at: "2026-10-28T00:00:00.000Z"
      };
      tasks.push(task);
      return [task];
    }
    return [];
  };

  return { supabaseRest, tasks, auditEvents, get keyedLookups() { return keyedLookups; } };
}

async function queueTask(base, prompt, idempotencyKey) {
  const headers = { "Content-Type": "application/json" };
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(base + "/api/agent/run", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, confirmBackgroundTask: true })
  });
}

test("retries with the same Idempotency-Key reuse one persisted task without a second audit insert", async () => {
  const store = taskStore();
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const prompt = "Queue a web-dev review in the background";
    const firstResponse = await queueTask(base, prompt, "ultron-task-request-0001");
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.equal(first.toolResults[0].result.state, "queued");
    assert.equal(first.toolResults[0].result.deduplicated, undefined);

    const retryResponse = await queueTask(base, prompt, "ultron-task-request-0001");
    const retry = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
    assert.equal(retry.toolResults[0].result.state, "queued");
    assert.equal(retry.toolResults[0].result.deduplicated, true);
    assert.equal(retry.toolResults[0].result.task.id, first.toolResults[0].result.task.id);
    assert.equal(store.tasks.length, 1);
    assert.equal(store.auditEvents.length, 1, "reusing a task must not emit a second creation audit");
  });
});

test("reusing an Idempotency-Key for a different task fails instead of silently aliasing requests", async () => {
  const store = taskStore();
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const first = await queueTask(base, "Queue a web-dev review in the background", "ultron-task-request-0002");
    assert.equal(first.status, 200);
    await first.json();

    const second = await queueTask(base, "Queue a different web-dev review in the background", "ultron-task-request-0002");
    const result = await second.json();
    assert.equal(second.status, 200);
    assert.equal(result.toolResults[0].result.error.code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(store.tasks.length, 1);
  });
});

test("requests without an Idempotency-Key retain intentional repeat-task behavior", async () => {
  const store = taskStore();
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const prompt = "Queue a web-dev review in the background";
    const first = await queueTask(base, prompt);
    const second = await queueTask(base, prompt);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    await first.json();
    await second.json();
    assert.equal(store.tasks.length, 2);
    assert.equal(store.keyedLookups, 0);
  });
});

test("concurrent same-key requests recover from the database unique-index conflict", async () => {
  const store = taskStore({ raceLookups: true });
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const prompt = "Queue a web-dev review in the background";
    const [responseA, responseB] = await Promise.all([
      queueTask(base, prompt, "ultron-task-request-race-01"),
      queueTask(base, prompt, "ultron-task-request-race-01")
    ]);
    const [a, b] = await Promise.all([responseA.json(), responseB.json()]);
    assert.equal(responseA.status, 200);
    assert.equal(responseB.status, 200);
    assert.equal(store.tasks.length, 1);
    assert.equal(a.toolResults[0].result.task.id, b.toolResults[0].result.task.id);
    assert.equal([a.toolResults[0].result.deduplicated, b.toolResults[0].result.deduplicated].filter(Boolean).length, 1);
    assert.equal(store.auditEvents.length, 1);
  });
});

test("same submitted request reuses its task even if model-generated tool arguments drift", async () => {
  const store = taskStore();
  let toolCalls = 0;
  const fetchImpl = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    if (Array.isArray(body.tools) && body.tools.some(tool => tool.function?.name === "enqueue_employee_task")) {
      toolCalls += 1;
      const goal = toolCalls === 1 ? "Queue a web-dev review in the background" : "Queue a web-dev review plus dependency checks in the background";
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "enqueue-task-call-" + toolCalls,
              type: "function",
              function: {
                name: "enqueue_employee_task",
                arguments: JSON.stringify({ role: "web-dev", goal, mode: "review" })
              }
            }]
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Task request processed." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await withServer({ fetchImpl, supabaseRest: store.supabaseRest }, async base => {
    const prompt = "Queue a web-dev review in the background";
    const first = await queueTask(base, prompt, "ultron-task-request-model-drift-01");
    const firstBody = await first.json();
    const second = await queueTask(base, prompt, "ultron-task-request-model-drift-01");
    const secondBody = await second.json();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(store.tasks.length, 1);
    assert.equal(firstBody.toolResults[0].result.task.id, secondBody.toolResults[0].result.task.id);
    assert.equal(secondBody.toolResults[0].result.deduplicated, true);
    assert.equal(store.auditEvents.length, 1);
  });
});

test("the same key is isolated per user and never reuses another account's task", async () => {
  const store = taskStore();
  const prompt = "Queue a web-dev review in the background";
  let firstTask;
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const first = await queueTask(base, prompt, "shared-key-across-users-01");
    assert.equal(first.status, 200);
    firstTask = (await first.json()).toolResults[0].result.task;
  }, USER_ID);

  const secondUser = "00000000-0000-4000-8000-000000000002";
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const second = await queueTask(base, prompt, "shared-key-across-users-01");
    assert.equal(second.status, 200);
    const secondTask = (await second.json()).toolResults[0].result.task;
    assert.notEqual(secondTask.id, firstTask.id);
    assert.equal(secondTask.user_id, secondUser);
  }, secondUser);

  assert.equal(store.tasks.length, 2);
  assert.deepEqual(new Set(store.tasks.map(task => task.user_id)), new Set([USER_ID, secondUser]));
  assert.equal(store.auditEvents.length, 2);
});

test("malformed Idempotency-Key values cannot enqueue a task", async () => {
  const store = taskStore();
  await withServer({ fetchImpl: providerFetchImpl(), supabaseRest: store.supabaseRest }, async base => {
    const response = await queueTask(base, "Queue a web-dev review in the background", "short");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.toolResults[0].result.error.code, "IDEMPOTENCY_KEY_INVALID");
    assert.equal(store.tasks.length, 0);
  });
});

test("task idempotency migration enforces per-user uniqueness only for keyed tasks", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20261028123000_agent_task_idempotency.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /create\s+unique\s+index\s+if\s+not\s+exists\s+agent_tasks_user_idempotency_key_uidx/i);
  assert.match(migration, /on\s+public\.agent_tasks\s*\(\s*user_id\s*,\s*\(input\s*->>\s*'idempotencyKey'\)\s*\)/i);
  assert.match(migration, /where\s+input\s*\?\s*'idempotencyKey'/i);
});
