# ULTRON Supabase security and migration rollout

This is an evidence-based runbook, not authorization to mutate the live database. The current task explicitly leaves live migrations and deployment deferred.

## Read-only verified state — 2026-10-26

- Project: `ULTRON-AI` (`opdjfhwepmcprbqojpat`), Mumbai region, status `ACTIVE_HEALTHY`.
- The live migration ledger has 14 entries through `20261024142725_scope_stale_task_recovery`.
- Repository migration filenames now match those 14 recorded versions plus exactly two pending feature migrations: `20261026100000_desktop_action_bridge.sql` and `20261026110000_user_document_library.sql`.
- Read-only database checks confirmed RLS is enabled on the seven existing public application tables (conversations, messages, user_preferences, memory_items, agent_tasks, employee_schedules, audit_events), with owner-scoped policies. Message policies also require ownership of the parent conversation.
- Browser privilege checks returned no `anon` SELECT/INSERT/UPDATE/DELETE on those seven tables, and no `anon` TRUNCATE or authenticated TRUNCATE/TRIGGER privileges.
- Both worker SECURITY DEFINER RPCs, `ultron_claim_next_task` and `ultron_claim_due_employee_schedule`, have an empty `search_path`.
- These are schema/policy/grant observations. They are not a substitute for the opt-in two-account live RLS test or real authenticated application flows.

## Do not re-apply recorded migrations

The following existing migrations are already recorded in the live project and must not be treated as pending work:

```text
20261021183847_initial_schema
20261021183915_secure_function_search_path
20261021184829_touch_conversation_on_message
20261022155928_ai_employee_scheduler
20261023084934_optimize_rls_policy_auth_uid
20261023094332_durable_task_retry_backoff
20261023103950_recover_stale_running_tasks
20261023105015_autonomous_scheduled_employee_reports
20261023205345_guard_agent_task_client_updates
20261023205348_revoke_browser_bypass_table_privileges
20261023205350_harden_worker_rpc_search_path
20261023205352_server_authored_audit_events
20261024085626_revoke_anon_public_table_privileges
20261024142725_scope_stale_task_recovery
```

The old duplicate/alternate filenames were a source of migration drift and are no longer the expected canonical names. Never run a blanket migration command until the checked-out branch, exact migration list, and live migration ledger have been compared.

## Two migrations remain source-only

These are new backend schemas from the open feature branch and are **not** applied to the live project:

1. `20261026100000_desktop_action_bridge.sql` — an owner-scoped, explicitly approved Windows action queue with constrained action types and leases.
2. `20261026110000_user_document_library.sql` — a bounded extracted-text library with owner-scoped RLS and a caller-scoped search function.

Keep them unapplied until the matching API/worker code is reviewed and the user authorizes the final rollout phase. They must be applied in timestamp order, together with the matching application release. Then verify the two migration records, table grants, RLS, authenticated CRUD/search, cross-user denial, and desktop action lifecycle. Do not enable companion polling until the server and local companion versions are compatible and paired.

## Security advisor warning and ₹0-budget handling

The current Supabase Security Advisor reports `auth_leaked_password_protection` as disabled. Supabase's current password-security guide states that its built-in leaked-password protection is available on Pro plan and above: https://supabase.com/docs/guides/auth/password-security

Do not upgrade or activate paid features to clear this warning under the user's ₹0-budget constraint. ULTRON also has its own fail-closed password screening path, but that is only a separate mitigation; it does **not** clear the hosted Supabase advisor warning. Recheck the advisor after any future eligible configuration change.

## Read-only verification queries

### RLS on application tables

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;
```

### Owner-scoped policies

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

### Worker RPC search paths

```sql
select p.proname, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ultron_claim_due_employee_schedule', 'ultron_claim_next_task');
```

### Browser bypass privileges

```sql
select c.relname as table_name,
       r.rolname as grantee,
       x.privilege_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
join pg_roles r on r.oid = x.grantee
where n.nspname = 'public'
  and c.relname in (
    'agent_tasks', 'audit_events', 'conversations',
    'employee_schedules', 'memory_items', 'messages', 'user_preferences'
  )
  and r.rolname in ('anon', 'authenticated')
  and x.privilege_type in ('TRUNCATE', 'TRIGGER')
order by c.relname, r.rolname, x.privilege_type;
```

Expected: zero rows for these browser-facing bypass privileges.

## Required before a later production rollout

- Full migration-replay and security-contract CI passes on the exact commit to be released.
- Opt-in live two-account RLS isolation passes with two dedicated test accounts; skipped tests do not count as passing.
- A non-production signed-in test account verifies signup/confirmation, sign-in, sign-out, recovery/reset, conversation/message persistence, and memory preference enforcement.
- A real model smoke request succeeds without logging keys or generated private content.
- A queued test task completes with a persisted result and clean recovery behavior.
- The Windows action bridge passes an authenticated owner-approved test on the target Windows machine with a visible Stop control.
- The actual deployed revision and live health are verified only during the explicitly authorized deployment phase.

Never put service-role secrets or account passwords in SQL files, logs, commits, or chat. Do not use real customer data for these tests.
