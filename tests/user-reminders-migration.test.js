import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261029170000_user_reminders.sql", import.meta.url));

test("user-reminders migration enables owner-only RLS and bounded reminder fields", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.user_reminders/i);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /char_length\(title\) between 1 and 200/i);
  assert.match(sql, /char_length\(body\) <= 2000/i);
  assert.match(sql, /due_at timestamptz not null/i);
  assert.match(sql, /status in \('scheduled', 'completed', 'cancelled'\)/i);
  assert.match(sql, /alter table public\.user_reminders enable row level security/i);
  assert.match(sql, /create policy user_reminders_select_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy user_reminders_insert_own[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy user_reminders_update_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy user_reminders_delete_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /revoke all on table public\.user_reminders from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.user_reminders to authenticated/i);
  assert.match(sql, /execute function public\.ultron_set_updated_at\(\)/i);
});
