-- ARCHIVED HISTORICAL SCAFFOLD — DO NOT APPLY DIRECTLY.
-- This duplicate-version file is not present in the inspected remote migration ledger.
-- Its purpose is superseded by the active ai_employee_scheduler,
-- durable_task_retry_backoff, recover_stale_running_tasks, and worker RPC hardening
-- migrations. Kept outside supabase/migrations/ so standard migration tooling skips it.
--
-- Safe queue claim RPC. Only the server-side service role may claim work.\nalter table public.agent_tasks add column if not exists attempts integer not null default 0 check (attempts >= 0 and attempts <= 10);
create or replace function public.ultron_claim_next_task()
returns setof public.agent_tasks
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select id
    from public.agent_tasks
    where status = 'QUEUED' and attempts < 3
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.agent_tasks as task
  set status = 'RUNNING', attempts = task.attempts + 1, started_at = now(), updated_at = now()
  from candidate
  where task.id = candidate.id
  returning task.*;
$$;

revoke all on function public.ultron_claim_next_task() from public, anon, authenticated;
grant execute on function public.ultron_claim_next_task() to service_role;
