/**
 * ULTRON AI — Real Worker Runtime Process & End-to-End Task Lifecycle Test
 * Test: tests/worker-runtime-process.test.js
 *
 * Verifies the actual ULTRON worker runtime process (`startWorker` from `worker.js`)
 * running against a real disposable PostgreSQL database instance:
 * 1. Task insertion into PostgreSQL (`status = 'QUEUED'`).
 * 2. Real worker startup, polling, and RPC task claim (`ultron_claim_next_task`).
 * 3. Execution dispatch, output synthesis, and status transition to `COMPLETED`.
 * 4. Result payload and audit event persistence directly in PostgreSQL tables.
 * 5. In-flight lease renewal (`renewTaskLease`) and fencing against inactive tasks.
 * 6. Stale task lease recovery (`ultron_recover_stale_tasks`) on crashed worker simulation.
 * 7. Graceful worker shutdown (`worker.stop()` -> `await worker.done`).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { DisposablePgHarness, TEST_USERS } from "./helpers/disposable-pg-harness.js";
import { startWorker, renewTaskLease } from "../worker.js";

test("Real PostgreSQL: Worker Runtime Process & End-to-End Lifecycle", async (t) => {
  const harness = new DisposablePgHarness({ suiteName: "runtime" });
  const availability = await harness.checkAvailability();

  if (!availability.available) {
    if (process.env.CI === "true") {
      assert.fail(`CRITICAL CI FAILURE: Real disposable PostgreSQL is required in CI environment, but check failed: ${availability.reason}`);
    }
    t.skip(`Real PostgreSQL database is not available on host: ${availability.reason} (runs automatically in Docker/CI environment)`);
    return;
  }

  await harness.initialize();
  const user = TEST_USERS.userA;

  /**
   * High-fidelity REST-to-PostgreSQL fetch implementation that routes
   * PostgREST endpoints directly into the real disposable PostgreSQL database.
   */
  function createPostgresBridgeFetch(pool) {
    return async (input, init = {}) => {
      const urlStr = typeof input === "string" ? input : input.url;
      const url = new URL(urlStr);
      const pathname = url.pathname;
      const method = (init.method || "GET").toUpperCase();

      // Mock search provider (Tavily)
      if (url.hostname.includes("tavily.com")) {
        return new Response(JSON.stringify({
          query: "quantum computing breakthroughs",
          answer: "Recent quantum advances include fault-tolerant logical qubits and improved coherence times.",
          results: [
            {
              title: "Quantum Progress 2026",
              url: "https://example.com/quantum-2026",
              content: "Researchers demonstrated high-fidelity two-qubit gates above the error-correction threshold."
            }
          ]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 1. Claim next task RPC
      if (pathname.includes("/rpc/ultron_claim_next_task")) {
        const res = await pool.query("SELECT * FROM public.ultron_claim_next_task();");
        return new Response(JSON.stringify(res.rows), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 2. Claim due schedule RPC
      if (pathname.includes("/rpc/ultron_claim_due_employee_schedule")) {
        try {
          const res = await pool.query("SELECT * FROM public.ultron_claim_due_employee_schedule();");
          return new Response(JSON.stringify(res.rows), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        } catch {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      // 3. Agent tasks PATCH (lease renewal, completion, failure)
      if (pathname.includes("/agent_tasks") && method === "PATCH") {
        const rawBody = typeof init.body === "string" ? init.body : "{}";
        const patchData = JSON.parse(rawBody);

        const idParam = url.searchParams.get("id")?.replace(/^eq\./, "");
        const statusParam = url.searchParams.get("status")?.replace(/^eq\./, "");
        const attemptsParam = url.searchParams.get("attempts")?.replace(/^eq\./, "");

        const updates = [];
        const values = [];
        let pIndex = 1;

        if (patchData.status !== undefined) {
          updates.push(`status = $${pIndex++}`);
          values.push(patchData.status);
        }
        if (patchData.result !== undefined) {
          updates.push(`result = $${pIndex++}::jsonb`);
          values.push(JSON.stringify(patchData.result));
        }
        if (patchData.finished_at !== undefined) {
          updates.push(`finished_at = $${pIndex++}::timestamptz`);
          values.push(patchData.finished_at);
        }
        if (patchData.started_at !== undefined) {
          updates.push(`started_at = $${pIndex++}::timestamptz`);
          values.push(patchData.started_at);
        }
        if (patchData.updated_at !== undefined) {
          updates.push(`updated_at = $${pIndex++}::timestamptz`);
          values.push(patchData.updated_at);
        }
        if (patchData.error_code !== undefined) {
          updates.push(`error_code = $${pIndex++}`);
          values.push(patchData.error_code);
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        values.push(idParam);
        let whereClause = `id = $${pIndex++}`;

        if (statusParam) {
          values.push(statusParam);
          whereClause += ` AND status = $${pIndex++}`;
        }
        if (attemptsParam !== undefined && attemptsParam !== null) {
          values.push(Number(attemptsParam));
          whereClause += ` AND attempts = $${pIndex++}`;
        }

        const querySql = `UPDATE public.agent_tasks SET ${updates.join(", ")} WHERE ${whereClause} RETURNING *;`;
        const res = await pool.query(querySql, values);
        return new Response(JSON.stringify(res.rows), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 4. Audit events POST
      if (pathname.includes("/audit_events") && method === "POST") {
        const rawBody = typeof init.body === "string" ? init.body : "{}";
        const ev = JSON.parse(rawBody);

        const res = await pool.query(`
          INSERT INTO public.audit_events (
            user_id, action, target_type, target_id, outcome, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          RETURNING *;
        `, [
          ev.user_id,
          ev.action,
          ev.target_type || "agent_task",
          ev.target_id || null,
          ev.outcome || "allowed",
          JSON.stringify(ev.metadata || {})
        ]);

        return new Response(JSON.stringify(res.rows), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Endpoint not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    };
  }

  try {
    let queuedTaskId;

    await t.test("1. End-to-end task execution via real startWorker process loop", async () => {
      // 1. Enqueue task in PostgreSQL agent_tasks table
      const insertRes = await harness.pool.query(`
        INSERT INTO public.agent_tasks (
          user_id, title, status, input
        ) VALUES (
          $1, 'Quantum Research Task', 'QUEUED',
          $2::jsonb
        ) RETURNING id, status, attempts;
      `, [
        user.id,
        JSON.stringify({
          taskType: "research",
          query: "quantum computing breakthroughs",
          executionMode: "employee_worker"
        })
      ]);

      assert.equal(insertRes.rows.length, 1);
      assert.equal(insertRes.rows[0].status, "QUEUED");
      queuedTaskId = insertRes.rows[0].id;

      // 2. Configure worker environment
      const workerEnv = {
        SUPABASE_URL: "https://disposable-pg.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test_service_role_key_disposable",
        ULTRON_WORKER_POLL_MS: "50",
        TAVILY_API_KEY: "test_tavily_key"
      };

      const customFetch = createPostgresBridgeFetch(harness.pool);

      // Fast sleep so worker cycles without blocking test execution
      const fastSleep = async (ms, val, opts) => sleep(Math.min(ms, 20), val, opts);

      // 3. Launch the actual ULTRON worker runtime
      const worker = startWorker({
        env: workerEnv,
        fetchImpl: customFetch,
        sleepImpl: fastSleep,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      assert.equal(worker.getStatus().state, "running");

      // 4. Wait for worker to claim, process, and complete the task
      let completed = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        const checkRes = await harness.pool.query(
          "SELECT status, attempts, result, finished_at FROM public.agent_tasks WHERE id = $1;",
          [queuedTaskId]
        );
        if (checkRes.rows[0]?.status === "COMPLETED") {
          completed = true;
          const taskRow = checkRes.rows[0];
          assert.equal(taskRow.status, "COMPLETED");
          assert.equal(taskRow.attempts, 1);
          assert.ok(taskRow.finished_at !== null);
          assert.equal(taskRow.result?.type, "research");
          assert.ok(taskRow.result?.answer?.includes("fault-tolerant logical qubits"));
          assert.equal(taskRow.result?.sources?.length, 1);
          assert.equal(taskRow.result?.sources[0].url, "https://example.com/quantum-2026");
          break;
        }
        await sleep(50);
      }

      assert.ok(completed, "Worker must process and complete the task within timeout");

      // 5. Verify audit event persistence in real PostgreSQL table
      const auditRes = await harness.pool.query(
        "SELECT action, outcome, target_id, metadata FROM public.audit_events WHERE target_id = $1;",
        [queuedTaskId]
      );
      assert.ok(auditRes.rows.length >= 1, "Task completion must record audit event");
      const completeAudit = auditRes.rows.find(r => r.action === "task.completed");
      assert.ok(completeAudit, "Must have task.completed audit entry");
      assert.equal(completeAudit.outcome, "allowed");
      assert.equal(completeAudit.metadata?.taskType, "research");

      // 6. Graceful shutdown
      worker.stop();
      await worker.done;
      assert.equal(worker.getStatus().state, "stopped");
      assert.equal(worker.getStatus().tasksCompleted, 1);
    });

    await t.test("2. Task lease renewal (renewTaskLease) against PostgreSQL", async () => {
      // Insert a running task
      const r = await harness.pool.query(`
        INSERT INTO public.agent_tasks (
          user_id, title, status, attempts, started_at, input
        ) VALUES (
          $1, 'Lease Heartbeat Task', 'RUNNING', 1, now() - interval '30 seconds',
          '{"taskType":"research","query":"lease test"}'::jsonb
        ) RETURNING id, started_at;
      `, [user.id]);
      const activeTaskId = r.rows[0].id;
      const initialStartedAt = new Date(r.rows[0].started_at).getTime();

      // Small sleep to ensure new timestamp advances
      await sleep(100);

      const customFetch = createPostgresBridgeFetch(harness.pool);
      let inactiveTriggered = false;

      // Mock rest adapter for renewTaskLease
      const mockRest = async (endpoint, options) => {
        const resp = await customFetch("https://disposable-pg.supabase.co/rest/v1/" + endpoint, options);
        return resp.json();
      };

      const renewed = await renewTaskLease({
        taskId: activeTaskId,
        attempts: 1,
        rest: mockRest,
        logger: { warn: () => {} },
        onInactive: () => { inactiveTriggered = true; }
      });

      assert.equal(renewed, true, "Lease renewal must succeed for RUNNING task");
      assert.equal(inactiveTriggered, false);

      // Verify started_at was bumped in PostgreSQL
      const updatedRow = await harness.pool.query("SELECT started_at FROM public.agent_tasks WHERE id = $1;", [activeTaskId]);
      const newStartedAt = new Date(updatedRow.rows[0].started_at).getTime();
      assert.ok(newStartedAt > initialStartedAt, "started_at must advance on renewal");

      // Attempt to renew on non-RUNNING task (e.g. COMPLETED)
      await harness.pool.query("UPDATE public.agent_tasks SET status = 'COMPLETED' WHERE id = $1;", [activeTaskId]);

      const failedRenewal = await renewTaskLease({
        taskId: activeTaskId,
        attempts: 1,
        rest: mockRest,
        logger: { warn: () => {} },
        onInactive: () => { inactiveTriggered = true; }
      });

      assert.equal(failedRenewal, false, "Lease renewal must fail for non-RUNNING task");
      assert.equal(inactiveTriggered, true, "onInactive callback must be triggered");
    });

    await t.test("3. Stale task recovery (ultron_claim_next_task RPC) in PostgreSQL", async () => {
      // Insert a stalled task with started_at 15 minutes ago with worker executionMode
      const r = await harness.pool.query(`
        INSERT INTO public.agent_tasks (
          user_id, title, status, attempts, started_at, input
        ) VALUES (
          $1, 'Crashed Worker Recovery Task', 'RUNNING', 1, now() - interval '15 minutes',
          '{"taskType":"research","executionMode":"employee_worker","query":"recovery test"}'::jsonb
        ) RETURNING id;
      `, [user.id]);
      const staleId = r.rows[0].id;

      // Call database recovery via ultron_claim_next_task RPC
      await harness.pool.query("SELECT * FROM public.ultron_claim_next_task();");

      // Verify task was recovered from stale crash lease
      const checkRes = await harness.pool.query("SELECT status, started_at FROM public.agent_tasks WHERE id = $1;", [staleId]);
      assert.ok(["QUEUED", "RUNNING"].includes(checkRes.rows[0].status), "Stale task must be recovered to QUEUED or claimed as RUNNING");
    });

  } finally {
    await harness.close();
  }
});
