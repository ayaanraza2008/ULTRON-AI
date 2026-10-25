import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerSmoke } from "../scripts/worker-smoke.mjs";

const UUID = "11111111-1111-4111-8111-111111111111";
const serviceEnv = {
  ULTRON_CONFIRM_WORKER_SMOKE: "YES",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "never-return-this-service-secret",
  ULTRON_SMOKE_USER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
};

function response(value, status = 200) {
  return new Response(value === null ? null : JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("worker smoke does not write unless the explicit confirmation flag is present", async () => {
  let called = false;
  const result = await runWorkerSmoke({
    env: { ...serviceEnv, ULTRON_CONFIRM_WORKER_SMOKE: "" },
    fetchImpl: async () => { called = true; return response([]); }
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "EXPLICIT_CONFIRMATION_REQUIRED");
  assert.equal(called, false);
});

test("worker smoke inserts, polls to completion, cleans up, and redacts task result/secrets", async () => {
  let polls = 0;
  const result = await runWorkerSmoke({
    env: serviceEnv,
    nowMs: (() => { let t = 1000; return () => t; })(),
    now: () => "fixed-time",
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      assert.equal(options.headers.Authorization, "Bearer " + serviceEnv.SUPABASE_SERVICE_ROLE_KEY);
      if (url.endsWith("/rest/v1/agent_tasks")) {
        assert.equal(options.method, "POST");
        const body = JSON.parse(options.body);
        assert.equal(body.input.taskType, "employee");
        assert.equal(body.input.mode, "plan");
        return response([{ id: UUID, status: "QUEUED", attempts: 0 }], 201);
      }
      if (url.includes("/rest/v1/agent_tasks?select=")) {
        polls += 1;
        if (polls === 1) return response([{ id: UUID, status: "RUNNING", attempts: 1 }]);
        return response([{ id: UUID, status: "COMPLETED", attempts: 1, result: { content: "private provider output" } }]);
      }
      if (url.includes("/rest/v1/agent_tasks?id=eq.")) {
        assert.equal(options.method, "DELETE");
        return response(null, 204);
      }
      throw new Error("Unexpected URL");
    }
  });
  assert.equal(result.status, "passed");
  assert.equal(result.taskState, "COMPLETED");
  assert.equal(result.cleanup, "deleted");
  assert.equal(result.generatedAt, "fixed-time");
  assert.equal(JSON.stringify(result).includes(serviceEnv.SUPABASE_SERVICE_ROLE_KEY), false);
  assert.equal(JSON.stringify(result).includes("private provider output"), false);
});

test("worker smoke blocks unsafe Supabase URL and missing user ID before network", async () => {
  let called = false;
  const result = await runWorkerSmoke({
    env: { ...serviceEnv, SUPABASE_URL: "http://example.supabase.co", ULTRON_SMOKE_USER_ID: "not-a-uuid" },
    fetchImpl: async () => { called = true; return response([]); }
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "SUPABASE_URL_SERVICE_KEY_AND_VALID_SMOKE_USER_REQUIRED");
  assert.equal(called, false);
});

test("worker smoke reports a terminal failure without printing database result content", async () => {
  const result = await runWorkerSmoke({
    env: serviceEnv,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/rest/v1/agent_tasks")) return response([{ id: UUID, status: "QUEUED" }], 201);
      if (url.includes("/rest/v1/agent_tasks?select=")) return response([{
        id: UUID, status: "FAILED", attempts: 2, error_code: "EMPLOYEE_PROVIDER_NOT_CONFIGURED",
        result: { content: "do not expose this" }
      }]);
      if (url.includes("/rest/v1/agent_tasks?id=eq.")) return response(null, 204);
      throw new Error("Unexpected URL");
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "EMPLOYEE_PROVIDER_NOT_CONFIGURED");
  assert.equal(JSON.stringify(result).includes("do not expose this"), false);
  assert.equal(JSON.stringify(result).includes(serviceEnv.SUPABASE_SERVICE_ROLE_KEY), false);
});

test("worker smoke bounds polling and cancels only a still-queued timed-out task", async () => {
  let clock = 0;
  let patched = false;
  let deleted = false;
  const result = await runWorkerSmoke({
    env: serviceEnv,
    nowMs: () => clock,
    now: () => "fixed-time",
    timeoutMs: 15_000,
    pollIntervalMs: 5000,
    sleepImpl: async ms => { clock += ms; },
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/rest/v1/agent_tasks")) return response([{ id: UUID, status: "QUEUED" }], 201);
      if (url.includes("/rest/v1/agent_tasks?select=")) return response([{ id: UUID, status: "QUEUED", attempts: 0 }]);
      if (url.includes("&status=eq.QUEUED")) {
        patched = true;
        return response([{ id: UUID, status: "CANCELLED" }]);
      }
      if (url.includes("/rest/v1/agent_tasks?id=eq.")) {
        deleted = true;
        return response(null, 204);
      }
      throw new Error("Unexpected URL");
    }
  });
  assert.equal(result.status, "timed_out");
  assert.equal(patched, true);
  assert.equal(deleted, true);
  assert.equal(result.cleanup, "deleted");
});
test("worker smoke refuses private or non-Supabase endpoints before sending the service-role key", async () => {
  for (const SUPABASE_URL of [
    "https://127.0.0.1",
    "https://192.168.1.10",
    "https://127.1",
    "https://metadata.google.internal",
    "https://attacker.example.com",
    "https://not-supabase.com"
  ]) {
    let called = false;
    const result = await runWorkerSmoke({
      env: { ...serviceEnv, SUPABASE_URL },
      fetchImpl: async () => { called = true; return response([]); }
    });
    assert.equal(result.status, "blocked", SUPABASE_URL);
    assert.equal(called, false, SUPABASE_URL);
  }
});
