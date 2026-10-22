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
  assert.equal(typeof status.lastCycleSuccessAt, "undefined");
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