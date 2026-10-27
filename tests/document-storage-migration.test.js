import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261027181000_private_document_storage.sql", import.meta.url), "utf8");

test("document storage migration creates a size-limited private bucket and owner policies", () => {
  assert.match(migration, /create table if not exists public\.documents/i);
  assert.match(migration, /alter table public\.documents enable row level security/i);
  assert.match(migration, /grant select, insert, delete on table public\.documents to authenticated/i);
  assert.match(migration, /'ultron-private-documents',[\s\S]*?false,[\s\S]*?5242880/i);
  assert.match(migration, /ultron_private_documents_select_own[\s\S]*?for select to authenticated/i);
  assert.match(migration, /ultron_private_documents_insert_own[\s\S]*?for insert to authenticated/i);
  assert.match(migration, /ultron_private_documents_delete_own[\s\S]*?for delete to authenticated/i);
  assert.match(migration, /storage\.foldername\(name\).*auth\.uid\(\)/s);
  assert.match(migration, /sha256 text not null check/i);
  assert.match(migration, /storage_path text not null unique check/i);
  assert.doesNotMatch(migration, /values\s*\([^)]*'ultron-private-documents'[^)]*true/s);
});

test("document storage migration grants no update access and uses only allowed MIME types", () => {
  assert.match(migration, /revoke all on table public\.documents from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant .*update .*public\.documents/i);
  for (const mime of ["text/plain", "text/markdown", "text/csv", "application/json", "text/html", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
    assert.ok(migration.includes("'" + mime + "'"), "Missing allowed MIME: " + mime);
  }
  assert.match(migration, /name ~\* \([\s\S]*?auth\.uid\(\)[\s\S]*?\\\./);
});
