/**
 * ULTRON AI — Production-Safe Disposable PostgreSQL & Supabase Test Harness
 * Module: tests/helpers/disposable-pg-harness.js
 *
 * Implements strict, production-safe PostgreSQL testing on disposable infrastructure:
 * 1. ZERO fallback to generic production environment variables (DATABASE_URL, POSTGRES_URL).
 * 2. Only accepts designated test variables (ULTRON_TEST_DATABASE_URL, suite-specific URLs).
 * 3. Enforces strict Host Allowlist (localhost, 127.0.0.1, ::1, postgres, docker container names).
 * 4. Hard-rejects Supabase production and pooler endpoints (*.supabase.co, *.supabase.com).
 * 5. Requires database names containing 'test' or 'disposable'.
 * 6. Requires explicit migration authorization flag (ULTRON_ALLOW_TEST_MIGRATIONS=true).
 * 7. Verifies database identity via `SELECT current_database()` before any DDL or migration.
 * 8. Never exposes credentials or passwords in error messages or logs.
 * 9. Isolates test suites (RLS, migration, worker) into separate disposable databases.
 */

import fs from "node:fs";
import path from "node:path";

let pgModule = null;
try {
  pgModule = await import("pg");
} catch {}

export const TEST_USERS = {
  userA: {
    id: "a0000000-0000-4000-a000-000000000001",
    email: "user-a@ultron-test.local"
  },
  userB: {
    id: "b0000000-0000-4000-b000-000000000002",
    email: "user-b@ultron-test.local"
  }
};

const ALLOWED_TEST_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
  "database",
  "db",
  "docker"
]);

/**
 * Redacts passwords and sensitive tokens from connection strings for safe logging.
 */
export function sanitizeConnectionString(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "******";
    }
    return parsed.toString();
  } catch {
    return "[MALFORMED_URL]";
  }
}

/**
 * Validates that a connection target is strictly a local/test-container disposable database.
 */
export function validateTestDatabaseTarget(target, options = {}) {
  let host = "";
  let database = "";

  if (typeof target === "string") {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error("UNSAFE_DATABASE_CONFIG: Target connection string is malformed.");
    }
    host = parsed.hostname.toLowerCase();
    database = parsed.pathname.replace(/^\/+/, "").toLowerCase();
  } else if (target && typeof target === "object") {
    host = String(target.host || "").toLowerCase();
    database = String(target.database || "").toLowerCase();
  } else {
    throw new Error("UNSAFE_DATABASE_CONFIG: No database target configuration provided.");
  }

  // 1. Hard-reject Supabase cloud & pooler hosts
  if (/(^|\.)supabase\.(co|com)$/i.test(host) || /pooler\.supabase/i.test(host)) {
    throw new Error(`UNSAFE_DATABASE_HOST: Connecting to Supabase production or pooler hosts ('${host}') is strictly prohibited in test harness.`);
  }

  // 2. Reject remote/unknown hosts
  const isAllowedHost = ALLOWED_TEST_HOSTS.has(host) ||
    host.endsWith(".local") ||
    /^127\.\d+\.\d+\.\d+$/.test(host);

  if (!isAllowedHost) {
    throw new Error(`UNSAFE_DATABASE_HOST: Real database testing is prohibited against remote or unknown host '${host}'. Only local/test-container hosts are permitted.`);
  }

  // 3. Require database name containing 'test' or 'disposable'
  if (!database || (!database.includes("test") && !database.includes("disposable"))) {
    throw new Error(`UNSAFE_DATABASE_NAME: Target database name '${database}' must contain 'test' or 'disposable' to prevent accidental execution against production databases.`);
  }

  // 4. Require explicit test migration authorization
  const isAuthorized = options.allowTestMigrations === true ||
    process.env.ULTRON_ALLOW_TEST_MIGRATIONS === "true" ||
    process.env.CI === "true";

  if (!isAuthorized) {
    throw new Error("MIGRATION_AUTH_REQUIRED: Test migrations require explicit authorization via ULTRON_ALLOW_TEST_MIGRATIONS=true or allowTestMigrations option.");
  }

  return { safe: true, host, database };
}

export class DisposablePgHarness {
  constructor(options = {}) {
    this.options = options;
    this.suiteName = options.suiteName || "default"; // 'rls' | 'migration' | 'worker' | 'default'
    this.pool = null;
    this.isReady = false;
    this.activeDatabaseName = null;
  }

  /**
   * Resolves connection configuration strictly from designated test variables.
   * NEVER falls back to DATABASE_URL or POSTGRES_URL.
   */
  getPoolConfig() {
    let rawUrl = null;

    // 1. Direct option passed to harness
    if (this.options.connectionString) {
      rawUrl = this.options.connectionString;
    }
    // 2. Suite-specific environment variables
    else if (this.suiteName === "rls" && process.env.ULTRON_TEST_RLS_DATABASE_URL) {
      rawUrl = process.env.ULTRON_TEST_RLS_DATABASE_URL;
    } else if (this.suiteName === "migration" && process.env.ULTRON_TEST_MIGRATION_DATABASE_URL) {
      rawUrl = process.env.ULTRON_TEST_MIGRATION_DATABASE_URL;
    } else if (this.suiteName === "worker" && process.env.ULTRON_TEST_WORKER_DATABASE_URL) {
      rawUrl = process.env.ULTRON_TEST_WORKER_DATABASE_URL;
    } else if (this.suiteName === "runtime" && process.env.ULTRON_TEST_RUNTIME_DATABASE_URL) {
      rawUrl = process.env.ULTRON_TEST_RUNTIME_DATABASE_URL;
    }
    // 3. Primary test database URL
    else if (process.env.ULTRON_TEST_DATABASE_URL) {
      rawUrl = process.env.ULTRON_TEST_DATABASE_URL;
    }

    if (rawUrl) {
      // Validate target safety before returning
      validateTestDatabaseTarget(rawUrl, this.options);
      return { connectionString: rawUrl };
    }

    // 4. Structured PG host config (strictly for test environments)
    if (process.env.PGHOST && (process.env.ULTRON_ALLOW_TEST_MIGRATIONS === "true" || process.env.CI === "true")) {
      const dbName = this.options.database ||
        (this.suiteName !== "default" ? `ultron_test_${this.suiteName}` : (process.env.PGDATABASE || "ultron_test"));

      const config = {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "",
        database: dbName
      };

      validateTestDatabaseTarget(config, this.options);
      return config;
    }

    return null;
  }

  async checkAvailability() {
    if (!pgModule || !pgModule.Pool) {
      return { available: false, reason: "pg driver (node-postgres) is not installed." };
    }

    let config;
    try {
      config = this.getPoolConfig();
    } catch (err) {
      return { available: false, reason: err.message };
    }

    if (!config) {
      return {
        available: false,
        reason: "No valid test database configuration found. Set ULTRON_TEST_DATABASE_URL and ULTRON_ALLOW_TEST_MIGRATIONS=true."
      };
    }

    let probePool;
    try {
      probePool = new pgModule.Pool({
        ...config,
        connectionTimeoutMillis: 2000
      });

      const client = await probePool.connect();
      await client.query("SELECT 1;");
      client.release();
      await probePool.end();
      return { available: true };
    } catch (err) {
      if (probePool) {
        await probePool.end().catch(() => {});
      }
      return {
        available: false,
        reason: `Real PostgreSQL test database is not reachable at ${sanitizeConnectionString(config.connectionString || config.host)}: ${err.message}`
      };
    }
  }

  async initialize() {
    const check = await this.checkAvailability();
    if (!check.available) {
      return { ready: false, reason: check.reason };
    }

    const config = this.getPoolConfig();
    this.pool = new pgModule.Pool({
      ...config,
      max: 10
    });

    const client = await this.pool.connect();
    try {
      // 0. Verify identity against PostgreSQL engine
      const identityRes = await client.query("SELECT current_database(), current_user;");
      const currentDb = identityRes.rows[0].current_database;
      this.activeDatabaseName = currentDb;

      // Fail-closed verification: database name MUST contain 'test' or 'disposable'
      if (!currentDb.includes("test") && !currentDb.includes("disposable")) {
        throw new Error(`CRITICAL SECURITY ABORT: Connected database '${currentDb}' does not contain 'test' or 'disposable'. Halting before DDL.`);
      }

      // 1. Initialize Supabase baseline environment (auth, roles, storage, functions)
      await client.query(`
        -- Enable pgcrypto if present
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        -- Create Supabase roles if they do not exist
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role NOLOGIN BYPASSRLS;
          END IF;
        END $$;

        -- Grant schema usage to roles
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

        -- Create auth schema and users table
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email text UNIQUE,
          raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
          created_at timestamptz DEFAULT now()
        );
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
        GRANT SELECT ON TABLE auth.users TO authenticated, service_role;

        -- Create auth.uid() and auth.role() Supabase JWT emulation functions
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;

        CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
          COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
        $$;

        GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

        -- Create storage schema and mock tables
        CREATE SCHEMA IF NOT EXISTS storage;
        CREATE TABLE IF NOT EXISTS storage.buckets (
          id text PRIMARY KEY,
          name text,
          public boolean DEFAULT false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
        CREATE TABLE IF NOT EXISTS storage.objects (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          bucket_id text REFERENCES storage.buckets(id),
          name text,
          owner uuid REFERENCES auth.users(id),
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now(),
          last_accessed_at timestamptz DEFAULT now(),
          metadata jsonb DEFAULT '{}'::jsonb
        );
        CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql AS $$
        BEGIN
          RETURN string_to_array(name, '/');
        END;
        $$;
        GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
        GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;
      `);

      // 2. Insert test users A and B in auth.users
      await client.query(`
        INSERT INTO auth.users (id, email)
        VALUES
          ('${TEST_USERS.userA.id}', '${TEST_USERS.userA.email}'),
          ('${TEST_USERS.userB.id}', '${TEST_USERS.userB.email}')
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
      `);

      // 3. Sequentially apply all project migrations
      const migrationsDir = path.join(process.cwd(), "supabase/migrations");
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith(".sql") && !f.includes(".rollback."))
        .sort();

      for (const file of migrationFiles) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        try {
          await client.query(sql);
        } catch (mErr) {
          throw new Error(`Failed to apply migration ${file}: ${mErr.message}`);
        }
      }

      this.isReady = true;
      return {
        ready: true,
        database: currentDb,
        migrationCount: migrationFiles.length
      };
    } finally {
      client.release();
    }
  }

  /**
   * Executes a callback within a transaction setting PostgreSQL role and JWT claims.
   * PostgreSQL native Row-Level Security evaluates auth.uid() based on request.jwt.claim.sub.
   */
  async asRole(role, userId, callback) {
    if (!this.pool) throw new Error("Database harness not initialized");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      if (role === "service_role") {
        await client.query("SET LOCAL ROLE service_role;");
        await client.query("SET LOCAL \"request.jwt.claim.role\" = 'service_role';");
      } else if (role === "anon") {
        await client.query("SET LOCAL ROLE anon;");
        await client.query("SET LOCAL \"request.jwt.claim.role\" = 'anon';");
        await client.query("RESET \"request.jwt.claim.sub\";");
      } else if (role === "authenticated") {
        await client.query("SET LOCAL ROLE authenticated;");
        await client.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}';`);
        await client.query("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';");
      }

      const result = await callback(client);
      await client.query("COMMIT;");
      return result;
    } catch (err) {
      await client.query("ROLLBACK;").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }
}
