import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261023205348_revoke_browser_bypass_table_privileges.sql", import.meta.url);

test("browser-facing roles cannot TRUNCATE or create triggers on public application tables", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /revoke\s+truncate\s*,\s*trigger\s+on\s+table/i);
  for (const table of ["agent_tasks", "audit_events", "conversations", "employee_schedules", "memory_items", "messages", "user_preferences"]) {
    assert.match(sql, new RegExp("public\\." + table + "\\b"));
  }
  assert.match(sql, /from\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /alter default privileges for role postgres in schema public/i);
  assert.match(sql, /revoke truncate\s*,\s*trigger on tables from anon, authenticated/i);
});

test("privilege hardening leaves service-role grants untouched", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(sql, /revoke[^;]+from[^;]*service_role/i);
  assert.match(sql, /RLS is still required/i);
});
