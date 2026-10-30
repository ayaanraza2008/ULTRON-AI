import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261031160000_desktop_companion_approved_actions.sql", import.meta.url));
const sql = readFileSync(migrationPath, "utf8");

test("approved desktop action queue is owner-scoped and exposes no device credentials", () => {
  assert.match(sql, /create table if not exists public\.desktop_companion_commands/i);
  assert.match(sql, /alter table public\.desktop_companion_commands enable row level security/i);
  assert.match(sql, /using \(auth\.uid\(\) = user_id\)/i);
  assert.match(sql, /revoke all on table public\.desktop_companion_commands from public, anon, authenticated/i);
  const grantStart = sql.indexOf("grant select (");
  const grantEnd = sql.indexOf(") on table public.desktop_companion_commands to authenticated", grantStart);
  assert.ok(grantStart >= 0 && grantEnd > grantStart, "the browser read grant must be column-scoped");
  assert.doesNotMatch(sql.slice(grantStart, grantEnd), /token_hash|user_id/i);
  assert.match(sql, /action_type in \('launch_application', 'open_known_folder'\)/i);
  assert.match(sql, /target in \('notepad', 'explorer', 'calculator'\)/i);
  assert.match(sql, /target in \('desktop', 'documents', 'downloads'\)/i);
  assert.match(sql, /expires_at <= created_at \+ interval '90 seconds'/i);
  assert.match(sql, /grant select \([\s\S]*?result_code[\s\S]*?\) on table public\.desktop_companion_commands to authenticated/i);
});

test("action creation requires the signed-in owner and a recently online, unrevoked device", () => {
  const match = sql.match(/create or replace function public\.create_desktop_companion_command\(([\s\S]*?)\$function\$/i);
  assert.ok(match, "create_desktop_companion_command must exist");
  assert.match(match[1], /security definer/i);
  assert.match(match[1], /set search_path = ''/i);
  assert.match(match[1], /auth\.uid\(\)/i);
  assert.match(match[1], /d\.user_id = v_user_id/i);
  assert.match(match[1], /d\.revoked_at is null/i);
  assert.match(match[1], /d\.last_seen_at >= pg_catalog\.now\(\) - interval '90 seconds'/i);
  assert.match(match[1], /at most one|one outstanding/i);
  assert.match(match[1], /v_expires_at := pg_catalog\.now\(\) \+ interval '60 seconds'/i);
  assert.match(sql, /grant execute on function public\.create_desktop_companion_command\(uuid, text, text\)\s+to authenticated/i);
});

test("device command claiming and result reporting are token-bound, one-time, and state-checked", () => {
  const claim = sql.match(/create or replace function public\.claim_desktop_companion_command\(([\s\S]*?)\$function\$/i);
  assert.ok(claim, "claim_desktop_companion_command must exist");
  assert.match(claim[1], /security definer/i);
  assert.match(claim[1], /set search_path = ''/i);
  assert.match(claim[1], /d\.token_hash = p_token_hash/i);
  assert.match(claim[1], /d\.device_id = p_device_id/i);
  assert.match(claim[1], /d\.revoked_at is null/i);
  assert.match(claim[1], /c\.status = 'pending'/i);
  assert.match(claim[1], /for update of c skip locked/i);
  assert.match(claim[1], /set status = 'delivered'/i);
  assert.match(sql, /grant execute on function public\.claim_desktop_companion_command\(text, uuid\)\s+to service_role/i);

  const complete = sql.match(/create or replace function public\.complete_desktop_companion_command\(([\s\S]*?)\$function\$/i);
  assert.ok(complete, "complete_desktop_companion_command must exist");
  assert.match(complete[1], /security definer/i);
  assert.match(complete[1], /set search_path = ''/i);
  assert.match(complete[1], /d\.token_hash = p_token_hash/i);
  assert.match(complete[1], /d\.device_id = p_device_id/i);
  assert.match(complete[1], /d\.revoked_at is null/i);
  assert.match(complete[1], /c\.status = 'delivered'/i);
  assert.match(complete[1], /c\.expires_at > pg_catalog\.now\(\)/i);
  assert.match(complete[1], /p_status not in \('completed', 'rejected', 'failed'\)/i);
  assert.match(sql, /grant execute on function public\.complete_desktop_companion_command\(text, uuid, uuid, text, text\)\s+to service_role/i);
});
