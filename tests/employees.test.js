import test from "node:test";
import { startWorker } from "../worker.js";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

async function withServer(env, run, fetchImpl = async () => {
  throw new Error("unexpected network request");
}) {
  const app = express();
  app.use(express.json());
  const requireSession = (_req, _res, next) => next();
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createFeatureRouter({ env, requireSession, requireSupabaseUser, supabaseRest: async () => [], fetchImpl, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("AI Employee registry exposes eight roles and transparent scheduler status", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/roles");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.roles.length, 8);
    assert.equal(body.totalRoleRoutineSlots, 60);
    assert.equal(body.routineTemplates.length, 60);
    assert.equal(new Set(body.routineTemplates.map(item => item.id)).size, 60);
    assert.equal(body.scheduler, "not_configured");
    assert.equal(body.execution, "planning_and_drafting_only");
    assert.match(body.source, /markfulton\/ai-employees/);
  });
});

test("AI Employee routine catalog can be filtered by a known role", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/routines?role=web-dev");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.routines.length > 0);
    assert.ok(body.routines.every(item => item.roles.includes("web-dev")));
  });
});

test("AI Employee planner validates role and goal before provider calls", async () => {
  let called = false;
  await withServer({ OPENROUTER_API_KEY: "test-key" }, async base => {
    const badRole = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "unknown", goal: "Plan a launch" })
    });
    assert.equal(badRole.status, 400);
    const noGoal = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "gtm-engineer", goal: " " })
    });
    assert.equal(noGoal.status, 400);
    assert.equal(called, false);
  }, async () => { called = true; throw new Error("must not call provider"); });
});

test("AI Employee planner generates a draft but explicitly does not execute it", async () => {
  let request;
  await withServer({ OPENROUTER_API_KEY: "test-key", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, async base => {
    const response = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "social-media", mode: "draft", goal: "Prepare three launch posts" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.role.id, "social-media");
    assert.equal(body.mode, "draft");
    assert.equal(body.execution, "not_executed");
    assert.equal(body.requiresHumanApprovalForExternalActions, true);
    assert.match(body.notice, /No schedule was registered/i);
    assert.equal(request.model, "openrouter/free");
    assert.match(request.messages[0].content, /Never send messages, publish posts/i);
  }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.redirect, "error");
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ model: "openrouter/free", choices: [{ message: { content: "## Draft\\n1. Prepare three editable posts.\\n2. Review claims and brand tone.\\n3. Request approval before publishing." } }] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  });
});

test("AI Employee planner rejects oversized provider responses without parsing them", async () => {
  await withServer({ OPENROUTER_API_KEY: "test-key" }, async base => {
    const response = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "chief-of-staff", goal: "Summarize blockers" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "EMPLOYEE_INVALID_PROVIDER_RESPONSE");
  }, async () => ({
    ok: true,
    headers: { get: name => name.toLowerCase() === "content-length" ? "2000001" : null },
    body: { cancel: async () => { } }
  }));
});

test("AI Employee planner fails closed when provider redirects are rejected", async () => {
  await withServer({ OPENROUTER_API_KEY: "test-key" }, async base => {
    const response = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "chief-of-staff", goal: "Summarize blockers" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "EMPLOYEE_REQUEST_FAILED");
  }, async (_url, options) => {
    assert.equal(options.redirect, "error");
    throw new TypeError("redirect mode error");
  });
});

test("AI Employee planner rejects unsafe provider base URLs before network access", async () => {
  for (const providerUrl of [
    "https://127.0.0.1:8080",
    "https://192.168.1.5",
    "https://metadata.google.internal",
    "https://user:password@openrouter.ai/api/v1",
    "http://openrouter.ai/api/v1"
  ]) {
    let called = false;
    await withServer({ OPENROUTER_API_KEY: "test-key", OPENROUTER_BASE_URL: providerUrl }, async base => {
      const response = await fetch(base + "/api/employees/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "chief-of-staff", goal: "Summarize blockers" })
      });
      assert.equal(response.status, 503, providerUrl);
      assert.equal((await response.json()).error.code, "EMPLOYEE_PROVIDER_NOT_CONFIGURED", providerUrl);
      assert.equal(called, false, providerUrl);
    }, async () => { called = true; throw new Error("unsafe provider URL must never be contacted"); });
  }
});

test("AI Employee planner fails closed when no provider is configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "chief-of-staff", goal: "Summarize blockers" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "EMPLOYEE_PROVIDER_NOT_CONFIGURED");
  });
});

test("employee schedule API rejects a routine not assigned to the selected role", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/schedules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "web-dev", routineId: "research-sweep", goal: "Review the app", intervalMinutes: 1440 })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "ROUTINE_NOT_ALLOWED_FOR_ROLE");
  });
});

test("employee schedule API bounds the recurring interval", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/schedules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "web-dev", routineId: "web-dependency-run", goal: "Review dependencies", intervalMinutes: 10 })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_SCHEDULE_INTERVAL");
  });
});


test("worker reports disabled when its server-only Supabase credentials are missing", () => {
  const worker = startWorker({ env: {}, logger: { warn() {}, info() {}, error() {} } });
  assert.equal(worker.getStatus().state, "disabled");
  assert.equal(worker.getStatus().lastErrorCode, "WORKER_CONFIGURATION_MISSING");
});
