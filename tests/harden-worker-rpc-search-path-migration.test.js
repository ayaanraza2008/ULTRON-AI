import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261023205350_harden_worker_rpc_search_path.sql", import.meta.url);

test("SECURITY DEFINER worker RPCs use an empty search_path", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /alter function public\.ultron_claim_due_employee_schedule\(\) set search_path\s*=\s*''/i);
  assert.match(sql, /alter function public\.ultron_claim_next_task\(\) set search_path\s*=\s*''/i);
  assert.equal((sql.match(/alter function public\.ultron_/gi) || []).length, 2);
});

test("worker RPC hardening is scoped to function configuration only", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(sql, /drop function|revoke|grant|drop table|truncate/i);
});
