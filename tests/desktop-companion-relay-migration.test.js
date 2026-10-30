import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261030210000_desktop_companion_relay.sql", import.meta.url));
const sql = readFileSync(migrationPath, "utf8");

test("desktop companion relay migration uses owner-scoped RLS and hides token hashes", () => {
  assert.match(sql, /create table if not exists public\.desktop_companion_pairings/i);
  assert.match(sql, /create table if not exists public\.desktop_companion_devices/i);
  assert.match(sql, /alter table public\.desktop_companion_pairings enable row level security/i);
  assert.match(sql, /alter table public\.desktop_companion_devices enable row level security/i);
  assert.match(sql, /with check \(auth\.uid\(\) = user_id\)/i);
  assert.match(sql, /using \(auth\.uid\(\) = user_id\)/i);
  assert.match(sql, /revoke all on table public\.desktop_companion_devices from public, anon, authenticated/i);
  assert.match(sql, /grant select \([\s\S]*?revoked_at[\s\S]*?\) on table public\.desktop_companion_devices to authenticated/i);
  const selectGrantStart = sql.indexOf("grant select (");
  const selectGrantEnd = sql.indexOf(") on table public.desktop_companion_devices to authenticated", selectGrantStart);
  assert.ok(selectGrantStart >= 0 && selectGrantEnd > selectGrantStart, "authenticated device inventory grant must be column-scoped");
  assert.doesNotMatch(sql.slice(selectGrantStart, selectGrantEnd), /token_hash/i);
});

test("desktop companion relay functions are atomic, search-path hardened, and narrowly granted", () => {
  for (const name of [
    "complete_desktop_companion_pairing",
    "record_desktop_companion_heartbeat",
    "revoke_desktop_companion_device"
  ]) {
    const match = sql.match(new RegExp("create or replace function public\\." + name + "([\\s\\S]*?)\\$function\\$", "i"));
    assert.ok(match, name + " must exist");
    assert.match(match[1], /security definer/i, name + " must be SECURITY DEFINER");
    assert.match(match[1], /set search_path = ''/i, name + " must pin an empty search_path");
  }
  assert.ok(sql.includes("check (expires_at > created_at and expires_at <= created_at + interval '5 minutes')"));
  assert.match(sql, /and consumed_at is null\s+and expires_at > pg_catalog\.now\(\)/i);
  assert.match(sql, /update public\.desktop_companion_pairings\s+set consumed_at/i);
  assert.match(sql, /where token_hash = p_token_hash\s+and device_id = p_device_id\s+and revoked_at is null/i);
  assert.match(sql, /and user_id = auth\.uid\(\)\s+and revoked_at is null/i);
  assert.match(sql, /grant execute on function public\.complete_desktop_companion_pairing[\s\S]*?to service_role/i);
  assert.match(sql, /grant execute on function public\.record_desktop_companion_heartbeat[\s\S]*?to service_role/i);
  assert.match(sql, /grant execute on function public\.revoke_desktop_companion_device\(uuid\)\s+to authenticated/i);
  const completionGrantStart = sql.indexOf("grant execute on function public.complete_desktop_companion_pairing(");
  const completionGrant = sql.slice(completionGrantStart).split(";")[0].replace(/\s+/g, " ").trim();
  assert.equal(completionGrant, "grant execute on function public.complete_desktop_companion_pairing(text, uuid, text, text) to service_role");
  assert.match(completionGrant, / to service_role$/);
});

const actionsMigrationPath = fileURLToPath(new URL("../supabase/migrations/20261031200000_desktop_companion_local_approved_actions.sql", import.meta.url));
const actionsSql = readFileSync(actionsMigrationPath, "utf8");

test("companion actions migration permits only fixed locally approved application and folder shortcuts", () => {
  assert.match(actionsSql, /create table if not exists public\.desktop_companion_actions/i);
  assert.match(actionsSql, /action_name in \('launch_application', 'open_known_folder'\)/i);
  assert.match(actionsSql, /action_target in \('notepad', 'explorer', 'calculator'\)/i);
  assert.match(actionsSql, /action_target in \('desktop', 'documents', 'downloads'\)/i);
  assert.match(actionsSql, /expires_at <= created_at \+ interval '2 minutes'/i);
  assert.match(actionsSql, /where status in \('pending', 'claimed'\)/i);
  assert.match(actionsSql, /for insert to authenticated[\s\S]*?auth\.uid\(\) = user_id/i);
  assert.match(actionsSql, /d\.last_seen_at >= pg_catalog\.now\(\) - interval '90 seconds'/i);
  assert.match(actionsSql, /alter table public\.desktop_companion_actions enable row level security/i);
  assert.match(actionsSql, /revoke all on table public\.desktop_companion_actions from public, anon, authenticated/i);
  assert.match(actionsSql, /grant execute on function public\.claim_desktop_companion_action\(text, uuid\)\s+to service_role/i);
  assert.match(actionsSql, /grant execute on function public\.complete_desktop_companion_action\(text, uuid, uuid, text, text\)\s+to service_role/i);
  assert.doesNotMatch(actionsSql, /command_text|shell_command|file_path|powershell|screenshot/i);
});

test("companion action SQL functions pin search_path and bind claims/completion to the paired device", () => {
  for (const name of ["claim_desktop_companion_action", "complete_desktop_companion_action"]) {
    const match = actionsSql.match(new RegExp("create or replace function public\\." + name + "([\\s\\S]*?)\\$function\\$", "i"));
    assert.ok(match, name + " must exist");
    assert.match(match[1], /security definer/i);
    assert.match(match[1], /set search_path = ''/i);
    assert.match(match[1], /token_hash = p_token_hash/i);
    assert.match(match[1], /device_id = p_device_id/i);
  }
  assert.match(actionsSql, /for update skip locked/i);
  assert.match(actionsSql, /a\.status = 'claimed'/i);
  assert.match(actionsSql, /p_status = 'denied' and p_result_code in \('USER_DENIED', 'LOCAL_APPROVAL_REQUIRED'\)/i);
});
