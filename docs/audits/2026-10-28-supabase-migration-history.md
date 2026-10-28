# Supabase Migration History Alignment — 2026-10-28

## Why this is a release blocker

Read-only inspection of the only connected Supabase project (`opdjfhwepmcprbqojpat`) showed that the remote migration ledger records versions that differ from the timestamp prefixes of several files on the then-current `main` branch. Applying repository migrations before reconciling this mismatch could cause already-applied schema work to be treated as pending.

The remote ledger reported these applied versions:

| Remote version | Migration |
|---|---|
| 20261021183847 | initial_schema |
| 20261021183915 | secure_function_search_path |
| 20261021184829 | touch_conversation_on_message |
| 20261022155928 | ai_employee_scheduler |
| 20261023084934 | optimize_rls_policy_auth_uid |
| 20261023094332 | durable_task_retry_backoff |
| 20261023103950 | recover_stale_running_tasks |
| 20261023105015 | autonomous_scheduled_employee_reports |
| 20261023205345 | guard_agent_task_client_updates |
| 20261023205348 | revoke_browser_bypass_table_privileges |
| 20261023205350 | harden_worker_rpc_search_path |
| 20261023205352 | server_authored_audit_events |
| 20261024085626 | revoke_anon_public_table_privileges |
| 20261024142725 | scope_stale_task_recovery |
| 20261027185203 | private_document_storage |

This PR aligns the local filenames for these recorded migrations to the exact remote version prefixes. These are path-only renames: the SQL blob content is unchanged. The related static contract tests were updated to read the renamed files.

## The special `task_worker` entry — do not execute blindly

The previous local repository had `202610220001_task_worker.sql`, whose 12-digit version prefix also collided with `202610220001_secure_function_search_path.sql`. This PR normalizes its local name to `20261022000100_task_worker.sql` so every SQL migration has a unique 14-digit timestamp.

The remote ledger does **not** contain version `20261022000100`. Read-only SQL inspection did confirm that the current database already has the `agent_tasks.attempts` column, `ultron_claim_next_task()`, and `ultron_claim_due_employee_schedule()`. The live `ultron_claim_next_task()` function currently includes lease recovery, bounded retries, and an empty search path. The legacy `task_worker` SQL defines an earlier function with `search_path = public`; executing it against the current project after later hardening migrations have already been recorded could downgrade that function while the later hardening migration is skipped as already applied.

Therefore, **do not run `supabase db push` against the existing project while version `20261022000100` is still absent from remote history**. Confirm the database state on a disposable non-production project, prove a clean project can be built from the renamed migration files, and then—only in the separately authorized final migration/release phase—use Supabase's migration-history repair procedure to mark that version as applied rather than executing the legacy SQL. The documented CLI command is:

```bash
supabase migration repair 20261022000100 --status applied
supabase migration list
```

This command is documentation only; it was **not run**. Repair changes remote migration history, so it remains blocked until a disposable test run and explicit final-release authorization. Do not use it as a substitute for verifying the actual schema.

## Read-only evidence gathered

- The remote migration ledger contains the 15 versions listed above; the task-worker version is absent.
- `public.agent_tasks.attempts` exists as an integer column.
- Both task-claim functions exist in the public schema; their live definitions use an empty search path.
- The private storage bucket `ultron-private-documents` exists and is marked non-public.
- The security advisor still reports that leaked-password protection is disabled; this is an owner-controlled Auth dashboard setting and was not changed.
- The connected account exposes only this one ULTRON project; no disposable test project is currently available.
- No rows, schema objects, migration ledger rows, bucket settings, Auth settings, secrets, or production infrastructure were changed.

## Required pre-release checks

1. Create or select a disposable non-production Supabase project with no real user data.
2. Apply the renamed local migration history from scratch there; verify the task worker claim function ends with the expected hardened definition and all tables/policies/storage are recreated correctly.
3. Compare `supabase migration list` on that test project with local filenames and inspect the missing task-worker version handling.
4. Confirm the existing project's object definitions and migration ledger again before any repair.
5. Only after explicit release authorization, perform the narrowly scoped migration-history repair; immediately re-run `supabase migration list` and read-only schema assertions. Do not apply the legacy task-worker SQL to the existing project.
6. Keep the session-revocation migration in PR #320 unapplied until it is independently validated in the disposable test project and the release ordering is explicitly approved.
