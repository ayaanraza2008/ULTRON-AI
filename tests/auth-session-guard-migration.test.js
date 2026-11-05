import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261027100000_ultron_is_current_auth_session_active.sql", import.meta.url),
  "utf8"
);

test("current-session guard only checks the caller's JWT session and is authenticated-only", () => {
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.ultron_is_current_session_active\s*\(\)/i);
  assert.match(migration, /security\s+definer/i);
  assert.match(migration, /set\s+search_path\s*=\s*''/i);
  assert.match(migration, /auth\.jwt\(\)\s*->>\s*'session_id'/i);
  assert.match(migration, /auth\.sessions\s+as\s+s/i);
  assert.match(migration, /s\.user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.ultron_is_current_session_active\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.ultron_is_current_session_active\(\)\s+to\s+authenticated/i);
  assert.doesNotMatch(migration, /grant\s+execute\s+on\s+function\s+public\.ultron_is_current_session_active\(\)\s+to\s+(?:anon|public)\b/i);
});
