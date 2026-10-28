import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsUrl).filter(name => name.endsWith(".sql")).sort();

test("every local Supabase migration has a unique 14-digit version prefix", () => {
  const versions = migrationFiles.map(file => {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
    assert.ok(match, file + " must use a 14-digit timestamp and snake_case name");
    return match[1];
  });
  assert.equal(new Set(versions).size, versions.length, "duplicate migration version prefix detected");
});

test("the legacy task-worker migration remains explicitly named in the history-alignment audit", async () => {
  assert.ok(migrationFiles.includes("20261022000100_task_worker.sql"));
});
