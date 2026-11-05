import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const owner = "00000000-0000-4000-8000-000000000001";
const taskId = "11111111-1111-4111-8111-111111111111";

async function withApi({ userId = owner, env = {}, supabaseRest, privilegedSupabaseRest } = {}, run) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const requireSupabaseUser = (req, res, next) => {
    if (!userId) return res.status(401).json({ error: { code: "AUTHENTICATED_USER_REQUIRED" } });
    req.supabaseUser = { id: userId };
    next();
  };
  app.use("/api", createAgentRouter({
    env: {
      ULTRON_EMPLOYEES_ENABLED: "true",
      SUPABASE_SERVICE_ROLE_KEY: "worker-test-key",
      OPENROUTER_API_KEY: "provider-test-key",
      ...env
    },
    fetchImpl: async () => { throw new Error("Task API should not call a model directly."); },
    requireSupabaseUser,
    supabaseRest,
    privilegedSupabaseRest,
    logger: { warn() {} }
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

test("employee task list and detail are explicitly scoped to the authenticated owner", async () => {
  const queries = [];
  const supabaseRest = async (_req, table, method, query) => {
    assert.equal(table, "agent_tasks");
    assert.equal(method, "GET");
    queries.push(query);
    return [{
      id: taskId,
      title: "Owner's report",
      status: "COMPLETED",
      error_code: null,
      result: { answer: "Private result" },
      created_at: "2026-11-05T00:00:00.000Z",
      updated_at: "2026-11-05T00:01:00.000Z",
      finished_at: "2026-11-05T00:01:00.000Z"
    }];
  };
  await withApi({ supabaseRest }, async base => {
    const list = await fetch(base + "/api/agent/tasks?limit=999");
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.tasks.length, 1);
    assert.equal(listBody.tasks[0].title, "Owner's report");
    assert.equal(queries[0].includes("user_id=eq." + owner), true);
    assert.equal(queries[0].includes("limit=25"), true);

    const detail = await fetch(base + "/api/agent/tasks/" + taskId);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.deepEqual(detailBody.task.result, { answer: "Private result" });
    assert.equal(queries[1].includes("id=eq." + taskId), true);
    assert.equal(queries[1].includes("user_id=eq." + owner), true);
  });
});

test("employee task creation validates role/mode and stores draft-only worker input with an audit event", async () => {
  const writes = [];
  const audits = [];
  const supabaseRest = async (_req, table, method, query, body) => {
    writes.push({ table, method, query, body });
    assert.equal(table, "agent_tasks");
    assert.equal(method, "POST");
    return [{ id: taskId, title: body.title, status: body.status, created_at: "2026-11-05T00:00:00.000Z" }];
  };
  const privilegedSupabaseRest = async (_req, table, method, query, body, prefer) => {
    audits.push({ table, method, query, body, prefer });
    return [];
  };
  await withApi({ supabaseRest, privilegedSupabaseRest }, async base => {
    const invalid = await fetch(base + "/api/agent/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Review the build", role: "root", mode: "execute" })
    });
    assert.equal(invalid.status, 400);
    assert.equal(writes.length, 0);

    const response = await fetch(base + "/api/agent/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Review the repository dependencies", role: "web-dev", mode: "review" })
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.state, "queued");
    assert.equal(body.task.id, taskId);
    assert.equal(body.auditRecorded, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.user_id, owner);
    assert.equal(writes[0].body.status, "QUEUED");
    assert.equal(writes[0].body.input.approved, true);
    assert.equal(writes[0].body.input.requiresApproval, false);
    assert.equal(writes[0].body.input.executionMode, "employee_worker");
    assert.equal(writes[0].body.input.createdBy, "ultron_core_task_drawer");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].table, "audit_events");
    assert.equal(audits[0].body.user_id, owner);
    assert.equal(audits[0].body.action, "task.created_from_core_drawer");
  });
});

test("employee task detail returns 404 when the owner-scoped query finds no task", async () => {
  let query = "";
  const supabaseRest = async (_req, _table, _method, value) => { query = value; return []; };
  await withApi({ supabaseRest }, async base => {
    const response = await fetch(base + "/api/agent/tasks/" + taskId);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "TASK_NOT_FOUND");
    assert.equal(query.includes("user_id=eq." + owner), true);
  });
});

test("employee task creation fails closed when the worker or provider is not configured", async () => {
  let writes = 0;
  const supabaseRest = async () => { writes += 1; return []; };
  await withApi({ env: { ULTRON_EMPLOYEES_ENABLED: "false" }, supabaseRest }, async base => {
    const response = await fetch(base + "/api/agent/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Prepare a safe plan", role: "chief-of-staff", mode: "plan" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "EMPLOYEE_WORKER_NOT_CONFIGURED");
    assert.equal(writes, 0);
  });
});

test("employee task endpoints require a signed-in Supabase user", async () => {
  await withApi({ userId: null, supabaseRest: async () => [] }, async base => {
    const response = await fetch(base + "/api/agent/tasks");
    assert.equal(response.status, 401);
  });
});
