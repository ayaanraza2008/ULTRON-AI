# Supabase migration history and release gate

Last read-only comparison: 2026-11-05. Project: `opdjfhwepmcprbqojpat` (Mumbai).

## Applied remote ledger baseline

The live Supabase migration ledger reports these 15 applied versions:

- `20261021183847_initial_schema`
- `20261021183915_secure_function_search_path`
- `20261021184829_touch_conversation_on_message`
- `20261022155928_ai_employee_scheduler`
- `20261023084934_optimize_rls_policy_auth_uid`
- `20261023094332_durable_task_retry_backoff`
- `20261023103950_recover_stale_running_tasks`
- `20261023105015_autonomous_scheduled_employee_reports`
- `20261023205345_guard_agent_task_client_updates`
- `20261023205348_revoke_browser_bypass_table_privileges`
- `20261023205350_harden_worker_rpc_search_path`
- `20261023205352_server_authored_audit_events`
- `20261024085626_revoke_anon_public_table_privileges`
- `20261024142725_scope_stale_task_recovery`
- `20261027185203_private_document_storage`

The active migration filenames are aligned to those exact remote versions. The historical `202610220001_task_worker.sql` scaffold is retained under `supabase/legacy-migrations/` because the remote ledger does not contain that version and its worker functionality is superseded by the later applied retry/recovery migrations.

## Pending additive migrations in source

These are present in the repository but were not present in the live migration ledger during the audit:

- `20261101180000_durable_paired_devices.sql`
- `20261104110000_paired_device_telemetry.sql`

The live database also did not contain `public.paired_devices` or `public.pending_device_pairings`. Device pairing therefore remains unavailable until these migrations are separately reviewed and applied as part of an authorized release. The telemetry migration depends on the paired-device migration and must remain later in version order.

The active migration directory should currently contain exactly 17 forward SQL files: the 15 applied baseline files plus the two pending device files. The ledger regression test locks this distinction and rejects any duplicate or out-of-order version.

## Rollback handling

Destructive rollback scripts are stored under `supabase/rollback/`, outside the active `supabase/migrations/` directory. They must never be discovered as forward migrations by the Supabase CLI. Rollbacks can delete paired-device records and must not be run against production without a verified backup and explicit owner approval.

## Safety and verification

- This audit and the repository correction do not execute SQL.
- No production schema, records, users, or credentials were changed.
- Compare the live ledger before every database release.
- Apply the two pending device migrations only after release approval, service-role configuration checks, and a rollback/backup review.
