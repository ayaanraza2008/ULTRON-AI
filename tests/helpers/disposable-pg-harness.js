/**
 * ULTRON AI — Disposable Real PostgreSQL & Supabase RLS Test Harness
 * Module: tests/helpers/disposable-pg-harness.js
 *
 * Connects to a real PostgreSQL database (e.g. Docker container or CI service container),
 * initializes Supabase auth/storage schemas, roles, and functions, and applies all
 * project migrations sequentially to test genuine PostgreSQL Row-Level Security (RLS).
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

export class DisposablePgHarness {
  constructor(options = {}) {
    this.options = options;
    this.pool = null;
    this.isReady = false;
  }

  getPoolConfig() {
    if (this.options.connectionString) {
      return { connectionString: this.options.connectionString };
    }
    if (process.env.DATABASE_URL) {
      return { connectionString: process.env.DATABASE_URL };
    }
    if (process.env.POSTGRES_URL) {
      return { connectionString: process.env.POSTGRES_URL };
    }
    if (process.env.ULTRON_TEST_DATABASE_URL) {
      return { connectionString: process.env.ULTRON_TEST_DATABASE_URL };
    }
    if (process.env.PGHOST) {
      return {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "",
        database: process.env.PGDATABASE || "ultron_disposable_test"
      };
    }
    return null;
  }

  async checkAvailability() {
    if (!pgModule || !pgModule.Pool) {
      return { available: false, reason: "pg driver (node-postgres) is not installed." };
    }

    const config = this.getPoolConfig();
    if (!config) {
      return { available: false, reason: "No PostgreSQL connection configuration found (PGHOST or DATABASE_URL not set)." };
    }

    const probePool = new pgModule.Pool({
      ...config,
      connectionTimeoutMillis: 2000
    });

    try {
      const client = await probePool.connect();
      await client.query("SELECT 1;");
      client.release();
      await probePool.end();
      return { available: true };
    } catch (err) {
      await probePool.end().catch(() => {});
      return {
        available: false,
        reason: `Real PostgreSQL database is not reachable: ${err.message}`
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
      return { ready: true, migrationCount: migrationFiles.length };
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
