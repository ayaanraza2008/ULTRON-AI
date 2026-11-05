-- Safe queue claim RPC. Only the server-side service role may claim work.
alter table public.agent_tasks add column if not exists attempts integer not null default 0 check (attempts >= 0 and attempts <= 10);
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
