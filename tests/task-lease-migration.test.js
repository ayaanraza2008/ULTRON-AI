import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261023180000_recover_stale_task_leases.sql", import.meta.url);

test("task-claim migration recovers expired leases and enforces the retry budget", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /task\.status = 'RUNNING'/);
  assert.match(sql, /task\.started_at < now\(\) - interval '5 minutes'/);
  assert.match(sql, /case when task\.attempts < 3 then 'QUEUED' else 'FAILED' end/);
  assert.match(sql, /and candidate\.attempts < 3/);
  assert.match(sql, /candidate\.input->>'executionMode' in \('allowlisted_worker', 'employee_worker'\)/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /revoke all on function public\.ultron_claim_next_task\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.ultron_claim_next_task\(\) to service_role/i);
});
