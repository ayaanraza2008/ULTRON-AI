import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL("../supabase/migrations/20261026190000_revoke_unused_authenticated_privileges.sql", import.meta.url)
);

test("migration revokes unused authenticated message-update and preference-delete grants", async () => {
  const sql = (await readFile(migrationPath, "utf8")).replace(/\s+/g, " ").toLowerCase();
  assert.match(sql, /revoke update on table public[.]messages from authenticated/);
  assert.match(sql, /revoke delete on table public[.]user_preferences from authenticated/);
});
