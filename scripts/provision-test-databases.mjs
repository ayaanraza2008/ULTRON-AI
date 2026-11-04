/**
 * ULTRON AI — Test Database Provisioner
 * Script: scripts/provision-test-databases.mjs
 *
 * Connects to the disposable test PostgreSQL container and provisions
 * isolated databases for parallel test execution:
 * - ultron_test_rls: RLS multi-tenant security suite
 * - ultron_test_migration: Paired device migration & rollback lifecycle suite
 * - ultron_test_worker: Worker task queue lifecycle suite
 * - ultron_test_runtime: Worker runtime process suite
 */

import pg from "pg";
import { sanitizeConnectionString, validateTestDatabaseTarget } from "../tests/helpers/disposable-pg-harness.js";

const rootUrl = process.env.ULTRON_TEST_DATABASE_URL || "postgres://ultron_tester@127.0.0.1:5432/ultron_test";
const TARGET_DATABASES = [
  "ultron_test_rls",
  "ultron_test_migration",
  "ultron_test_worker",
  "ultron_test_runtime"
];

async function main() {
  validateTestDatabaseTarget(rootUrl);
  console.log(`[ULTRON-CI] Connecting to root test database: ${sanitizeConnectionString(rootUrl)}`);

  const client = new pg.Client({
    connectionString: rootUrl,
    password: process.env.PGPASSWORD || undefined,
    connectionTimeoutMillis: 5000
  });
  await client.connect();

  try {
    for (const dbName of TARGET_DATABASES) {
      const checkRes = await client.query("SELECT 1 FROM pg_database WHERE datname = $1;", [dbName]);
      if (checkRes.rows.length === 0) {
        console.log(`[ULTRON-CI] Creating isolated test database: ${dbName}`);
        await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}";`);
      } else {
        console.log(`[ULTRON-CI] Test database already exists: ${dbName}`);
      }
    }
    console.log("[ULTRON-CI] All isolated test databases provisioned successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[ULTRON-CI] Failed to provision test databases:", err.message);
  process.exit(1);
});
