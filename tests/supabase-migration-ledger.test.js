import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const expected = [
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
  "20261027185203_private_document_storage.sql"
];

test("active Supabase migration filenames are unique and match the audited remote ledger", () => {
  const actual = readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
  assert.deepEqual(actual, expected);
  const versions = actual.map(name => name.slice(0, 14));
  assert.ok(versions.every(version => /^[0-9]{14}$/.test(version)), "each active migration must start with a 14-digit version");
  assert.equal(new Set(versions).size, versions.length, "migration version identifiers must be unique");
});
