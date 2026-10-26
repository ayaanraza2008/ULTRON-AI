import test from "node:test";
import assert from "node:assert/strict";
import { startWorker, renewTaskLease, readJsonLimited, readTextLimited, createNonOverlappingRunner, safeResearchUrl } from "../worker.js";

test("worker research URL validation shares reserved IPv4 and IPv6 host rules", () => {
  for (const url of [
    "http://127.0.0.1/admin",
    "http://192.168.1.10/admin",
    "http://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1",
    "http://[::1]/private",
    "http://[2002:7f00:1::]/loopback-tunnel",
    "http://[2001:2::1]/benchmarking",
    "http://[2001:10::1]/orchid",
    "http://[2001:20::1]/orchid-v2",
    "http://[3fff::1]/documentation-prefix",
    "https://user:password@example.com/private"
  ]) assert.equal(safeResearchUrl(url), "", url);
  assert.equal(safeResearchUrl("https://www.example.com/article"), "https://www.example.com/article");
});

test("limited response readers reject non-streaming fallbacks before buffering", async () => {
  let textCalls = 0;
  const response = {
    headers: { get: () => null },
    text: async () => { textCalls += 1; return "x".repeat(10_000_000); }
  };
  await assert.rejects(readTextLimited(response, 10), /without a streaming body/);
  await assert.rejects(readJsonLimited(response, 10), /without a streaming body/);
  assert.equal(textCalls, 0, "must reject before allocating an unbounded text body");
});


test("lease renewal signals cancellation only when the task is no longer RUNNING", async () => {
  let inactiveSignals = 0;
  const inactive = await renewTaskLease({
    taskId: "task-cancelled",
    rest: async () => [],
    logger: { warn() {} },
    onInactive: () => { inactiveSignals += 1; }
  });
  assert.equal(inactive, false);
  assert.equal(inactiveSignals, 1);

  const failed = await renewTaskLease({
    taskId: "task-temporary-db-error",
    rest: async () => { throw new Error("temporary database failure"); },
    logger: { warn() {} },
    onInactive: () => { inactiveSignals += 1; }
  });
  assert.equal(failed, false);
  assert.equal(inactiveSignals, 1, "transient database errors must not cancel provider work");
});

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

test("worker rejects HTTPS database endpoints that are local, private, or embed credentials", () => {
  for (const url of [
    "https://localhost:54321",
    "https://192.168.1.10",
    "https://user:password@example.supabase.co"
  ]) {
    let fetchCalls = 0;
    const worker = startWorker({
      env: { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "test-only" },
      logger: { warn() {} },
      fetchImpl: async () => { fetchCalls += 1; throw new Error("must not contact unsafe endpoint"); }
    });
    assert.equal(worker.getStatus().state, "disabled", url);
    assert.equal(worker.getStatus().lastErrorCode, "WORKER_CONFIGURATION_MISSING", url);
    assert.equal(fetchCalls, 0, url);
  }
});

test("worker records a successful poll and stops cleanly with an injected transport", async () => {
  let worker;
  let calls = 0;
  const redirects = [];
  worker = startWorker({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (_url, options = {}) => {
      redirects.push(options.redirect);
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
  assert.deepEqual(redirects, ["error", "error"]);
});

test("worker bounds oversized Supabase responses before parsing", async () => {
  let worker;
  worker = startWorker({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => worker.stop(),
    fetchImpl: async () => new Response("x".repeat(2_000_001), { status: 200 })
  });
  await worker.done;
  assert.equal(worker.getStatus().state, "stopped");
  assert.equal(worker.getStatus().lastErrorCode, "WORKER_CYCLE_FAILED");
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


test("worker retries research provider HTTP 408 timeouts", async () => {
  let worker;
  let failureUpdate;
  const task = {
    id: "task-research-http-408",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "research", query: "renewable energy trends" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      TAVILY_API_KEY: "test-only"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("api.tavily.com/search")) {
        assert.equal(options.redirect, "error");
        return new Response("request timed out", { status: 408 });
      }
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
  assert.equal(failureUpdate.error_code, "RESEARCH_PROVIDER_RETRYABLE");
  assert.equal(failureUpdate.result.retry, true);
  assert.equal(worker.getStatus().tasksRetried, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
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
          { title: "6to4 tunnel", url: "http://[2002:7f00:1::]/", content: "6to4-tunneled IPv4 must be rejected." },
          { title: "Link-local IPv6", url: "http://[fe80::1]/", content: "Link-local IPv6 must be rejected." },
          { title: "IPv4-compatible IPv6", url: "http://[::192.168.1.10]/", content: "IPv4-compatible private destination must be rejected." }
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
        assert.equal(userContent.includes("fe80::1"), false);
        assert.equal(userContent.includes("::192.168.1.10"), false);
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
        assert.equal(patch.result.verification.state, "needs_review");
        assert.equal(patch.result.verification.warning.includes("not factual correctness"), true);
        worker.stop();
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.equal(worker.getStatus().tasksNeedingReview, 1);
  assert.ok(calls.some(call => call.url.includes("api.tavily.com/search")));
  assert.ok(calls.filter(call => call.url.includes("api.tavily.com/search")).every(call => call.options.redirect === "error"));
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
        { name: "unsafe-localhost", baseUrl: "https://localhost:1234/v1", apiKeyEnv: "UNSAFE_KEY", model: "test-model", priority: 0 },
        { name: "unsafe-private-ip", baseUrl: "https://192.168.1.10/v1", apiKeyEnv: "UNSAFE_KEY", model: "test-model", priority: 0 }
      ]),
      GROQ_API_KEY: "fallback-test-key",
      UNSAFE_KEY: "must-not-be-used"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.startsWith("https://example.supabase.co/rest/v1/")) assert.equal(options.redirect, "error");
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        modelUrls.push({ url, authorization: options.headers?.Authorization, redirect: options.redirect });
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
  assert.deepEqual(modelUrls.map(item => item.redirect), ["error", "error"]);
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
        { name: "fallback", baseUrl: "https://fallback.example.com/v1", apiKeyEnv: "FALLBACK_API_KEY", model: "fallback-model", priority: 1 }
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

test("background AI Employee falls back when a provider returns malformed JSON", async () => {
  let worker;
  const attempts = [];
  const task = {
    id: "task-malformed-provider-response",
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
        { name: "backup", baseUrl: "https://backup.example.com/v1", apiKeyEnv: "BACKUP_API_KEY", model: "backup-model", priority: 1 }
      ]),
      BACKUP_API_KEY: "backup-test-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        attempts.push(url);
        if (url.startsWith("https://openrouter.ai/")) return new Response("not-json", { status: 200 });
        return new Response(JSON.stringify({ model: "backup-model", choices: [{ message: { content: "Fallback plan generated." } }] }), { status: 200 });
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
  assert.deepEqual(attempts, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://backup.example.com/v1/chat/completions"
  ]);
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});



test("background AI Employee falls back when a provider response exceeds the size limit", async () => {
  let worker;
  const attempts = [];
  const task = {
    id: "task-oversized-provider-response",
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
        { name: "backup", baseUrl: "https://backup.example.com/v1", apiKeyEnv: "BACKUP_API_KEY", model: "backup-model", priority: 1 }
      ]),
      BACKUP_API_KEY: "backup-test-key"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        attempts.push(url);
        if (url.startsWith("https://openrouter.ai/")) return new Response("💥".repeat(600_000), { status: 200 });
        return new Response(JSON.stringify({ model: "backup-model", choices: [{ message: { content: "Fallback plan generated." } }] }), { status: 200 });
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
  assert.deepEqual(attempts, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://backup.example.com/v1/chat/completions"
  ]);
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});


test("worker rejects tasks with creation timestamps far in the future", async () => {
  let worker;
  let modelCalls = 0;
  let failurePatch;
  const task = {
    id: "task-future-created-at",
    user_id: "user-1",
    created_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
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
      if (url.includes("/chat/completions")) {
        modelCalls += 1;
        throw new Error("Future-dated task must not reach a model provider.");
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        failurePatch = JSON.parse(options.body);
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
  assert.equal(modelCalls, 0);
  assert.equal(failurePatch.status, "FAILED");
  assert.equal(failurePatch.error_code, "TASK_EXPIRED");
  assert.equal(worker.getStatus().tasksFailed, 1);
});


test("autonomous workflow still drafts a report when live research provider fails", async () => {
  let worker;
  const calls = [];
  const task = {
    id: "autonomous-research-unavailable",
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
      if (url.includes("api.tavily.com/search")) return new Response("search temporarily unavailable", { status: 503 });
      if (url.includes("/chat/completions")) {
        const body = JSON.parse(options.body);
        assert.match(body.messages.find(message => message.role === "user").content, /Live research could not be completed/);
        const userContent = body.messages.find(message => message.role === "user").content;
        assert.equal(userContent.includes("Research answer:"), false);
        return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: "Report drafted with cited research." } }] }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        const patch = JSON.parse(options.body);
        assert.equal(patch.status, "COMPLETED");
        assert.equal(patch.result.type, "autonomous_workflow");
        assert.equal(patch.result.stages[0].state, "failed");
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
  assert.ok(calls.filter(call => call.url.includes("api.tavily.com/search")).every(call => call.options.redirect === "error"));
  assert.ok(calls.some(call => call.url.includes("/chat/completions")));
});


test("worker falls back after a transient HTTP 408 provider timeout", async () => {
  let worker;
  const requestedProviders = [];
  const task = {
    id: "task-provider-http-408-fallback",
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
        { name: "fallback", baseUrl: "https://fallback.example.com/v1", apiKeyEnv: "FALLBACK_API_KEY", model: "fallback-model", priority: 1 }
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
        if (url.startsWith("https://openrouter.ai/")) return new Response("request timed out", { status: 408 });
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


test("worker retries malformed research provider JSON", async () => {
  let worker;
  let failureUpdate;
  const task = {
    id: "task-research-malformed-json",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "research", query: "renewable energy trends" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      TAVILY_API_KEY: "test-only"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("api.tavily.com/search")) {
        assert.equal(options.redirect, "error");
        return new Response("{invalid-json", { status: 200 });
      }
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
  assert.equal(failureUpdate.error_code, "RESEARCH_PROVIDER_RETRYABLE");
  assert.equal(failureUpdate.result.retry, true);
  assert.equal(worker.getStatus().tasksRetried, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});


test("worker alternates task and schedule polling to prevent starvation", async () => {
  let worker;
  let cycles = 0;
  const calls = [];
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {
      cycles += 1;
      if (cycles === 2) worker.stop();
    },
    fetchImpl: async (url) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) {
        calls.push("schedule");
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/rpc/ultron_claim_next_task")) {
        calls.push("task");
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.deepEqual(calls, ["schedule", "task", "task", "schedule"]);
  assert.equal(worker.getStatus().state, "stopped");
});


test("bounded text reader preserves UTF-8 characters split across stream chunks", async () => {
  const bytes = new TextEncoder().encode('{"message":"नमस्ते 🌍"}');
  const splitAt = bytes.length - 2;
  const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
  let index = 0;
  let released = false;
  const response = {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
          },
          releaseLock() { released = true; }
        };
      }
    }
  };
  const raw = await readTextLimited(response, 1024);
  assert.deepEqual(JSON.parse(raw), { message: "नमस्ते 🌍" });
  assert.equal(released, true, "reader lock must be released after streamed text is decoded");
});


test("bounded text reader cancels a streamed response that exceeds its byte limit", async () => {
  let cancelled = false;
  let released = false;
  const response = {
    headers: new Headers(),
    body: {
      getReader() {
        let first = true;
        return {
          async read() {
            if (!first) return { done: true, value: undefined };
            first = false;
            return { done: false, value: new Uint8Array(9) };
          },
          async cancel() { cancelled = true; },
          releaseLock() { released = true; }
        };
      }
    }
  };
  await assert.rejects(
    () => readTextLimited(response, 8),
    /response exceeded the configured size limit/
  );
  assert.equal(cancelled, true, "oversized stream should be cancelled immediately");
  assert.equal(released, true, "reader lock should be released after size rejection");
});

test("bounded provider JSON reader preserves abort errors rather than relabeling them", async () => {
  const abortError = new DOMException("The operation was aborted.", "AbortError");
  let released = false;
  const response = {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() { throw abortError; },
          releaseLock() { released = true; }
        };
      }
    }
  };
  await assert.rejects(
    () => readJsonLimited(response, 1024),
    error => error === abortError && error.name === "AbortError"
  );
  assert.equal(released, true, "reader lock must be released after an aborted read");
});


test("task lease heartbeat skips overlapping ticks instead of queueing requests", async () => {
  let release;
  let calls = 0;
  const runner = createNonOverlappingRunner(() => {
    calls += 1;
    return new Promise(resolve => { release = resolve; });
  });
  assert.equal(runner.trigger(), true);
  await Promise.resolve();
  assert.equal(runner.trigger(), false, "a second tick must be skipped while the first is pending");
  assert.equal(runner.trigger(), false);
  assert.equal(calls, 1);
  release();
  await runner.wait();
  assert.equal(runner.trigger(), true, "heartbeat may run again after the previous request settles");
  await Promise.resolve();
  assert.equal(calls, 2);
  release();
  await runner.wait();
});


test("worker discards a retryable provider failure when the task was cancelled before retry persistence", async () => {
  let worker;
  const auditEvents = [];
  const task = {
    id: "task-retry-cancel-race",
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
      if (url.includes("/chat/completions")) return new Response("provider temporarily unavailable", { status: 503 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        const patch = JSON.parse(options.body);
        assert.equal(patch.status, "QUEUED", "worker should attempt a retry transition conditionally");
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/audit_events")) {
        auditEvents.push(JSON.parse(options.body));
        worker.stop();
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(status.tasksRetried, 0, "a retry counts only when the conditional state update succeeds");
  assert.equal(status.tasksFailed, 0, "a concurrent cancellation is not a task failure");
  assert.equal(status.tasksDiscarded, 1);
  assert.equal(auditEvents[0]?.action, "task.failure_discarded");
  assert.equal(auditEvents[0]?.outcome, "denied");
  assert.equal(auditEvents[0]?.metadata?.reason, "task_state_changed_during_execution");
});


test("worker continues polling after a transient database cycle error", async () => {
  let worker;
  let schedulePolls = 0;
  let taskPolls = 0;
  let sleeps = 0;
  const errors = [];
  worker = startWorker({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    logger: { info() {}, warn() {}, error: (...args) => errors.push(args) },
    sleepImpl: async () => {
      sleeps += 1;
      if (sleeps === 2) worker.stop();
    },
    fetchImpl: async url => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) {
        schedulePolls += 1;
        if (schedulePolls === 1) throw new Error("temporary Supabase network interruption");
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/rpc/ultron_claim_next_task")) {
        taskPolls += 1;
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  const status = worker.getStatus();
  assert.equal(status.state, "stopped");
  assert.equal(schedulePolls, 2, "the next cycle must retry the schedule poll");
  assert.equal(taskPolls, 1, "the worker must service task polling in the recovered cycle");
  assert.ok(status.lastCycleSuccessAt, "a successful cycle should be recorded after the transient failure");
  assert.ok(errors.some(args => String(args[0]).includes("Worker cycle failed")));
});


test("worker finishes an active task after shutdown is requested and claims no new task", async () => {
  let worker;
  let taskClaims = 0;
  let completionWrites = 0;
  const task = {
    id: "task-shutdown-during-provider-call",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a concise plan", mode: "plan" }
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
      if (url.includes("/rpc/ultron_claim_next_task")) {
        taskClaims += 1;
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/chat/completions")) {
        worker.stop();
        return new Response(JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: "Plan drafted safely." } }]
        }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        completionWrites += 1;
        const patch = JSON.parse(options.body);
        assert.equal(patch.status, "COMPLETED");
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });

  await worker.done;
  const status = worker.getStatus();
  assert.equal(completionWrites, 1, "the active task result must be persisted before shutdown");
  assert.equal(taskClaims, 1, "shutdown must prevent the next task from being claimed");
  assert.equal(status.tasksCompleted, 1);
  assert.equal(status.state, "stopped");
});


test("worker fails a retryable provider error once the task attempt limit is reached", async () => {
  let worker;
  let providerCalls = 0;
  let failurePatch;
  const auditEvents = [];
  const task = {
    id: "task-retry-limit-reached",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 3,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a concise plan", mode: "plan" }
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
        providerCalls += 1;
        return new Response("provider temporarily unavailable", { status: 503 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        failurePatch = JSON.parse(options.body);
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
  assert.equal(providerCalls, 1, "the final allowed attempt should not trigger another provider attempt");
  assert.equal(failurePatch.status, "FAILED");
  assert.equal(failurePatch.error_code, "EMPLOYEE_PROVIDER_RETRYABLE");
  assert.equal(failurePatch.result.retry, false);
  assert.equal(worker.getStatus().tasksRetried, 0);
  assert.equal(worker.getStatus().tasksFailed, 1);
  assert.equal(auditEvents[0]?.action, "task.failed");
  assert.equal(auditEvents[0]?.metadata?.attempt, 3);
});


test("worker leaves retryable task lease intact when retry persistence fails", async () => {
  let worker;
  let attemptedRetryPatch;
  const errors = [];
  const task = {
    id: "task-retry-write-failure",
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
      if (url.includes("/chat/completions")) return new Response("provider temporarily unavailable", { status: 503 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        attemptedRetryPatch = JSON.parse(options.body);
        worker.stop();
        throw new Error("temporary Supabase write outage");
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });

  await worker.done;
  const status = worker.getStatus();
  assert.equal(attemptedRetryPatch.status, "QUEUED", "the worker should attempt the conditional retry transition");
  assert.equal(status.taskStateUpdateFailures, 1);
  assert.equal(status.lastErrorCode, "TASK_STATE_UPDATE_FAILED");
  assert.equal(status.tasksRetried, 0, "a failed database write must not be reported as a scheduled retry");
  assert.equal(status.tasksFailed, 0, "the worker must not claim a terminal failure without persistence");
  assert.equal(status.tasksDiscarded, 0, "a write outage is not evidence that another actor changed task state");
  assert.ok(errors.some(args => String(args[0]).includes("lease recovery will handle it")));
});


test("worker records a retry only after the queued transition is persisted", async () => {
  let worker;
  let retryPatch;
  const auditEvents = [];
  const task = {
    id: "task-retry-transition-saved",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a concise plan", mode: "plan" }
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
      if (url.includes("/chat/completions")) return new Response("provider temporarily unavailable", { status: 503 });
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        retryPatch = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([{ ...task, status: "QUEUED" }]), { status: 200 });
      }
      if (url.includes("/audit_events")) {
        auditEvents.push(JSON.parse(options.body));
        return new Response("[]", { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    }
  });

  await worker.done;
  const status = worker.getStatus();
  assert.equal(retryPatch.status, "QUEUED");
  assert.equal(retryPatch.error_code, "EMPLOYEE_PROVIDER_RETRYABLE");
  assert.equal(retryPatch.result.retry, true);
  assert.equal(retryPatch.started_at, null);
  assert.equal(retryPatch.finished_at, null);
  assert.equal(status.tasksRetried, 1);
  assert.equal(status.tasksFailed, 0);
  assert.equal(status.taskStateUpdateFailures, 0);
  assert.equal(auditEvents[0]?.action, "task.retry_scheduled");
  assert.equal(auditEvents[0]?.outcome, "retry");
  assert.equal(auditEvents[0]?.metadata?.attempt, 1);
});


test("worker keeps a persisted completion successful when the audit write fails", async () => {
  let worker;
  let completionWrites = 0;
  const errors = [];
  const task = {
    id: "task-completed-audit-outage",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a concise plan", mode: "plan" }
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
      if (url.includes("/chat/completions")) {
        return new Response(JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: "Plan drafted safely." } }]
        }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        completionWrites += 1;
        const patch = JSON.parse(options.body);
        assert.equal(patch.status, "COMPLETED");
        assert.equal(patch.result.answer, "Plan drafted safely.");
        worker.stop();
        return new Response(JSON.stringify([{ ...task, status: "COMPLETED" }]), { status: 200 });
      }
      if (url.includes("/audit_events")) {
        throw new Error("temporary audit database outage");
      }
      throw new Error("Unexpected request: " + url);
    }
  });

  await worker.done;
  const status = worker.getStatus();
  assert.equal(completionWrites, 1, "the completed task must be persisted exactly once");
  assert.equal(status.tasksCompleted, 1, "audit failure must not undo a persisted completion");
  assert.equal(status.tasksFailed, 0);
  assert.equal(status.tasksRetried, 0);
  assert.ok(errors.some(args => String(args[0]).includes("Task completion audit failed:")));
});

test("worker rejects query/fragment-bearing model provider base URLs before attempting requests", async () => {
  let worker;
  const providerUrls = [];
  const task = {
    id: "task-unsafe-provider-base-urls",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a plan", mode: "plan" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "synthetic-primary-secret",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1?token=must-not-be-used",
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "query-provider", baseUrl: "https://query.example.com/v1?token=secret", apiKeyEnv: "QUERY_PROVIDER_KEY", model: "test-model", priority: 0 },
        { name: "fragment-provider", baseUrl: "https://fragment.example.com/v1#secret", apiKeyEnv: "FRAGMENT_PROVIDER_KEY", model: "test-model", priority: 1 },
        { name: "private-provider", baseUrl: "https://192.168.1.10/v1", apiKeyEnv: "PRIVATE_PROVIDER_KEY", model: "test-model", priority: 2 },
        { name: "metadata-provider", baseUrl: "https://169.254.169.254/latest/meta-data", apiKeyEnv: "METADATA_PROVIDER_KEY", model: "test-model", priority: 3 },
        { name: "orchid-v2-provider", baseUrl: "https://[2001:20::1]/v1", apiKeyEnv: "ORCHID_V2_PROVIDER_KEY", model: "test-model", priority: 4 },
        { name: "safe-provider", baseUrl: "https://safe.example.com/v1", apiKeyEnv: "SAFE_PROVIDER_KEY", model: "test-model", priority: 5 }
      ]),
      QUERY_PROVIDER_KEY: "synthetic-query-secret",
      FRAGMENT_PROVIDER_KEY: "synthetic-fragment-secret",
      PRIVATE_PROVIDER_KEY: "synthetic-private-secret",
      METADATA_PROVIDER_KEY: "synthetic-metadata-secret",
      ORCHID_V2_PROVIDER_KEY: "synthetic-orchid-secret",
      SAFE_PROVIDER_KEY: "synthetic-safe-secret"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        providerUrls.push(url);
        assert.equal(url, "https://safe.example.com/v1/chat/completions");
        assert.equal(options.headers.Authorization, "Bearer synthetic-safe-secret");
        return new Response(JSON.stringify({ model: "safe-model", choices: [{ message: { content: "A safe fallback plan was generated." } }] }), { status: 200 });
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
  assert.deepEqual(providerUrls, ["https://safe.example.com/v1/chat/completions"]);
  assert.equal(worker.getStatus().tasksCompleted, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});



test("worker cycle health resets consecutive failures after polling recovers", async () => {
  let worker;
  let pollAttempts = 0;
  let sleeps = 0;
  const failureCounts = [];
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {
      failureCounts.push(worker.getStatus().consecutiveCycleFailures);
      sleeps += 1;
      if (sleeps === 2) worker.stop();
    },
    fetchImpl: async (url) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) {
        pollAttempts += 1;
        if (pollAttempts === 1) throw new Error("temporary database outage");
        return new Response("[]", { status: 200 });
      }
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.deepEqual(failureCounts, [1, 0]);
  assert.equal(worker.getStatus().consecutiveCycleFailures, 0);
  assert.ok(worker.getStatus().lastCycleSuccessAt);
  assert.equal(worker.getStatus().state, "stopped");
});


test("worker exponentially backs off after repeated infrastructure poll failures", async () => {
  let worker;
  const delays = [];
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      ULTRON_WORKER_POLL_MS: "2000"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async delay => {
      delays.push(delay);
      if (delays.length === 3) worker.stop();
    },
    fetchImpl: async () => new Response("temporary outage", { status: 503 })
  });

  await worker.done;
  assert.deepEqual(delays, [2000, 4000, 8000]);
  assert.equal(worker.getStatus().consecutiveCycleFailures, 3);
  assert.equal(worker.getStatus().state, "stopped");
});


test("worker stop interrupts idle polling sleep promptly", async () => {
  let worker;
  let signalReceived;
  const sleepStarted = new Promise(resolve => { signalReceived = resolve; });
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      ULTRON_WORKER_POLL_MS: "30000"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: (_delay, _value, options = {}) => new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }
      options.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
      signalReceived();
    }),
    fetchImpl: async () => new Response("[]", { status: 200 })
  });

  await sleepStarted;
  worker.stop();
  await worker.done;
  assert.equal(worker.getStatus().state, "stopped");
});


test("background AI Employee automatically falls back through configured free OpenRouter models", async () => {
  let worker;
  let taskPatch;
  const modelCalls = [];
  const task = {
    id: "employee-free-model-fallback",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "employee", role: "chief-of-staff", goal: "Create a concise project plan", mode: "plan" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      OPENROUTER_API_KEY: "openrouter-worker-fallback-test-key",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ULTRON_AVAILABLE_MODELS: "openrouter/free,nvidia/nemotron-3.5-lightning:free,openai/gpt-4.1,https://evil.example/model:free,nvidia/nemotron-3.5-lightning:free"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("/chat/completions")) {
        const request = JSON.parse(options.body);
        modelCalls.push({ model: request.model, authorization: options.headers.Authorization });
        if (request.model === "openrouter/free") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
        assert.equal(request.model, "nvidia/nemotron-3.5-lightning:free");
        return new Response(JSON.stringify({
          model: request.model,
          choices: [{ message: { content: "A concise plan is ready for review. No external action was executed." } }]
        }), { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        taskPatch = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([{ ...task, ...taskPatch }]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(taskPatch.status, "COMPLETED");
  assert.equal(taskPatch.result.type, "employee_output");
  assert.equal(taskPatch.result.provider, "openrouter-free-fallback-1");
  assert.equal(taskPatch.result.model, "nvidia/nemotron-3.5-lightning:free");
  assert.deepEqual(modelCalls.map(call => call.model), ["openrouter/free", "nvidia/nemotron-3.5-lightning:free"]);
  assert.ok(modelCalls.every(call => call.authorization === "Bearer openrouter-worker-fallback-test-key"));
  assert.equal(worker.getStatus().tasksCompleted, 1);
});


test("worker research uses free public HTML search when Tavily is not configured and filters unsafe sources", async () => {
  let worker;
  let taskPatch;
  const task = {
    id: "task-free-public-research",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "research", query: "solar energy market trends" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.match(options.headers.Accept, /text\/html/);
        return new Response(`
          <div class="result">
            <a class="result__a" href="http://127.0.0.1/private">Unsafe destination</a>
            <a class="result__snippet">must not be returned</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://example.com/solar">Solar outlook</a>
            <a class="result__snippet">Capacity grew &amp; investment increased.</a>
          </div>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        taskPatch = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([{ ...task, ...taskPatch }]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(taskPatch.status, "COMPLETED");
  assert.equal(taskPatch.result.provider, "duckduckgo_html");
  assert.equal(taskPatch.result.sources.length, 1);
  assert.equal(taskPatch.result.sources[0].title, "Solar outlook");
  assert.equal(taskPatch.result.sources[0].url, "https://example.com/solar");
  assert.match(taskPatch.result.sources[0].snippet, /Capacity grew & investment increased/);
  assert.equal(JSON.stringify(taskPatch).includes("127.0.0.1"), false);
  assert.equal(worker.getStatus().tasksCompleted, 1);
});

test("worker falls back to free public search when configured Tavily returns an error", async () => {
  let worker;
  let taskPatch;
  let tavilyCalls = 0;
  const task = {
    id: "task-research-free-fallback",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "research", query: "battery storage trends" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      TAVILY_API_KEY: "test-only"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) return new Response(JSON.stringify([task]), { status: 200 });
      if (url.includes("api.tavily.com/search")) {
        tavilyCalls += 1;
        assert.equal(options.redirect, "error");
        return new Response("temporarily unavailable", { status: 503 });
      }
      if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
        return new Response('<a class="result__a" href="https://example.com/battery">Battery storage outlook</a><a class="result__snippet">Long-duration storage expanded.</a>', { status: 200 });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        taskPatch = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([{ ...task, ...taskPatch }]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(tavilyCalls, 1);
  assert.equal(taskPatch.status, "COMPLETED");
  assert.equal(taskPatch.result.provider, "duckduckgo_html");
  assert.equal(taskPatch.result.sources[0].url, "https://example.com/battery");
  assert.equal(worker.getStatus().tasksCompleted, 1);
});
 

test("autonomous worker completes a research-to-report run with free search and no Tavily key", async () => {
  let worker;
  let taskPatch;
  let modelCalls = 0;
  let searchCalls = 0;
  const task = {
    id: "autonomous-free-search-e2e",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: {
      taskType: "autonomous",
      goal: "Research renewable energy trends and prepare a concise report",
      role: "chief-of-staff",
      mode: "report"
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
      if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
        searchCalls += 1;
        return new Response(
          '<a class="result__a" href="https://example.com/energy">Renewable energy outlook</a>' +
          '<a class="result__snippet">New solar and wind capacity is expanding across several markets.</a>',
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
      if (url.includes("/chat/completions")) {
        modelCalls += 1;
        assert.equal(options.redirect, "error");
        const body = JSON.parse(options.body);
        const userMessage = body.messages.find(message => message.role === "user")?.content || "";
        assert.match(userMessage, /Research answer:/);
        const employeeInput = JSON.parse(userMessage);
        assert.match(employeeInput.context, /Research sources:\n1[.] Renewable energy outlook/);
        assert.match(employeeInput.context, /Renewable energy outlook — https:\/\/example[.]com\/energy\nNew solar and wind capacity/);
        assert.match(userMessage, /https:\/\/example[.]com\/energy/);
        assert.match(userMessage, /solar and wind capacity/);
        return new Response(JSON.stringify({
          model: "test-free-model",
          choices: [{
            message: {
              content: "## Summary\nPublic search returned a relevant renewable energy source.\n\n" +
                "## Deliverable\nSolar and wind capacity is expanding in several markets, based on the supplied search snippet. Source: https://example.com/energy\n\n" +
                "## Next Steps\nOpen the source and verify its publication date and figures.\n\n" +
                "## Blockers / Risks\nSearch snippets are incomplete and not independently verified.\n\n" +
                "## Verification Criteria\nConfirm the source URL, publication date, and underlying figures directly on the page."
            }
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        taskPatch = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([{ ...task, ...taskPatch }]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });
  await worker.done;
  assert.equal(searchCalls, 1);
  assert.equal(modelCalls, 1);
  assert.equal(taskPatch.status, "COMPLETED");
  assert.equal(taskPatch.result.type, "autonomous_workflow");
  assert.equal(taskPatch.result.research.provider, "duckduckgo_html");
  assert.equal(taskPatch.result.research.sources.length, 1);
  assert.equal(taskPatch.result.research.sources[0].url, "https://example.com/energy");
  assert.equal(taskPatch.result.stages[0].state, "completed");
  assert.equal(taskPatch.result.report.answer.includes("https://example.com/energy"), true);
  assert.equal(worker.getStatus().tasksCompleted, 1);
});


test("worker enforces an overall task deadline, cancels the provider request, and retries safely", async () => {
  let worker;
  let claimed = false;
  let providerAborted = false;
  let taskPatch;
  const task = {
    id: "research-deadline-task",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    attempts: 1,
    input: { taskType: "research", query: "simulate a provider that never returns" }
  };
  worker = startWorker({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      TAVILY_API_KEY: "tavily-test",
      ULTRON_WORKER_TASK_TIMEOUT_MS: "1000",
      ULTRON_WORKER_POLL_MS: "1000"
    },
    logger: { info() {}, warn() {}, error() {} },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/rpc/ultron_claim_due_employee_schedule")) return new Response("[]", { status: 200 });
      if (url.includes("/rpc/ultron_claim_next_task")) {
        if (claimed) return new Response("[]", { status: 200 });
        claimed = true;
        return new Response(JSON.stringify([task]), { status: 200 });
      }
      if (url.includes("api.tavily.com/search")) {
        return new Promise((resolve, reject) => {
          const signal = options.signal;
          const onAbort = () => {
            providerAborted = true;
            reject(signal.reason || Object.assign(new Error("Aborted"), { name: "AbortError" }));
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      if (url.includes("/agent_tasks?") && options.method === "PATCH") {
        taskPatch = JSON.parse(options.body);
        worker.stop();
        return new Response(JSON.stringify([{ ...task, ...taskPatch }]), { status: 200 });
      }
      if (url.includes("/audit_events")) return new Response("[]", { status: 200 });
      throw new Error("Unexpected request: " + url);
    }
  });

  await worker.done;
  assert.equal(providerAborted, true);
  assert.equal(taskPatch.status, "QUEUED");
  assert.equal(taskPatch.error_code, "TASK_EXECUTION_TIMEOUT");
  assert.equal(taskPatch.result.retry, true);
  assert.equal(worker.getStatus().tasksTimedOut, 1);
  assert.equal(worker.getStatus().tasksRetried, 1);
  assert.equal(worker.getStatus().tasksFailed, 0);
});

