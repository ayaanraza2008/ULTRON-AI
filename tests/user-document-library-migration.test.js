import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261026110000_user_document_library.sql", import.meta.url), "utf8");

test("saved-document table is owner-scoped and stores extracted text with strict bounds", () => {
  assert.match(migration, /create table if not exists public\.user_documents/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
  assert.match(migration, /character_count between 1 and 100000/i);
  assert.match(migration, /char_length\(extracted_text\) between 1 and 100000/i);
  assert.match(migration, /content_sha256 text not null check \(content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
  assert.match(migration, /generated always as/i);
  assert.match(migration, /using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /revoke all on table public\.user_documents from public, anon/i);
  assert.match(migration, /grant select, insert, delete on table public\.user_documents to authenticated/i);
});

test("document search uses caller RLS, a query limit, and a non-definer function", () => {
  assert.match(migration, /create or replace function public\.ultron_search_user_documents\(p_query text, p_limit integer default 5\)/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /if auth\.uid\(\) is null then/i);
  assert.match(migration, /greatest\(1, least\(coalesce\(p_limit, 5\), 10\)\)/i);
  assert.match(migration, /document\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /document\.search_vector @@ search_query/i);
  assert.match(migration, /revoke all on function public\.ultron_search_user_documents\(text, integer\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.ultron_search_user_documents\(text, integer\) to authenticated/i);
});
