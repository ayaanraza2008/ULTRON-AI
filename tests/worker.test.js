import test from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "../worker.js";

test("worker disables itself safely when server-side Supabase credentials are missing", () => {
  const warnings = [];
  const worker = startWorker({
    env: { SUPABASE_URL: "https://example.supabase.co" },
    logger: { warn: message => warnings.push(message) }
  });

  const status = worker.getStatus();
  assert.equal(status.state, "disabled");
  assert.equal(status.lastErrorCode, "WORKER_CONFIGURATION_MISSING");
  assert.equal(status.lastCycleSuccessAt, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /server-only SUPABASE_SERVICE_ROLE_KEY/);
});

test("worker disables itself when the Supabase URL is not HTTPS", () => {
  const worker = startWorker({
    env: { SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    logger: { warn() {} }
  });
  assert.equal(worker.getStatus().state, "disabled");
  assert.equal(worker.getStatus().lastErrorCode, "WORKER_CONFIGURATION_MISSING");
});

test("worker records a successful poll and stops cleanly with an injected transport", async () => {
  let worker;
  let calls = 0;
  worker = startWorker({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 2) worker.stop();
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(status.state, "stopped");
  assert.ok(status.lastCycleSuccessAt);
  assert.equal(status.lastErrorCode, null);
  assert.equal(calls, 2);
});

test("audit failure after completion does not turn a completed task into a failed task", async () => {
  let worker;
  let calls = 0;
  const errors = [];
  const task = {
    id: "task-1",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", executionMode: "employee_worker", role: "web-dev", goal: "Create a plan", mode: "plan" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "test-only",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free"
    },
    logger: { info() {}, warn() {}, error: (...args) => errors.push(args) },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls += 1;
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) {
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/rpc/ultron_claim_next_task")) {
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/chat/completions")) {
        return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Plan generated." } }] }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response(JSON.stringify({ message: "audit unavailable" }), { status: 500 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(status.tasksCompleted, 1);
  assert.equal(status.tasksFailed, 0);
  assert.ok(errors.some(args => String(args[0]).includes("Task completion audit failed")));
  assert.ok(calls >= 5);
});


test("background AI Employee receives task-aware diagram guidance automatically", async () => {
  let worker;
  let modelRequest;
  const task = {
    id: "task-skills-1",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a sequence diagram for the authentication API", mode: "plan" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "test-only",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        modelRequest = JSON.parse(options.body);
        return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Sequence diagram plan drafted." } }] }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") return new Response("[]", { status: 200 });
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.ok(modelRequest);
  const system = modelRequest.messages.find(message => message.role === "system")?.content || "";
  assert.match(system, /Automatically selected task-aware guidance/);
  assert.match(system, /Diagram request detected/);
  assert.equal(worker.getStatus().tasksCompleted, 1);
});
