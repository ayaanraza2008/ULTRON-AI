import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261028160000_desktop_action_bridge.sql", import.meta.url), "utf8");

test("desktop action migration defaults all new actions to explicit approval", () => {
  assert.match(migration, /create table if not exists public\.desktop_actions/i);
  assert.match(migration, /status text not null default 'PENDING_APPROVAL'/i);
  assert.match(migration, /check \(action_type in \('open_url', 'launch_app', 'system_info'\)\)/i);
  assert.match(migration, /revoke all on table public\.desktop_actions from public, anon, authenticated/i);
  assert.match(migration, /grant all on table public\.desktop_actions to service_role/i);
  assert.match(migration, /alter table public\.desktop_actions enable row level security/i);
});

test("desktop action state transitions require approval and reject terminal-state mutation", () => {
  assert.match(migration, /create or replace function public\.ultron_guard_desktop_action_transition/i);
  assert.match(migration, /old\.status = 'PENDING_APPROVAL' and new\.status not in \('QUEUED', 'CANCELLED'\)/i);
  assert.match(migration, /old\.status in \('COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED'\)/i);
  assert.match(migration, /desktop_actions_guard_transition/i);
  assert.match(migration, /set search_path = ''/i);
});

test("desktop action claim RPC is service-role only and caps retries with a lease", () => {
  assert.match(migration, /create or replace function public\.ultron_claim_next_desktop_action\(p_user_id uuid\)/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /lease_expires_at = now\(\) \+ interval '90 seconds'/i);
  assert.match(migration, /attempts < 3/i);
  assert.match(migration, /revoke all on function public\.ultron_claim_next_desktop_action\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ultron_claim_next_desktop_action\(uuid\) to service_role/i);
});

test("desktop action audit entries are written by a database trigger", () => {
  assert.match(migration, /create or replace function public\.ultron_audit_desktop_action_changes/i);
  assert.match(migration, /insert into public\.audit_events/i);
  assert.match(migration, /after insert or update on public\.desktop_actions/i);
});
