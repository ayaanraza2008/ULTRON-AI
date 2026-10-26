import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261023140000_guard_agent_task_client_updates.sql", import.meta.url);

test("agent task client-update guard permits cancellation only and protects worker-owned fields", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /auth\.role\(\)\s*=\s*'authenticated'/);
  assert.match(sql, /old\.status\s+not\s+in\s*\('QUEUED',\s*'RUNNING',\s*'WAITING_FOR_PERMISSION'\)/);
  assert.match(sql, /new\.status\s*<>\s*'CANCELLED'/);
  assert.match(sql, /to_jsonb\(new\)\s*-\s*'status'\s*-\s*'updated_at'\)\s+is\s+distinct\s+from\s+\(to_jsonb\(old\)\s*-\s*'status'\s*-\s*'updated_at'\)/);
  assert.match(sql, /before update on public\.agent_tasks/i);
  assert.match(sql, /revoke all on function public\.ultron_guard_agent_task_client_updates\(\) from public/i);
});

test("task update guard does not revoke service-role worker transitions", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /if auth\.role\(\) = 'authenticated' then/i);
  assert.doesNotMatch(sql, /revoke\s+(?:update|all)\s+on\s+public\.agent_tasks/i);
});
