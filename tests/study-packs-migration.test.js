import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261029154500_study_packs.sql", import.meta.url));

test("study-pack migration enforces per-user RLS, bounded content and timestamps", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.study_packs/i);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /jsonb_typeof\(content\) = 'object'/i);
  assert.match(sql, /pg_column_size\(content\) <= 60000/i);
  assert.match(sql, /alter table public\.study_packs enable row level security/i);
  assert.match(sql, /create policy study_packs_select_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy study_packs_insert_own[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy study_packs_update_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /create policy study_packs_delete_own[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /revoke all on table public\.study_packs from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.study_packs to authenticated/i);
  assert.match(sql, /execute function public\.ultron_set_updated_at\(\)/i);
});
