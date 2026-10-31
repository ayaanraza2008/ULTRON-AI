import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

async function withRouter({ env = {}, userId = "owner-user", supabaseRest, privilegedSupabaseRest, logger = { warn() {} } } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser, supabaseRest, privilegedSupabaseRest, logger }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("JARVIS router refuses to construct without real Supabase authentication middleware", () => {
  assert.throws(
    () => createJarvisRouter({ env: {} }),
    /requires the authenticated Supabase user middleware/
  );
});

test("JARVIS routes fail closed when the owner account is not configured", async () => {
  await withRouter({ env: {} }, async base => {
    const response = await fetch(base + "/api/jarvis/telemetry");
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "ULTRON_OWNER_NOT_CONFIGURED");
  });
});

test("JARVIS routes reject authenticated users other than the configured owner", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" },
    userId: "different-user"
  }, async base => {
    const response = await fetch(base + "/api/jarvis/agents");
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "ULTRON_OWNER_ONLY");
  });
});

test("JARVIS API distinguishes the 18-agent capability catalogue from executable worker roles", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/agents");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.agents.length, 18);
    assert.equal(body.taskExecution.backend, "durable_supabase_worker");
    assert.ok(body.taskExecution.supportedRoles.includes("chief-of-staff"));
    assert.ok(body.taskExecution.supportedModes.includes("plan"));
    assert.match(body.taskExecution.note, /does not dispatch arbitrary per-agent tool steps/);
  });
});

test("configured owner can read JARVIS status without misreporting the hosted OS as Windows", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/telemetry");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.telemetry.platform, process.platform);
    assert.equal(body.telemetry.architecture, process.arch);
    assert.equal(body.telemetry.executionEnvironment, "server_process");
  });
});

test("JARVIS does not expose normal Node child-process execution as a sandbox", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/sandbox/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "throw new Error('must_not_execute')" })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "CODE_SANDBOX_NOT_AVAILABLE");
  });
});

test("JARVIS queues allowlisted plan work through the durable Supabase worker and cancels account tasks on emergency stop", async () => {
  const stored = new Map();
  const dbCalls = [];
  const auditCalls = [];
  const supabaseRest = async (req, table, method, query, body) => {
    dbCalls.push({ userId: req.supabaseUser.id, table, method, query, body });
    if (table !== "agent_tasks") throw new Error("Unexpected table");

    if (method === "POST") {
      const row = {
        id: "task-123",
        title: body.title,
        status: body.status,
        created_at: "2026-10-31T00:00:00.000Z",
        user_id: body.user_id,
        input: body.input
      };
      stored.set(row.id, row);
      return [row];
    }

    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const userValue = params.get("user_id") || "";
    const userFilter = userValue.startsWith("eq.") ? userValue.slice(3) : userValue;

    if (method === "GET") {
      const idValue = params.get("id") || "";
      const idFilter = idValue.startsWith("eq.") ? idValue.slice(3) : idValue;
      return [...stored.values()].filter(row =>
        row.user_id === userFilter && (!idFilter || row.id === idFilter)
      );
    }

    if (method === "PATCH") {
      const rows = [...stored.values()].filter(row =>
        row.user_id === userFilter &&
        ["QUEUED", "RUNNING", "WAITING_FOR_PERMISSION"].includes(row.status)
      );
      for (const row of rows) row.status = body.status;
      return rows;
    }

    throw new Error("Unexpected task operation");
  };
  const privilegedSupabaseRest = async (req, table, method, query, body) => {
    auditCalls.push({ userId: req.supabaseUser.id, table, method, body });
    return [];
  };
  const env = {
    ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user",
    ULTRON_EMPLOYEES_ENABLED: "true",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
    OPENROUTER_API_KEY: "synthetic-openrouter-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free"
  };

  await withRouter({ env, supabaseRest, privilegedSupabaseRest }, async base => {
    const response = await fetch(base + "/api/jarvis/agents/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Research current AI agent safety and prepare a report", role: "chief-of-staff", mode: "report", context: "Synthetic queue test" })
    });
    const payload = await response.json();
    assert.equal(response.status, 202);
    assert.equal(payload.success, true);
    assert.equal(payload.task.status, "QUEUED");
    assert.equal(payload.execution.backend, "durable_supabase_worker");
    assert.equal(payload.execution.type, "bounded_research_to_report");
    assert.equal(payload.auditRecorded, true);
    assert.equal(dbCalls[0].userId, "owner-user");
    assert.equal(dbCalls[0].body.user_id, "owner-user");
    assert.equal(dbCalls[0].body.status, "QUEUED");
    assert.equal(dbCalls[0].body.input.taskType, "autonomous");
    assert.equal(dbCalls[0].body.input.requiresApproval, false);
    assert.equal(dbCalls[0].body.input.executionMode, "employee_worker");
    assert.equal("steps" in dbCalls[0].body.input, false);
    assert.equal(auditCalls[0].table, "audit_events");
    assert.equal(auditCalls[0].body.target_id, "task-123");

    const list = await fetch(base + "/api/jarvis/agents/tasks");
    const listed = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listed.executionBackend, "durable_supabase_worker");
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].id, "task-123");

    const item = await fetch(base + "/api/jarvis/agents/tasks/task-123");
    const itemBody = await item.json();
    assert.equal(item.status, 200);
    assert.equal(itemBody.task.id, "task-123");

    const stop = await fetch(base + "/api/jarvis/emergency/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "synthetic test stop" })
    });
    const stopped = await stop.json();
    assert.equal(stop.status, 200);
    assert.equal(stopped.halted, true);
    assert.deepEqual(stopped.cancelledTaskIds, ["task-123"]);
    assert.equal(stored.get("task-123").status, "CANCELLED");
    const cancelCall = dbCalls.find(call => call.method === "PATCH");
    assert.deepEqual(cancelCall.body, { status: "CANCELLED" });
    assert.ok(cancelCall.query.includes("status=in.(QUEUED,RUNNING,WAITING_FOR_PERMISSION)"));

    const blocked = await fetch(base + "/api/jarvis/agents/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Another draft" })
    });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error.code, "JARVIS_EMERGENCY_STOP_ACTIVE");

    const reset = await fetch(base + "/api/jarvis/emergency/reset", { method: "POST" });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).scope, "this_server_process_only");
  });
});

test("JARVIS refuses to queue tasks when the worker/provider configuration is incomplete", async () => {
  let writes = 0;
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" },
    supabaseRest: async () => { writes += 1; return []; }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/agents/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Prepare a test plan" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "JARVIS_WORKER_NOT_READY");
    assert.equal(writes, 0);
  });
});

test("JARVIS rejects arbitrary steps, tools, and unsupported employee roles", async () => {
  const supabaseRest = async () => { throw new Error("Should not reach storage"); };
  const env = {
    ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user",
    ULTRON_EMPLOYEES_ENABLED: "true",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
    OPENROUTER_API_KEY: "synthetic-openrouter-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free"
  };
  await withRouter({ env, supabaseRest }, async base => {
    const arbitrary = await fetch(base + "/api/jarvis/agents/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Run arbitrary command", steps: [{ action: "rm -rf" }] })
    });
    assert.equal(arbitrary.status, 400);
    assert.equal((await arbitrary.json()).error.code, "JARVIS_TASK_FIELDS_NOT_ALLOWED");

    const invalidRole = await fetch(base + "/api/jarvis/agents/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Prepare a plan", role: "system-agent" })
    });
    assert.equal(invalidRole.status, 400);
    assert.equal((await invalidRole.json()).error.code, "INVALID_JARVIS_EMPLOYEE_TASK");
  });
});

test("JARVIS keeps unbacked device and smart-home prototypes unavailable", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const pair = await fetch(base + "/api/jarvis/devices/pair/request", { method: "POST" });
    assert.equal(pair.status, 503);
    assert.equal((await pair.json()).error.code, "DEVICE_PAIRING_NOT_CONFIGURED");

    const devices = await fetch(base + "/api/jarvis/devices");
    assert.equal(devices.status, 200);
    assert.deepEqual(await devices.json(), { devices: [], connected: false, status: "NOT_CONFIGURED" });

    const actuate = await fetch(base + "/api/jarvis/smarthome/actuate", { method: "POST" });
    assert.equal(actuate.status, 503);
    assert.equal((await actuate.json()).error.code, "SMART_HOME_NOT_CONFIGURED");
  });
});
