import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const rollbackDirectory = fileURLToPath(new URL("../supabase/rollback/", import.meta.url));
const legacyWorkerScaffold = fileURLToPath(new URL("../supabase/legacy-migrations/202610220001_task_worker.sql", import.meta.url));

const expectedRemoteLedger = [
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

test("active migration files preserve every version already recorded by the remote ledger", () => {
  const active = readdirSync(migrationDirectory).filter(name => name.endsWith(".sql")).sort();
  for (const name of expectedRemoteLedger) {
    assert.ok(active.includes(name), "Missing applied migration filename: " + name);
  }
});

test("new active migrations are unique, ordered after the remote baseline, and not rollback scripts", () => {
  const active = readdirSync(migrationDirectory).filter(name => name.endsWith(".sql")).sort();
  const additions = active.filter(name => !expectedRemoteLedger.includes(name));
  const latestRemoteVersion = expectedRemoteLedger.map(name => name.slice(0, 14)).sort().at(-1);
  assert.deepEqual(additions, [
    "20261101180000_durable_paired_devices.sql",
    "20261104110000_paired_device_telemetry.sql",
    "20261106120000_ultron_multidevice_state.sql"
  ]);
  const versions = active.map(name => name.slice(0, 14));
  assert.ok(versions.every(version => /^[0-9]{14}$/.test(version)), "Every active migration must use a 14-digit version");
  assert.equal(new Set(versions).size, versions.length, "Active migration version identifiers must be unique");
  assert.ok(additions.every(name => name.slice(0, 14) > latestRemoteVersion), "New migrations must sort after the applied remote baseline");
  assert.ok(active.every(name => !name.endsWith(".rollback.sql")), "Rollback SQL must never be inside Supabase's active migration directory");
  assert.ok(!active.includes("202610220001_task_worker.sql"), "The obsolete worker scaffold must not be active");
});

test("destructive rollback scripts and obsolete worker scaffold are kept outside active migrations", () => {
  assert.deepEqual(
    readdirSync(rollbackDirectory).filter(name => name.endsWith(".rollback.sql")).sort(),
    [
      "20261101180000_durable_paired_devices.rollback.sql",
      "20261104110000_paired_device_telemetry.rollback.sql"
    ]
  );
  assert.ok(existsSync(legacyWorkerScaffold), "Keep the historical worker scaffold archived for auditability");
});

test("multi-device REST state migration is private to the server role", () => {
  const migrationPath = fileURLToPath(new URL("../supabase/migrations/20261106120000_ultron_multidevice_state.sql", import.meta.url));
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();
  assert.match(sql, /create table if not exists public\.ultron_multidevice_state/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.ultron_multidevice_state from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.ultron_multidevice_state to service_role/);
});
