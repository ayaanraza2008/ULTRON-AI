import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261025190000_desktop_action_queue.sql", import.meta.url));

test("desktop action migration makes browser access read-only and owner-scoped", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /alter table public\.desktop_actions enable row level security/i);
  assert.match(sql, /for select to authenticated using \(user_id = auth\.uid\(\)\)/i);
  assert.match(sql, /revoke all on table public\.desktop_actions from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.desktop_actions to authenticated/i);
  assert.match(sql, /grant all on table public\.desktop_actions to service_role/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|all) on table public\.desktop_actions to authenticated/i);
});

test("atomic action claim is owner/device scoped and requires approval before execution", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /ultron_claim_next_desktop_action\(p_user_id uuid, p_device_id text\)/i);
  assert.match(sql, /where user_id = p_user_id\s+and device_id = p_device_id\s+and status = 'QUEUED'/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /not requires_approval or approved_at is not null/i);
  assert.match(sql, /revoke all on function public\.ultron_claim_next_desktop_action\(uuid, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.ultron_claim_next_desktop_action\(uuid, text\) to service_role/i);
});

test("desktop action schema only permits the initial safe action types and terminal states need timestamps", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /action_type in \('system_info', 'launch_app'\)/i);
  assert.match(sql, /status not in \('COMPLETED', 'FAILED', 'CANCELLED'\) or finished_at is not null/i);
  assert.match(sql, /status <> 'QUEUED' or not requires_approval or approved_at is not null/i);
});
