/**
 * ULTRON AI — Genuine PostgreSQL & Supabase Multi-Tenant RLS Verification
 * Module: tests/supabase-isolation-real-pg.test.js
 *
 * Executes against a REAL PostgreSQL database instance (service container in CI).
 * Uses actual project migrations and verifies PostgreSQL engine-level Row-Level Security:
 * 1. User A can access their own private records.
 * 2. User B can access their own private records.
 * 3. User A cannot read User B's records (PostgreSQL RLS filters out rows).
 * 4. User B cannot read User A's records (PostgreSQL RLS filters out rows).
 * 5. User A cannot insert records with User B's identity (PostgreSQL throws 42501 policy violation).
 * 6. User A cannot update or delete User B's records (PostgreSQL RLS filters out rows; 0 affected).
 * 7. Unauthenticated requests (anon role) are rejected.
 * 8. Service-role operations bypass RLS for trusted backend operations.
 * 9. Memory, conversation, message, and task access enforces exact ownership.
 * 10. Paired-device records cannot be read, inserted, or modified by unauthorized users.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DisposablePgHarness, TEST_USERS } from "./helpers/disposable-pg-harness.js";

test("Real PostgreSQL & Supabase RLS Multi-Tenant Isolation Suite", async (t) => {
  const harness = new DisposablePgHarness({ suiteName: "rls" });
  const availability = await harness.checkAvailability();

  if (!availability.available) {
    if (process.env.CI === "true") {
      assert.fail(`CRITICAL CI FAILURE: Real disposable PostgreSQL is required in CI environment, but check failed: ${availability.reason}`);
    }
    t.skip(`Real PostgreSQL database is not available on this host: ${availability.reason} (runs automatically in Docker/CI environment)`);
    return;
  }

  const initResult = await harness.initialize();
  assert.equal(initResult.ready, true, "Harness initialization must succeed on available PostgreSQL instance");

  const userA = TEST_USERS.userA;
  const userB = TEST_USERS.userB;

  try {
    let convAId;
    let convBId;
    let msgAId;
    let msgBId;
    let memAId;
    let memBId;
    let taskAId;
    let taskBId;

    await t.test("1. User A can insert and access their own private records", async () => {
      await harness.asRole("authenticated", userA.id, async (client) => {
        // Conversation
        const convRes = await client.query(
          "INSERT INTO public.conversations (user_id, title) VALUES ($1, $2) RETURNING id, title;",
          [userA.id, "Private Project Alpha"]
        );
        assert.equal(convRes.rows.length, 1);
        convAId = convRes.rows[0].id;

        // Message
        const msgRes = await client.query(
          "INSERT INTO public.messages (conversation_id, user_id, role, content) VALUES ($1, $2, $3, $4) RETURNING id;",
          [convAId, userA.id, "user", "Confidential Alpha message"]
        );
        assert.equal(msgRes.rows.length, 1);
        msgAId = msgRes.rows[0].id;

        // Memory Item
        const memRes = await client.query(
          "INSERT INTO public.memory_items (user_id, kind, title, content) VALUES ($1, $2, $3, $4) RETURNING id;",
          [userA.id, "preference", "Alpha Preference", "Secret Alpha content"]
        );
        assert.equal(memRes.rows.length, 1);
        memAId = memRes.rows[0].id;

        // Agent Task
        const taskRes = await client.query(
          "INSERT INTO public.agent_tasks (user_id, title, input) VALUES ($1, $2, $3) RETURNING id;",
          [userA.id, "Alpha Agent Task", JSON.stringify({ goal: "Analyze Alpha" })]
        );
        assert.equal(taskRes.rows.length, 1);
        taskAId = taskRes.rows[0].id;

        // Verify User A can select them back
        const checkConv = await client.query("SELECT * FROM public.conversations WHERE id = $1;", [convAId]);
        assert.equal(checkConv.rows.length, 1);
        assert.equal(checkConv.rows[0].user_id, userA.id);

        const checkMem = await client.query("SELECT * FROM public.memory_items WHERE id = $1;", [memAId]);
        assert.equal(checkMem.rows.length, 1);

        const checkTask = await client.query("SELECT * FROM public.agent_tasks WHERE id = $1;", [taskAId]);
        assert.equal(checkTask.rows.length, 1);
      });
    });

    await t.test("2. User B can insert and access their own private records", async () => {
      await harness.asRole("authenticated", userB.id, async (client) => {
        // Conversation
        const convRes = await client.query(
          "INSERT INTO public.conversations (user_id, title) VALUES ($1, $2) RETURNING id, title;",
          [userB.id, "Private Project Beta"]
        );
        assert.equal(convRes.rows.length, 1);
        convBId = convRes.rows[0].id;

        // Message
        const msgRes = await client.query(
          "INSERT INTO public.messages (conversation_id, user_id, role, content) VALUES ($1, $2, $3, $4) RETURNING id;",
          [convBId, userB.id, "user", "Confidential Beta message"]
        );
        assert.equal(msgRes.rows.length, 1);
        msgBId = msgRes.rows[0].id;

        // Memory Item
        const memRes = await client.query(
          "INSERT INTO public.memory_items (user_id, kind, title, content) VALUES ($1, $2, $3, $4) RETURNING id;",
          [userB.id, "preference", "Beta Preference", "Secret Beta content"]
        );
        assert.equal(memRes.rows.length, 1);
        memBId = memRes.rows[0].id;

        // Agent Task
        const taskRes = await client.query(
          "INSERT INTO public.agent_tasks (user_id, title, input) VALUES ($1, $2, $3) RETURNING id;",
          [userB.id, "Beta Agent Task", JSON.stringify({ goal: "Analyze Beta" })]
        );
        assert.equal(taskRes.rows.length, 1);
        taskBId = taskRes.rows[0].id;

        // Verify User B can select them back
        const checkConv = await client.query("SELECT * FROM public.conversations WHERE id = $1;", [convBId]);
        assert.equal(checkConv.rows.length, 1);
        assert.equal(checkConv.rows[0].user_id, userB.id);
      });
    });

    await t.test("3. User A CANNOT read User B's records (PostgreSQL RLS filtering)", async () => {
      await harness.asRole("authenticated", userA.id, async (client) => {
        // Querying all conversations: must see only User A's
        const allConvs = await client.query("SELECT * FROM public.conversations;");
        assert.equal(allConvs.rows.every(r => r.user_id === userA.id), true);
        assert.equal(allConvs.rows.some(r => r.id === convBId), false);

        // Targeted probe for User B's conversation ID: PostgreSQL RLS returns 0 rows
        const targetConv = await client.query("SELECT * FROM public.conversations WHERE id = $1;", [convBId]);
        assert.equal(targetConv.rows.length, 0, "PostgreSQL RLS must return 0 rows for User B's conversation");

        // Targeted probe for User B's message: returns 0 rows
        const targetMsg = await client.query("SELECT * FROM public.messages WHERE id = $1;", [msgBId]);
        assert.equal(targetMsg.rows.length, 0, "PostgreSQL RLS must return 0 rows for User B's message");

        // Targeted probe for User B's memory: returns 0 rows
        const targetMem = await client.query("SELECT * FROM public.memory_items WHERE id = $1;", [memBId]);
        assert.equal(targetMem.rows.length, 0, "PostgreSQL RLS must return 0 rows for User B's memory");

        // Targeted probe for User B's task: returns 0 rows
        const targetTask = await client.query("SELECT * FROM public.agent_tasks WHERE id = $1;", [taskBId]);
        assert.equal(targetTask.rows.length, 0, "PostgreSQL RLS must return 0 rows for User B's task");
      });
    });

    await t.test("4. User B CANNOT read User A's records (PostgreSQL RLS filtering)", async () => {
      await harness.asRole("authenticated", userB.id, async (client) => {
        const targetConv = await client.query("SELECT * FROM public.conversations WHERE id = $1;", [convAId]);
        assert.equal(targetConv.rows.length, 0, "User B must not see User A's conversation");

        const targetMem = await client.query("SELECT * FROM public.memory_items WHERE id = $1;", [memAId]);
        assert.equal(targetMem.rows.length, 0, "User B must not see User A's memory");
      });
    });

    await t.test("5. User A CANNOT insert records with User B's identity (RLS 42501 rejection)", async () => {
      await harness.asRole("authenticated", userA.id, async (client) => {
        // Attempting to insert a conversation forged with user_id = userB.id
        await assert.rejects(
          client.query(
            "INSERT INTO public.conversations (user_id, title) VALUES ($1, $2);",
            [userB.id, "Forged Conversation by A"]
          ),
          (err) => {
            assert.equal(err.code, "42501", "PostgreSQL must throw 42501 policy violation");
            assert.match(err.message, /violates row-level security policy/i);
            return true;
          }
        );
      });

      await harness.asRole("authenticated", userA.id, async (client) => {
        // Attempting to insert a memory forged with user_id = userB.id
        await assert.rejects(
          client.query(
            "INSERT INTO public.memory_items (user_id, kind, title, content) VALUES ($1, $2, $3, $4);",
            [userB.id, "preference", "Forged Memory", "Forged content"]
          ),
          (err) => {
            assert.equal(err.code, "42501");
            return true;
          }
        );
      });
    });

    await t.test("6. User A CANNOT update or delete User B's records", async () => {
      await harness.asRole("authenticated", userA.id, async (client) => {
        // Update User B's conversation: 0 rows affected
        const updateRes = await client.query(
          "UPDATE public.conversations SET title = 'Compromised' WHERE id = $1 RETURNING *;",
          [convBId]
        );
        assert.equal(updateRes.rowCount, 0, "PostgreSQL RLS must block cross-user update; rowCount must be 0");

        // Delete User B's conversation: 0 rows affected
        const deleteRes = await client.query(
          "DELETE FROM public.conversations WHERE id = $1 RETURNING *;",
          [convBId]
        );
        assert.equal(deleteRes.rowCount, 0, "PostgreSQL RLS must block cross-user delete; rowCount must be 0");
      });

      // Verify User B's record is intact
      await harness.asRole("authenticated", userB.id, async (client) => {
        const verifyRes = await client.query("SELECT * FROM public.conversations WHERE id = $1;", [convBId]);
        assert.equal(verifyRes.rows.length, 1);
        assert.equal(verifyRes.rows[0].title, "Private Project Beta", "Record content must remain intact");
      });
    });

    await t.test("7. Unauthenticated callers (anon role) are rejected", async () => {
      await harness.asRole("anon", null, async (client) => {
        // Reading conversations: either rejected by table privilege (42501) or returns 0 rows via RLS
        try {
          const anonSelect = await client.query("SELECT * FROM public.conversations;");
          assert.equal(anonSelect.rows.length, 0);
        } catch (err) {
          assert.equal(err.code, "42501", "Unauthenticated read must be rejected by table privilege or RLS");
        }

        // Inserting without authentication fails
        await assert.rejects(
          client.query(
            "INSERT INTO public.conversations (user_id, title) VALUES ($1, $2);",
            [userA.id, "Anon forged"]
          ),
          (err) => {
            assert.ok(err.code === "42501" || /violates row-level security policy/i.test(err.message));
            return true;
          }
        );
      });
    });

    await t.test("8. Service-role operations bypass RLS for trusted backend logic", async () => {
      await harness.asRole("service_role", null, async (client) => {
        // service_role can inspect all conversations
        const allRes = await client.query("SELECT count(*)::int AS cnt FROM public.conversations;");
        assert.ok(allRes.rows[0].cnt >= 2, "Service role must see all records");
      });
    });

    await t.test("9. Memory, conversation, message, and task access enforces exact ownership", async () => {
      await harness.asRole("authenticated", userA.id, async (client) => {
        const myTasks = await client.query("SELECT * FROM public.agent_tasks;");
        assert.ok(myTasks.rows.every(t => t.user_id === userA.id));

        const myMemories = await client.query("SELECT * FROM public.memory_items;");
        assert.ok(myMemories.rows.every(m => m.user_id === userA.id));
      });
    });

    await t.test("10. Paired-device records cannot be accessed or modified by unauthorized users", async () => {
      const deviceIdA = randomUUID();
      const tokenHashA = "a".repeat(64);

      // Backend service_role registers paired device for User A
      await harness.asRole("service_role", null, async (client) => {
        await client.query(`
          INSERT INTO public.paired_devices (id, owner_user_id, device_name, platform, token_hash, token_prefix, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [deviceIdA, userA.id, "User A Laptop", "windows", tokenHashA, "a".repeat(8), "active"]);
      });

      // User A can read their own device
      await harness.asRole("authenticated", userA.id, async (client) => {
        const readA = await client.query("SELECT * FROM public.paired_devices WHERE id = $1;", [deviceIdA]);
        assert.equal(readA.rows.length, 1);
        assert.equal(readA.rows[0].owner_user_id, userA.id);

        // User A cannot directly insert or modify token_hash (revoked privilege)
        await assert.rejects(
          client.query("UPDATE public.paired_devices SET token_hash = $1 WHERE id = $2;", ["b".repeat(64), deviceIdA]),
          (err) => {
            assert.equal(err.code, "42501", "Direct update must be denied by table privileges");
            return true;
          }
        );
      });

      // User B CANNOT read User A's paired device
      await harness.asRole("authenticated", userB.id, async (client) => {
        const readB = await client.query("SELECT * FROM public.paired_devices WHERE id = $1;", [deviceIdA]);
        assert.equal(readB.rows.length, 0, "User B must receive 0 rows for User A's paired device");
      });
    });

  } finally {
    await harness.close();
  }
});
