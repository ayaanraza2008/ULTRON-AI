-- Recover abandoned worker leases and enforce the bounded retry budget atomically.
-- The worker's provider calls have bounded timeouts; a five-minute lease leaves
-- room for transient network delays without immediately duplicating in-flight work.
create or replace function public.ultron_claim_next_task()
returns setof public.agent_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.agent_tasks;
begin
  -- A worker may die after claiming a task or after doing the work but before
  -- persisting its result. Requeue stale leases only while retry budget remains.
  update public.agent_tasks as task
     set status = case when task.attempts < 3 then 'QUEUED' else 'FAILED' end,
         error_code = 'WORKER_LEASE_EXPIRED',
         result = jsonb_build_object(
           'message', 'Worker lease expired before a durable task transition.',
           'retry', task.attempts < 3
         ),
         started_at = null,
         finished_at = case when task.attempts < 3 then null else now() end,
         updated_at = now()
   where task.status = 'RUNNING'
     and task.started_at is not null
     and task.started_at < now() - interval '5 minutes';

  -- Keep the queue claim atomic, bounded, and restricted to worker-supported modes.
  update public.agent_tasks as task
     set status = 'RUNNING',
         attempts = task.attempts + 1,
         started_at = now(),
         finished_at = null,
         error_code = null,
         updated_at = now()
   where task.id = (
     select candidate.id
       from public.agent_tasks as candidate
      where candidate.status = 'QUEUED'
        and candidate.attempts < 3
        and candidate.input->>'executionMode' in ('allowlisted_worker', 'employee_worker')
      order by candidate.created_at asc
      for update skip locked
      limit 1
   )
  returning task.* into claimed;

  if claimed.id is null then return; end if;
  return next claimed;
end;
$$;

revoke all on function public.ultron_claim_next_task() from public, anon, authenticated;
grant execute on function public.ultron_claim_next_task() to service_role;
