# ULTRON backend security migration rollout

This runbook is for the security migrations on `autonomy/guard-production-operations`. It does not authorize or perform a production rollout.

## Current rollout gate

Before applying anything, confirm the branch and review PR #100. Production Render is configured to deploy `main`, not this feature branch. Do not merge or deploy as part of a database-only review.

A read-only Supabase audit on 2026-10-23 found that browser-facing roles still had broad table privileges on `agent_tasks` and `audit_events`, including `TRUNCATE` and `TRIGGER`. The new migrations were not present in the live database at that audit. Treat that as a verified outstanding item until the checks below pass.

## Migration sequence

Review and apply the migrations through the approved Supabase migration workflow in timestamp order:

1. `20261023130000_guard_agent_task_client_updates.sql` — restrict authenticated-client task updates to cancellation of an active task without changing worker-owned fields.
2. `20261023150000_revoke_browser_bypass_table_privileges.sql` — revoke `TRUNCATE` and `TRIGGER` on the seven existing public app tables from `anon` and `authenticated`; adjust defaults for tables created by `postgres`.
3. `20261023170000_harden_worker_rpc_search_path.sql` — set an empty `search_path` on the two SECURITY DEFINER worker RPCs.
4. `20261023180000_server_authored_audit_events.sql` — remove the browser insert policy for audit events and revoke browser-role mutation privileges on that table.

Do not paste service-role secrets into SQL, logs, commits, or chat. Do not apply only part of the sequence without documenting why and validating the resulting behavior.

## Post-migration SQL checks

Run these read-only checks in the target project and save the results with the deployment record.

### Browser roles must not have bypass/mutation privileges

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

Expected: zero rows for those privilege types. This check does not replace verifying ordinary SELECT/INSERT/UPDATE/DELETE grants and RLS policies.

### Audit log browser writes must be disabled

```sql
select policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'audit_events'
order by policyname;

select has_table_privilege('anon', 'public.audit_events', 'INSERT') as anon_insert,
       has_table_privilege('authenticated', 'public.audit_events', 'INSERT') as authenticated_insert,
       has_table_privilege('service_role', 'public.audit_events', 'INSERT') as service_role_insert;
```

Expected: no authenticated/anon insert policy, browser-role insert privileges false, service-role insert remains true, and the intended user-owned read policy remains.

### Worker RPC search path

```sql
select p.proname, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ultron_claim_due_employee_schedule', 'ultron_claim_next_task');
```

Expected: both functions include `search_path=` in `proconfig`.

### Agent task guard

```sql
select t.tgname, c.relname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'agent_tasks'
  and t.tgname = 'agent_tasks_guard_client_updates';
```

Expected: one guard trigger. Also verify the function definition and run authenticated-user tests for allowed cancellation and rejected result/status/input tampering.

## Application smoke checks

After database checks pass, use a non-production test account to verify:

- An authenticated user can read and update only their own conversations, messages, preferences, and memory.
- A user can cancel their own eligible task, but cannot forge task completion, output, error, ownership, or input fields.
- The server worker can still claim tasks, persist results, and write audit events using its server-side service role.
- Browser clients cannot create or mutate audit entries.
- Sign-in, sign-out, and password recovery work without exposing access/refresh tokens in JSON responses.
- `/api/health` remains healthy; authenticated `/api/runtime/readiness` reports configured versus verified capabilities accurately.

Do not use real customer data for these checks. Do not claim the product is fully production-ready based only on CI or a health endpoint.

## Default-privilege limitation to track

The migration changes default privileges for `postgres`-owned future tables. The live audit also showed default ACLs for `supabase_admin`. Do not assume the migration covers objects created by `supabase_admin`; verify which role owns each future table and review supported permission to alter that role's defaults separately. Never expand the migration's role scope without checking the database role membership/ownership constraints first.
