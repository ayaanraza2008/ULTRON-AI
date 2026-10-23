import test from "node:test";
import assert from "node:assert/strict";
import { startWorker, renewTaskLease } from "../worker.js";

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
        return new Response(JSON.stringify([task]), { status: 200 });
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
      if (url.includes("/agent_tasks?") && options.method === "PATCH") return new Response(JSON.stringify([task]), { status: 200 });
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


test("worker throttles after claiming scheduled work instead of busy-looping", async () => {
  let worker;
  let sleeps = 0;
  let polls = 0;
  worker = startWorker({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => { sleeps += 1; worker.stop(); },
    fetchImpl: async url => {
      polls += 1;
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) {
        return new Response(JSON.stringify([{ id: "schedule-1" }]), { status: 200 });
      }
      throw new Error("The claimed schedule should not trigger another poll in the same cycle.");
    }
  });
  await worker.done;
  assert.equal(sleeps, 1);
  assert.equal(polls, 1);
  assert.equal(worker.getStatus().state, "stopped");
});


test("worker persists retry timestamp when scheduling a transient provider retry", async () => {
  let worker;
  let failureUpdate;
  const task = {
    id: "task-transient-provider-error",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a plan", mode: "plan" }
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
      if (url.includes("/chat/completions")) return new Response("{}", { status: 503 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        failureUpdate = JSON.parse(options.body);
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(failureUpdate.status, "QUEUED");
  assert.equal(failureUpdate.error_code, "EMPLOYEE_PROVIDER_RETRYABLE");
  assert.equal(failureUpdate.result.retry, true);
  assert.equal(failureUpdate.started_at, null);
  assert.equal(failureUpdate.finished_at, null);
  assert.ok(Number.isFinite(Date.parse(failureUpdate.updated_at)));
  assert.equal(worker.getStatus().tasksFailed, 0);
  assert.equal(worker.getStatus().tasksRetried, 1);
});


test("worker does not retry permanent AI provider 4xx responses", async () => {
  let worker;
  let failureUpdate;
  const task = {
    id: "task-permanent-provider-error",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a plan", mode: "plan" }
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
      if (url.includes("/chat/completions")) return new Response("{}", { status: 400 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        failureUpdate = JSON.parse(options.body);
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(failureUpdate.status, "FAILED");
  assert.equal(failureUpdate.error_code, "EMPLOYEE_PROVIDER_REJECTED");
  assert.equal(failureUpdate.result.retry, false);
  assert.equal(worker.getStatus().tasksFailed, 1);
});


test("worker discards provider results when the task was cancelled before completion", async () => {
  let worker;
  const errors = [];
  const task = {
    id: "task-cancel-race",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a plan", mode: "plan" }
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
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Plan generated." } }] }), { status: 200 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") return new Response("[]", { status: 200 });
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(status.tasksCompleted, 0);
  assert.equal(status.tasksFailed, 0);
  assert.equal(status.tasksDiscarded, 1);
  assert.ok(errors.length === 0);
});


test("autonomous task chains configured research into a report without another prompt", async () => {
  let worker;
  const calls = [];
  const task = {
    id: "autonomous-1",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "autonomous", goal: "Research renewable energy trends and prepare a report", role: "chief-of-staff", mode: "report" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "test-only",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      TAVILY_API_KEY: "test-tavily"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("api.tavily.com/search")) return new Response(JSON.stringify({
        answer: "Renewables expanded in several markets.",
        results: [
          { title: "Energy outlook", url: "https://example.com/energy", content: "Capacity and investment trends." },
          { title: "Metadata endpoint", url: "http://169.254.169.254/latest/meta-data", content: "Must never be included in model context." },
          { title: "Hex mapped loopback", url: "http://[::ffff:7f00:1]/admin", content: "Mapped loopback must be rejected." },
          { title: "Hex mapped private", url: "http://[::ffff:c0a8:101]/", content: "Mapped private address must be rejected." },
          { title: "Teredo tunnel", url: "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/", content: "Teredo-tunneled IPv4 must be rejected." },
          { title: "6to4 tunnel", url: "http://[2002:7f00:1::]/", content: "6to4-tunneled IPv4 must be rejected." }
        ]
      }), { status: 200 });
      if (url.includes("/chat/completions")) {
        const body = JSON.parse(options.body);
        assert.match(body.messages.find(message => message.role === "user").content, /Research answer/);
        const userContent = body.messages.find(message => message.role === "user").content;
        assert.match(userContent, /https:\/\/example.com\/energy/);
        assert.equal(userContent.includes("169.254.169.254"), false);
        assert.equal(userContent.includes("Must never be included in model context."), false);
        assert.equal(userContent.includes("::ffff:7f00:1"), false);
        assert.equal(userContent.includes("::ffff:c0a8:101"), false);
        assert.equal(userContent.includes("Mapped loopback must be rejected."), false);
        assert.equal(userContent.includes("Mapped private address must be rejected."), false);
        assert.equal(userContent.includes("Teredo-tunneled IPv4 must be rejected."), false);
        assert.equal(userContent.includes("6to4-tunneled IPv4 must be rejected."), false);
        return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Report drafted with cited research." } }] }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        const patch = JSON.parse(options.body);
        assert.equal(patch.status, "COMPLETED");
        assert.equal(patch.result.type, "autonomous_workflow");
        assert.equal(patch.result.stages[0].state, "completed");
        assert.equal(patch.result.stages[1].state, "completed");
        worker.stop();
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.ok(calls.some(call => call.url.includes("api.tavily.com/search")));
  assert.ok(calls.some(call => call.url.includes("/chat/completions")));
});


test("background AI Employee falls back to a configured provider after rate limiting", async () => {
  let worker;
  const modelUrls = [];
  const task = {
    id: "task-employee-provider-fallback",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a plan", mode: "plan" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "primary-test-key",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: "test-model", priority: 1 },
        { name: "unsafe", baseUrl: "http://localhost:1234/v1", apiKeyEnv: "UNSAFE_KEY", model: "test-model", priority: 0 }
      ]),
      GROQ_API_KEY: "fallback-test-key",
      UNSAFE_KEY: "must-not-be-used"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        modelUrls.push({ url, authorization: options.headers?.Authorization });
        if (url.startsWith("https://openrouter.ai/")) return new Response("rate limited", { status: 429 });
        if (url.startsWith("https://api.groq.com/")) return new Response(JSON.stringify({ model: "groq-test-model", choices: [{ message: { content: "Fallback plan generated." } }] }), { status: 200 });
        throw new Error("Unexpected model endpoint: " + url);
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.deepEqual(modelUrls.map(item => item.url), [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions"
  ]);
  assert.deepEqual(modelUrls.map(item => item.authorization), ["Bearer primary-test-key", "Bearer fallback-test-key"]);
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});


test("worker falls back to the next configured model after a permanent provider rejection", async () => {
  let worker;
  const requestedProviders = [];
  const task = {
    id: "task-provider-rejection-fallback",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a concise plan", mode: "plan" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "invalid-primary-key",
      OPENROUTER_DEFAULT_MODEL: "bad-model",
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "fallback", baseUrl: "https://fallback.example/v1", apiKeyEnv: "FALLBACK_API_KEY", model: "fallback-model", priority: 1 }
      ]),
      FALLBACK_API_KEY: "fallback-test-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        requestedProviders.push({ url, authorization: options.headers?.Authorization });
        if (url.startsWith("https://openrouter.ai/")) return new Response("{}", { status: 401 });
        return new Response(JSON.stringify({ model: "fallback-model", choices: [{ message: { content: "Fallback plan generated." } }] }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/audit_events")) {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(requestedProviders.length, 2);
  assert.equal(requestedProviders[0].authorization, "Bearer invalid-primary-key");
  assert.equal(requestedProviders[1].authorization, "Bearer fallback-test-key");
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});


test("worker blocks tasks that require approval when approval is absent and never calls a provider", async () => {
  let worker;
  let failureUpdate;
  const auditEvents = [];
  const providerCalls = [];
  const task = {
    id: "task-approval-required",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: {
      taskType: "employee",
      role: "chief-of-staff",
      goal: "Send an external message",
      mode: "draft",
      requiresApproval: true,
      approved: false
    }
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
      if (url.includes("/chat/completions") || url.includes("api.tavily.com")) {
        providerCalls.push(url);
        throw new Error("Provider must not be called for an unapproved task.");
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        failureUpdate = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/audit_events")) {
        auditEvents.push(JSON.parse(options.body));
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(failureUpdate.status, "BLOCKED");
  assert.equal(failureUpdate.error_code, "APPROVAL_REQUIRED");
  assert.equal(failureUpdate.result.retry, false);
  assert.deepEqual(providerCalls, []);
  assert.equal(worker.getStatus().tasksFailed, 0);
  assert.equal(worker.getStatus().tasksBlocked, 1);
  assert.equal(worker.getStatus().tasksRetried, 0);
  assert.ok(auditEvents.some(event => event.action === "task.blocked" && event.outcome === "blocked" && event.metadata?.code === "APPROVAL_REQUIRED"));
});


test("worker does not count a provider failure after a task was cancelled", async () => {
  let worker;
  const task = {
    id: "task-cancelled-during-failure",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a plan", mode: "plan" }
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
      if (url.includes("/chat/completions")) return new Response("provider down", { status: 503 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(worker.getStatus().tasksCompleted, 0);
  assert.equal(worker.getStatus().tasksRetried, 0);
  assert.equal(worker.getStatus().tasksFailed, 0);
  assert.equal(worker.getStatus().tasksDiscarded, 1);
});


test("worker records failed task-state persistence and leaves recovery to the task lease", async () => {
  let worker;
  let patchCalls = 0;
  const task = {
    id: "task-state-update-failure",
    user_id: "user-1",
    created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
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
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => worker.stop(),
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Plan generated." } }] }), { status: 200 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        patchCalls += 1;
        return new Response(JSON.stringify({ message: "database temporarily unavailable" }), { status: 503 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(patchCalls, 1);
  assert.equal(status.taskStateUpdateFailures, 1);
  assert.equal(status.lastErrorCode, "TASK_STATE_UPDATE_FAILED");
  assert.equal(status.tasksCompleted, 0);
  assert.equal(status.tasksRetried, 0);
  assert.equal(status.tasksFailed, 0);
  assert.equal(status.tasksBlocked, 0);
});


test("worker does not mark a successfully executed task failed when completion persistence is unavailable", async () => {
  let worker;
  let patchCalls = 0;
  const task = {
    id: "task-completion-write-failure",
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
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => worker.stop(),
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Plan generated." } }] }), { status: 200 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        patchCalls += 1;
        return new Response(JSON.stringify({ message: "database temporarily unavailable" }), { status: 503 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(patchCalls, 1, "worker must not attempt to mark the task failed after completion persistence fails");
  assert.equal(status.taskStateUpdateFailures, 1);
  assert.equal(status.lastErrorCode, "TASK_STATE_UPDATE_FAILED");
  assert.equal(status.tasksCompleted, 0);
  assert.equal(status.tasksRetried, 0);
  assert.equal(status.tasksFailed, 0);
  assert.equal(status.tasksBlocked, 0);
});


test("task lease renewal updates only a task that is still RUNNING", async () => {
  let request;
  const ok = await renewTaskLease({
    taskId: "task/with space",
    rest: async (endpoint, options) => {
      request = { endpoint, options };
      return [{ id: "task/with space", status: "RUNNING" }];
    },
    logger: { warn() {} }
  });
  assert.equal(ok, true);
  assert.equal(request.endpoint, "agent_tasks?id=eq.task%2Fwith%20space&status=eq.RUNNING");
  assert.equal(request.options.method, "PATCH");
  const body = JSON.parse(request.options.body);
  assert.ok(Number.isFinite(Date.parse(body.started_at)));
  assert.ok(Number.isFinite(Date.parse(body.updated_at)));
});

test("task lease renewal does not report success after a cancellation or state transition", async () => {
  const ok = await renewTaskLease({
    taskId: "task-cancelled",
    rest: async () => [],
    logger: { warn() {} }
  });
  assert.equal(ok, false);
});

test("task lease renewal degrades safely when the database is unavailable", async () => {
  const warnings = [];
  const ok = await renewTaskLease({
    taskId: "task-db-outage",
    rest: async () => { throw new Error("database unavailable"); },
    logger: { warn: (...args) => warnings.push(args) }
  });
  assert.equal(ok, false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /lease renewal failed/i);
});
