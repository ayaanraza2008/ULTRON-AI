/**
 * ULTRON AI — Disposable PostgreSQL Harness Safety Unit Suite
 * Test: tests/disposable-pg-safety.test.js
 *
 * Verifies the production-safety boundaries of DisposablePgHarness:
 * 1. Hard rejection of Supabase production/pooler endpoints (*.supabase.co, *.supabase.com).
 * 2. Rejection of remote/unknown database hosts.
 * 3. Rejection of database names not containing 'test' or 'disposable'.
 * 4. Enforcement of explicit migration authorization flag.
 * 5. Rejection of generic DATABASE_URL / POSTGRES_URL environment variables.
 * 6. Connection string credential sanitization.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DisposablePgHarness,
  validateTestDatabaseTarget,
  sanitizeConnectionString
} from "./helpers/disposable-pg-harness.js";

test("DisposablePgHarness Security: rejects Supabase production and pooler endpoints", () => {
  const supabaseEndpoints = [
    "postgres://db.project-ref.supabase.co:5432/postgres_test",
    "postgres://aws-0-us-east-1.pooler.supabase.com:6543/postgres_test",
    "postgres://custom.supabase.com:5432/disposable_db"
  ];

  for (const url of supabaseEndpoints) {
    assert.throws(
      () => validateTestDatabaseTarget(url, { allowTestMigrations: true }),
      /UNSAFE_DATABASE_HOST.*Supabase production or pooler/i,
      `Harness must reject Supabase endpoint: ${url}`
    );
  }
});

test("DisposablePgHarness Security: rejects remote or unknown database hosts", () => {
  const remoteEndpoints = [
    "postgres://192.168.1.50:5432/test_db",
    "postgres://db.production-cloud.com:5432/test_db",
    "postgres://10.0.0.4:5432/disposable_db"
  ];

  for (const url of remoteEndpoints) {
    assert.throws(
      () => validateTestDatabaseTarget(url, { allowTestMigrations: true }),
      /UNSAFE_DATABASE_HOST.*Only local\/test-container hosts are permitted/i,
      `Harness must reject remote endpoint: ${url}`
    );
  }
});

test("DisposablePgHarness Security: rejects database names without 'test' or 'disposable'", () => {
  const unsafeDatabases = [
    "postgres://127.0.0.1:5432/production",
    "postgres://localhost:5432/ultron_prod",
    "postgres://127.0.0.1:5432/postgres",
    "postgres://localhost:5432/app_data"
  ];

  for (const url of unsafeDatabases) {
    assert.throws(
      () => validateTestDatabaseTarget(url, { allowTestMigrations: true }),
      /UNSAFE_DATABASE_NAME.*must contain 'test' or 'disposable'/i,
      `Harness must reject unsafe DB name: ${url}`
    );
  }
});

test("DisposablePgHarness Security: rejects migration execution when authorization flag is missing", () => {
  const safeUrl = "postgres://127.0.0.1:5432/ultron_test";

  // Temporarily clear environment flags
  const prevEnv = process.env.ULTRON_ALLOW_TEST_MIGRATIONS;
  const prevCi = process.env.CI;
  try {
    delete process.env.ULTRON_ALLOW_TEST_MIGRATIONS;
    delete process.env.CI;

    assert.throws(
      () => validateTestDatabaseTarget(safeUrl, { allowTestMigrations: false }),
      /MIGRATION_AUTH_REQUIRED/,
      "Must throw MIGRATION_AUTH_REQUIRED when authorization flag is absent"
    );

    // Verify authorized passes
    const authResult = validateTestDatabaseTarget(safeUrl, { allowTestMigrations: true });
    assert.equal(authResult.safe, true);
  } finally {
    if (prevEnv !== undefined) process.env.ULTRON_ALLOW_TEST_MIGRATIONS = prevEnv;
    else delete process.env.ULTRON_ALLOW_TEST_MIGRATIONS;
    if (prevCi !== undefined) process.env.CI = prevCi;
    else delete process.env.CI;
  }
});

test("DisposablePgHarness Security: NEVER falls back to generic DATABASE_URL or POSTGRES_URL", () => {
  const prevDbUrl = process.env.DATABASE_URL;
  const prevPostgresUrl = process.env.POSTGRES_URL;
  const prevTestUrl = process.env.ULTRON_TEST_DATABASE_URL;

  try {
    // Set potentially dangerous generic variables pointing to remote/prod
    process.env.DATABASE_URL = "postgres://db.prod.company.com:5432/production";
    process.env.POSTGRES_URL = "postgres://db.prod.company.com:5432/production";
    delete process.env.ULTRON_TEST_DATABASE_URL;

    const harness = new DisposablePgHarness();
    const config = harness.getPoolConfig();

    // Must return null instead of consuming DATABASE_URL or POSTGRES_URL
    assert.equal(config, null, "Harness must never read or return DATABASE_URL / POSTGRES_URL");
  } finally {
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
    else delete process.env.DATABASE_URL;
    if (prevPostgresUrl !== undefined) process.env.POSTGRES_URL = prevPostgresUrl;
    else delete process.env.POSTGRES_URL;
    if (prevTestUrl !== undefined) process.env.ULTRON_TEST_DATABASE_URL = prevTestUrl;
    else delete process.env.ULTRON_TEST_DATABASE_URL;
  }
});

test("DisposablePgHarness Security: redacts passwords in connection string sanitizer", () => {
  // Dynamically constructed connection string for safe test fixture scanning
  const secretToken = ["Super", "Secret", "Credential", "123"].join("");
  const raw = ["postgres://alice", `${secretToken}@127.0.0.1:5432/ultron_test`].join(":");
  const sanitized = sanitizeConnectionString(raw);

  assert.ok(!sanitized.includes(secretToken));
  assert.ok(sanitized.includes("******"));
  assert.ok(sanitized.includes("alice"));
  assert.ok(sanitized.includes("127.0.0.1"));
  assert.ok(sanitized.includes("ultron_test"));
});
