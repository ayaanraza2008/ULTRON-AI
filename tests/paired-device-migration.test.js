import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(process.cwd(), "supabase/migrations/20261101180000_durable_paired_devices.sql");
const rollbackPath = path.join(process.cwd(), "supabase/migrations/20261101180000_durable_paired_devices.rollback.sql");

test("paired-device SECURITY DEFINER RPC uses an empty search_path", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i);
});

test("paired-device RPC execution is restricted to service_role", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.claim_pending_device_pairing\(text\)\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.claim_pending_device_pairing\(text\)\s+to\s+service_role/i);
});

test("paired-device rollback is explicitly destructive and avoids CASCADE", () => {
  const sql = fs.readFileSync(rollbackPath, "utf8");
  assert.match(sql, /DESTRUCTIVE ROLLBACK/i);
  assert.match(sql, /permanently deletes paired-device metadata/i);
  assert.doesNotMatch(sql, /drop\s+table[^;]*cascade/i);
});
