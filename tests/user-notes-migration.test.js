import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261029160000_user_notes.sql", import.meta.url));

test("user-notes migration limits access to the authenticated owner and bounds note data", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.user_notes/i);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /char_length\(title\) between 1 and 200/i);
  assert.match(sql, /char_length\(body\) between 1 and 30000/i);
  assert.match(sql, /cardinality\(tags\) <= 20/i);
  assert.match(sql, /alter table public\.user_notes enable row level security/i);
  assert.match(sql, /create policy user_notes_select_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy user_notes_insert_own[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy user_notes_update_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy user_notes_delete_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /revoke all on table public\.user_notes from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.user_notes to authenticated/i);
  assert.match(sql, /execute function public\.ultron_set_updated_at\(\)/i);
});
