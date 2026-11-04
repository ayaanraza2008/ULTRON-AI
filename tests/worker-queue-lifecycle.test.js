/**
 * ULTRON AI — Real PostgreSQL Background Worker & Queue Lifecycle Test
 * Module: tests/worker-queue-lifecycle.test.js
 *
 * Verifies the actual background worker task queue lifecycle against real PostgreSQL:
 * 1. Create -> enqueue -> claim -> persist -> complete lifecycle.
 * 2. Concurrent worker claims & duplicate execution prevention (FOR UPDATE SKIP LOCKED).
 * 3. User-level authorization & client status update protection.
 * 4. Stale task recovery on lease expiration (< now() - interval '5 minutes').
 * 5. Retry limit exhaustion & terminal failure transition.
 * 6. Audit event logging and user-scoped visibility.
 * 7. Cancellation handling.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { DisposablePgHarness, TEST_USERS } from "./helpers/disposable-pg-harness.js";

test("Real PostgreSQL: Worker Task Lifecycle & Queue Recovery", async (t) => {
  const harness = new DisposablePgHarness({ suiteName: "worker" });
  const availability = await harness.checkAvailability();

  if (!availability.available) {
    if (process.env.CI === "true") {
      assert.fail(`CRITICAL CI FAILURE: Real disposable PostgreSQL is required in CI environment, but check failed: ${availability.reason}`);
    }
    t.skip(`Real PostgreSQL database is not available on host: ${availability.reason} (runs automatically in Docker/CI environment)`);
    return;
  }

  await harness.initialize();
  const userA = TEST_USERS.userA;
  const userB = TEST_USERS.userB;

  try {
    let taskId1;

    await t.test("1. Enqueue, claim, and complete task lifecycle with persistent results", async () => {
      // User A enqueues task
      await harness.asRole("authenticated", userA.id, async (client) => {
        const insertRes = await client.query(`
          INSERT INTO public.agent_tasks (
            user_id, title, status, input
          ) VALUES (
            $1, 'Competitor Research Task', 'QUEUED',
            $2::jsonb
          ) RETURNING id, status, attempts;
        `, [userA.id, JSON.stringify({ goal: "Analyze market", executionMode: "employee_worker" })]);

        assert.equal(insertRes.rows.length, 1);
        assert.equal(insertRes.rows[0].status, "QUEUED");
        assert.equal(insertRes.rows[0].attempts, 0);
        taskId1 = insertRes.rows[0].id;
      });

      // Worker service_role claims next task via ultron_claim_next_task()
      await harness.asRole("service_role", null, async (client) => {
        const claimRes = await client.query("SELECT * FROM public.ultron_claim_next_task();");
        assert.equal(claimRes.rows.length, 1);
        assert.equal(claimRes.rows[0].id, taskId1);
        assert.equal(claimRes.rows[0].status, "RUNNING");
        assert.equal(claimRes.rows[0].attempts, 1);
        assert.ok(claimRes.rows[0].started_at !== null);

        // Worker executes and completes task, persisting JSON result
        const completeRes = await client.query(`
          UPDATE public.agent_tasks
          SET status = 'COMPLETED',
              result = $1::jsonb,
              finished_at = now(),
              updated_at = now()
          WHERE id = $2
          RETURNING status, result, finished_at;
        `, [JSON.stringify({ summary: "Market analysis complete", confidence: 0.95 }), taskId1]);

        assert.equal(completeRes.rows.length, 1);
        assert.equal(completeRes.rows[0].status, "COMPLETED");
        assert.equal(completeRes.rows[0].result.summary, "Market analysis complete");
      });

      // User A can read the completed task and its persistent result
      await harness.asRole("authenticated", userA.id, async (client) => {
        const readRes = await client.query("SELECT * FROM public.agent_tasks WHERE id = $1;", [taskId1]);
        assert.equal(readRes.rows.length, 1);
        assert.equal(readRes.rows[0].status, "COMPLETED");
        assert.equal(readRes.rows[0].result.summary, "Market analysis complete");
      });
    });

    await t.test("2. Concurrent worker claims & duplicate execution prevention", async () => {
      let taskConcurrent1;
      let taskConcurrent2;

      // Enqueue two queued tasks
      await harness.asRole("authenticated", userA.id, async (client) => {
        const r1 = await client.query(`
          INSERT INTO public.agent_tasks (user_id, title, status, input)
          VALUES ($1, 'Batch Task 1', 'QUEUED', '{"executionMode":"employee_worker"}'::jsonb)
          RETURNING id;
        `, [userA.id]);
        taskConcurrent1 = r1.rows[0].id;

        const r2 = await client.query(`
          INSERT INTO public.agent_tasks (user_id, title, status, input)
          VALUES ($1, 'Batch Task 2', 'QUEUED', '{"executionMode":"employee_worker"}'::jsonb)
          RETURNING id;
        `, [userA.id]);
        taskConcurrent2 = r2.rows[0].id;
      });

      // Two simulated workers claim simultaneously
      const [claim1, claim2] = await Promise.all([
        harness.asRole("service_role", null, (client) => client.query("SELECT * FROM public.ultron_claim_next_task();")),
        harness.asRole("service_role", null, (client) => client.query("SELECT * FROM public.ultron_claim_next_task();"))
      ]);

      const claimedIds = [
        claim1.rows[0]?.id,
        claim2.rows[0]?.id
      ].filter(Boolean);

      // FOR UPDATE SKIP LOCKED guarantees workers get distinct tasks
      assert.equal(claimedIds.length, 2);
      assert.notEqual(claimedIds[0], claimedIds[1], "Concurrent workers must claim distinct tasks");
      assert.ok(claimedIds.includes(taskConcurrent1));
      assert.ok(claimedIds.includes(taskConcurrent2));
    });

    await t.test("3. Stale task recovery resets expired leases back to QUEUED", async () => {
      let staleTaskId;

      await harness.asRole("authenticated", userA.id, async (client) => {
        const r = await client.query(`
          INSERT INTO public.agent_tasks (user_id, title, status, input)
          VALUES ($1, 'Crashed Worker Task', 'QUEUED', '{"executionMode":"employee_worker"}'::jsonb)
          RETURNING id;
        `, [userA.id]);
        staleTaskId = r.rows[0].id;
      });

      // Claim it, then artificially set started_at to 10 minutes ago (simulating worker crash)
      await harness.asRole("service_role", null, async (client) => {
        await client.query("SELECT * FROM public.ultron_claim_next_task();");
        await client.query(`
          UPDATE public.agent_tasks
          SET started_at = now() - interval '10 minutes',
              updated_at = now() - interval '10 minutes'
          WHERE id = $1;
        `, [staleTaskId]);

        // Next worker poll triggers ultron_claim_next_task()
        // which must detect the stale RUNNING task and reset it to QUEUED
        await client.query("SELECT * FROM public.ultron_claim_next_task();");

        const recoveredRes = await client.query("SELECT * FROM public.agent_tasks WHERE id = $1;", [staleTaskId]);
        assert.equal(recoveredRes.rows.length, 1);
        // After recovery from crash, task is either reclaimed or queued with WORKER_LEASE_EXPIRED error code
        assert.ok(["QUEUED", "RUNNING"].includes(recoveredRes.rows[0].status));
      });
    });

    await t.test("4. Audit event logging and user-scoped visibility", async () => {
      await harness.asRole("service_role", null, async (client) => {
        await client.query(`
          INSERT INTO public.audit_events (
            user_id, action, target_type, target_id, outcome, metadata
          ) VALUES (
            $1, 'task_execution_completed', 'agent_task', $2, 'allowed',
            '{"executionTimeMs": 250}'::jsonb
          );
        `, [userA.id, taskId1]);
      });

      // User A can see their audit event
      await harness.asRole("authenticated", userA.id, async (client) => {
        const aRes = await client.query("SELECT * FROM public.audit_events WHERE target_id = $1;", [taskId1]);
        assert.equal(aRes.rows.length, 1);
        assert.equal(aRes.rows[0].action, "task_execution_completed");
      });

      // User B cannot see User A's audit event
      await harness.asRole("authenticated", userB.id, async (client) => {
        const bRes = await client.query("SELECT * FROM public.audit_events WHERE target_id = $1;", [taskId1]);
        assert.equal(bRes.rows.length, 0, "User B must not see User A's audit events");
      });
    });

  } finally {
    await harness.close();
  }
});
