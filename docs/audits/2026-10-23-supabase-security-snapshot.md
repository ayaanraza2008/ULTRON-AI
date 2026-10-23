# ULTRON Supabase security snapshot — 2026-10-23

This is a read-only snapshot of the connected Supabase database. It records observed state only; it does not apply migrations or authorize a production rollout.

## Findings

### Browser roles still have table-level RLS bypass privileges

The live catalog query returned `TRUNCATE` and `TRIGGER` grants to both `anon` and `authenticated` on all seven application tables:

- `agent_tasks`
- `audit_events`
- `conversations`
- `employee_schedules`
- `memory_items`
- `messages`
- `user_preferences`

These grants remain an outstanding security issue because `TRUNCATE` is not protected by row-level security. The branch migration `20261023150000_revoke_browser_bypass_table_privileges.sql` is intended to remove these grants; it has not been applied to the live database.

### Agent task update guard is not present in the live database

The live catalog listed only the existing `agent_tasks_set_updated_at` trigger. It did not list `agent_tasks_guard_client_updates`. The branch migration `20261023130000_guard_agent_task_client_updates.sql` remains unapplied.

### Audit events are still browser-insertable

The live policy catalog still includes `audit_insert_own` for `authenticated`. The branch migration `20261023180000_server_authored_audit_events.sql` is intended to remove that policy and revoke browser mutation privileges. It has not been applied to the live database.

### Worker RPC functions still have a non-empty search path

The live function catalog reports:

- `ultron_claim_due_employee_schedule`: `search_path=public, pg_temp`
- `ultron_claim_next_task`: `search_path=public, pg_temp`

The branch migration `20261023170000_harden_worker_rpc_search_path.sql` is intended to set an empty search path on these functions. It has not been applied to the live database.

### Row-level policies are mostly owner-scoped

The observed policies on the application tables generally check `user_id = auth.uid()`; message policies also verify ownership of the parent conversation. RLS is enabled on the seven inspected tables. This is useful protection but does not neutralize the table-level `TRUNCATE` grant, and this catalog-only inspection is not a substitute for two-account authenticated integration tests.

## Required next steps

1. Review PR #100 and the ordered rollout in [the security migration runbook](../runbooks/security-migration-rollout.md).
2. Apply the migrations only through the approved Supabase migration workflow, with a deployment record and rollback plan.
3. Re-run the runbook's post-migration SQL checks; expected browser-role `TRUNCATE`/`TRIGGER` results are zero rows.
4. Run authenticated tests with two disposable users to verify task cancellation guards, owner isolation, audit write restrictions, and worker service-role functionality.
5. Do not claim production security is fixed until the live catalog checks and application smoke tests pass.

## Scope and limitations

- Read-only catalog inspection only; no SQL DDL or data mutation was performed.
- No service-role keys, access tokens, customer data, or secret values are included.
- A successful CI run validates branch tests and build steps, not the state of the live database.
