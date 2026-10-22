-- Safe queue claim RPC. Only the server-side service role may claim work.
create or replace function public.ultron_claim_next_task()
returns setof public.agent_tasks
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select id
    from public.agent_tasks
    where status = 'QUEUED'
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.agent_tasks as task
  set status = 'RUNNING', started_at = now(), updated_at = now()
  from candidate
  where task.id = candidate.id
  returning task.*;
$$;

revoke all on function public.ultron_claim_next_task() from public, anon, authenticated;
grant execute on function public.ultron_claim_next_task() to service_role;
