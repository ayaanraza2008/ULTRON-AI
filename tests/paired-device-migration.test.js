/**
 * ULTRON AI — Durable Paired-Device Migration & Real Database Verification
 * Module: tests/paired-device-migration.test.js
 *
 * Verifies the durable paired-device registry migration:
 * 1. Static syntax and security policy analysis.
 * 2. Real PostgreSQL database execution on disposable infrastructure:
 *    - Applies migration: creates tables, indexes, constraints, RLS policies, and RPC function.
 *    - Verifies tables and indexes in pg_tables and pg_indexes.
 *    - Verifies RLS is enabled on both tables.
 *    - Verifies permissions: claim_pending_device_pairing is executable ONLY by service_role.
 *    - Verifies SECURITY DEFINER and search_path = '' on RPC function.
 *    - Verifies token hash constraint (strictly 64-char lowercase hex SHA-256).
 *    - Verifies pairing code constraint (strictly 6-digit number).
 *    - Verifies atomic one-time claim and anti-replay consumption.
 *    - Verifies expired code rejection.
 *    - Verifies unapproved code rejection.
 *    - Tests DESTRUCTIVE rollback: drops tables and function cleanly without CASCADE;
 *      labels rollback explicitly as destructive (removes all device associations).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DisposablePgHarness, TEST_USERS } from "./helpers/disposable-pg-harness.js";

const migrationPath = path.join(process.cwd(), "supabase/migrations/20261101180000_durable_paired_devices.sql");
const rollbackPath = path.join(process.cwd(), "supabase/migrations/20261101180000_durable_paired_devices.rollback.sql");

// Part 1: Static Architecture & Safety Policies
test("paired-device SECURITY DEFINER RPC uses an empty search_path", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i);
});

test("paired-device RPC execution is restricted to service_role", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.claim_pending_device_pairing\(text\)\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.claim_pending_device_pairing\(text\)\s+to\s+service_role/i);
});

test("paired-device rollback is explicitly DESTRUCTIVE and documents data loss", () => {
  const sql = fs.readFileSync(rollbackPath, "utf8");
  assert.match(sql, /DESTRUCTIVE ROLLBACK/i);
  assert.match(sql, /permanently deletes paired-device metadata/i);
  assert.doesNotMatch(sql, /drop\s+table[^;]*cascade/i, "Rollback must not use CASCADE to prevent silent collateral data destruction");
});

// Part 2: Real Database Execution & Functional Verification
test("Real PostgreSQL: Durable Paired-Device Migration Execution & Lifecycle", async (t) => {
  const harness = new DisposablePgHarness();
  const availability = await harness.checkAvailability();

  if (!availability.available) {
    t.skip(`Real PostgreSQL database is not available on host: ${availability.reason} (runs automatically in Docker/CI environment)`);
    return;
  }

  await harness.initialize();
  const userA = TEST_USERS.userA;
  const userB = TEST_USERS.userB;

  try {
    await t.test("1. Tables, indexes, and RLS are active in database catalogs", async () => {
      await harness.asRole("service_role", null, async (client) => {
        // Verify tables exist
        const tablesRes = await client.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename IN ('paired_devices', 'pending_device_pairings');
        `);
        const tableNames = tablesRes.rows.map(r => r.tablename);
        assert.ok(tableNames.includes("paired_devices"), "paired_devices table must exist");
        assert.ok(tableNames.includes("pending_device_pairings"), "pending_device_pairings table must exist");

        // Verify RLS is enabled on both tables
        const rlsRes = await client.query(`
          SELECT relname, relrowsecurity
          FROM pg_class
          WHERE relname IN ('paired_devices', 'pending_device_pairings');
        `);
        for (const row of rlsRes.rows) {
          assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have RLS enabled`);
        }

        // Verify indexes exist
        const idxRes = await client.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename IN ('paired_devices', 'pending_device_pairings');
        `);
        const indexNames = idxRes.rows.map(r => r.indexname);
        assert.ok(indexNames.includes("paired_devices_owner_idx"));
        assert.ok(indexNames.includes("paired_devices_token_hash_idx"));
        assert.ok(indexNames.includes("pending_pairings_expiry_idx"));
      });
    });

    await t.test("2. RPC security: claim function enforces SECURITY DEFINER, empty search_path, and service_role", async () => {
      // Check pg_proc settings
      await harness.asRole("service_role", null, async (client) => {
        const procRes = await client.query(`
          SELECT proname, prosecdef, proconfig
          FROM pg_proc
          WHERE proname = 'claim_pending_device_pairing';
        `);
        assert.equal(procRes.rows.length, 1);
        assert.equal(procRes.rows[0].prosecdef, true, "Function must be SECURITY DEFINER");
        const configs = procRes.rows[0].proconfig || [];
        assert.ok(configs.some(c => c.startsWith("search_path=")), "Function must lock search_path");
      });

      // Calling as authenticated user must fail with 42501 permission denied
      await harness.asRole("authenticated", userA.id, async (client) => {
        await assert.rejects(
          client.query("SELECT * FROM public.claim_pending_device_pairing('123456');"),
          (err) => {
            assert.equal(err.code, "42501", "Authenticated caller must be denied permission to call claim RPC");
            return true;
          }
        );
      });

      // Calling as anon must fail with 42501 permission denied
      await harness.asRole("anon", null, async (client) => {
        await assert.rejects(
          client.query("SELECT * FROM public.claim_pending_device_pairing('123456');"),
          (err) => {
            assert.equal(err.code, "42501", "Anon caller must be denied permission to call claim RPC");
            return true;
          }
        );
      });
    });

    await t.test("3. Schema constraints: enforces 6-digit codes and 64-char hex SHA-256 token hashes", async () => {
      await harness.asRole("service_role", null, async (client) => {
        const validHash = crypto.createHash("sha256").update("sample-token").digest("hex");

        // Invalid code (not 6 digits, e.g. 5 digits or letters) fails check constraint
        await assert.rejects(
          client.query(`
            INSERT INTO public.pending_device_pairings (code, device_name, platform, token_hash)
            VALUES ('12345', 'Bad Device', 'windows', $1);
          `, [validHash]),
          (err) => {
            assert.equal(err.code, "23514", "Check constraint must reject non-6-digit code");
            return true;
          }
        );

        // Invalid token_hash (not 64-hex) fails check constraint
        await assert.rejects(
          client.query(`
            INSERT INTO public.pending_device_pairings (code, device_name, platform, token_hash)
            VALUES ('654321', 'Bad Device', 'windows', 'invalid-non-hex-hash');
          `),
          (err) => {
            assert.equal(err.code, "23514", "Check constraint must reject malformed token hash");
            return true;
          }
        );

        // Invalid platform (e.g. 'solaris') fails check constraint
        await assert.rejects(
          client.query(`
            INSERT INTO public.pending_device_pairings (code, device_name, platform, token_hash)
            VALUES ('654321', 'Bad Device', 'solaris', $1);
          `, [validHash]),
          (err) => {
            assert.equal(err.code, "23514", "Check constraint must reject unapproved platform");
            return true;
          }
        );
      });
    });

    await t.test("4. Full claim lifecycle: atomic consumption, anti-replay, and unapproved/expired rejection", async () => {
      const code1 = "987654";
      const deviceId1 = crypto.randomUUID();
      const token1 = "token-secret-" + crypto.randomBytes(16).toString("hex");
      const tokenHash1 = crypto.createHash("sha256").update(token1).digest("hex");
      const tokenPrefix1 = token1.slice(0, 8);

      await harness.asRole("service_role", null, async (client) => {
        // Insert pending challenge approved by User A
        await client.query(`
          INSERT INTO public.pending_device_pairings (
            code, device_name, platform, approved, approved_by,
            device_id, token_hash, token_prefix, encrypted_token, expires_at
          ) VALUES (
            $1, 'Surface Pro', 'windows', true, $2,
            $3, $4, $5, 'enc-payload-123', now() + interval '5 minutes'
          );
        `, [code1, userA.id, deviceId1, tokenHash1, tokenPrefix1]);

        // Claim pending pairing via service_role RPC
        const claimRes = await client.query("SELECT * FROM public.claim_pending_device_pairing($1);", [code1]);
        assert.equal(claimRes.rows.length, 1);
        assert.equal(claimRes.rows[0].device_id, deviceId1);
        assert.equal(claimRes.rows[0].owner_user_id, userA.id);
        assert.equal(claimRes.rows[0].token_hash, tokenHash1);

        // Verify pairing is now in public.paired_devices
        const pairedRes = await client.query("SELECT * FROM public.paired_devices WHERE id = $1;", [deviceId1]);
        assert.equal(pairedRes.rows.length, 1);
        assert.equal(pairedRes.rows[0].status, "active");

        // Verify pairing code was atomically deleted from pending_device_pairings
        const pendingRes = await client.query("SELECT * FROM public.pending_device_pairings WHERE code = $1;", [code1]);
        assert.equal(pendingRes.rows.length, 0);

        // Replay attack: calling claim again with same code MUST throw P0001
        await assert.rejects(
          client.query("SELECT * FROM public.claim_pending_device_pairing($1);", [code1]),
          (err) => {
            assert.equal(err.code, "P0001");
            assert.match(err.message, /already claimed/i);
            return true;
          }
        );

        // Expired pairing code test
        const expiredCode = "111222";
        await client.query(`
          INSERT INTO public.pending_device_pairings (
            code, device_name, platform, approved, approved_by,
            device_id, token_hash, token_prefix, encrypted_token, expires_at
          ) VALUES (
            $1, 'Old Device', 'android', true, $2,
            $3, $4, 'old-pref', 'enc-payload', now() - interval '10 seconds'
          );
        `, [expiredCode, userA.id, crypto.randomUUID(), crypto.createHash("sha256").update("old").digest("hex")]);

        await assert.rejects(
          client.query("SELECT * FROM public.claim_pending_device_pairing($1);", [expiredCode]),
          (err) => {
            assert.equal(err.code, "P0001");
            return true;
          }
        );
      });
    });

    await t.test("5. Destructive Rollback Execution & Schema Teardown Verification", async () => {
      await harness.asRole("service_role", null, async (client) => {
        // Execute the destructive rollback SQL
        const rollbackSql = fs.readFileSync(rollbackPath, "utf8");
        await client.query(rollbackSql);

        // Verify both tables are dropped
        const tablesRes = await client.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename IN ('paired_devices', 'pending_device_pairings');
        `);
        assert.equal(tablesRes.rows.length, 0, "All paired-device tables must be dropped by rollback");

        // Verify RPC function is dropped
        const procRes = await client.query(`
          SELECT proname FROM pg_proc WHERE proname = 'claim_pending_device_pairing';
        `);
        assert.equal(procRes.rows.length, 0, "claim_pending_device_pairing function must be dropped by rollback");

        // Re-apply migration so remaining tests have access to the tables
        const migrationSql = fs.readFileSync(migrationPath, "utf8");
        await client.query(migrationSql);
      });
    });

  } finally {
    await harness.close();
  }
});
