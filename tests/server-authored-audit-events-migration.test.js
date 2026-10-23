import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261023180000_server_authored_audit_events.sql", import.meta.url);

test("audit events cannot be forged or mutated by browser roles", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /drop policy if exists audit_insert_own on public\.audit_events/i);
  assert.match(sql, /revoke insert, update, delete, truncate, trigger\s+on table public\.audit_events from anon, authenticated/i);
});

test("audit event hardening preserves service-role writes and user-owned reads", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(sql, /revoke\s+.*from\s+service_role/i);
  assert.doesNotMatch(sql, /drop policy if exists audit_select_own/i);
  assert.doesNotMatch(sql, /drop policy if exists audit_insert_own[^;]*service_role/i);
});
