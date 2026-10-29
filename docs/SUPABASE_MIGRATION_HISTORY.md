# Supabase migration ledger reconciliation

Read-only inspection of project `opdjfhwepmcprbqojpat` on 2026-10-29 showed these 15 remote migration versions:

- `20261021183847_initial_schema.sql`
- `20261021183915_secure_function_search_path.sql`
- `20261021184829_touch_conversation_on_message.sql`
- `20261022155928_ai_employee_scheduler.sql`
- `20261023084934_optimize_rls_policy_auth_uid.sql`
- `20261023094332_durable_task_retry_backoff.sql`
- `20261023103950_recover_stale_running_tasks.sql`
- `20261023105015_autonomous_scheduled_employee_reports.sql`
- `20261023205345_guard_agent_task_client_updates.sql`
- `20261023205348_revoke_browser_bypass_table_privileges.sql`
- `20261023205350_harden_worker_rpc_search_path.sql`
- `20261023205352_server_authored_audit_events.sql`
- `20261024085626_revoke_anon_public_table_privileges.sql`
- `20261024142725_scope_stale_task_recovery.sql`
- `20261027185203_private_document_storage.sql`

The active migration filenames previously had duplicate/mismatched version IDs. The old `202610220001_task_worker.sql` scaffold was not present in the remote ledger and shared its prefix with a different migration; it is moved outside `supabase/migrations/` and explicitly marked archived. The current active chain defines the attempts column, retry/recovery behavior and hardened worker RPC.

This branch renames source files and adds a regression test only; it does not execute SQL, mutate the database or apply a migration. Compare the live migration list before every future schema push.
