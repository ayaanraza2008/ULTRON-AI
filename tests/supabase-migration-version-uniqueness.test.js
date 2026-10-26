import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

const expectedMigrationFiles = [
  "20261021183847_initial_schema.sql",
  "20261021183915_secure_function_search_path.sql",
  "20261021184829_touch_conversation_on_message.sql",
  "20261022155928_ai_employee_scheduler.sql",
  "20261023084934_optimize_rls_policy_auth_uid.sql",
  "20261023094332_durable_task_retry_backoff.sql",
  "20261023103950_recover_stale_running_tasks.sql",
  "20261023105015_autonomous_scheduled_employee_reports.sql",
  "20261023205345_guard_agent_task_client_updates.sql",
  "20261023205348_revoke_browser_bypass_table_privileges.sql",
  "20261023205350_harden_worker_rpc_search_path.sql",
  "20261023205352_server_authored_audit_events.sql",
  "20261024085626_revoke_anon_public_table_privileges.sql",
  "20261024142725_scope_stale_task_recovery.sql",
  "20261026100000_desktop_action_bridge.sql",
  "20261026110000_user_document_library.sql"
];

test("Supabase migration filenames have valid, unique version prefixes", async () => {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(files.length > 0, "At least one SQL migration must exist");

  const seenVersions = new Map();
  for (const filename of files) {
    const match = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/i.exec(filename);
    assert.ok(match, `Invalid Supabase migration filename: ${filename}`);

    const version = match[1];
    const previous = seenVersions.get(version);
    assert.equal(
      previous,
      undefined,
      `Duplicate Supabase migration version "${version}" in ${previous} and ${filename}`
    );
    seenVersions.set(version, filename);
  }
});

test("local migrations match live Supabase history plus the two reviewed pending migrations", async () => {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(files, [...expectedMigrationFiles].sort());
});
