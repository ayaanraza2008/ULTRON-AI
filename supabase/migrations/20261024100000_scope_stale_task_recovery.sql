-- Only the background worker may recover its own leased tasks.
-- Other RUNNING tasks can belong to interactive/agent runtimes with separate
-- lifecycle guarantees; the worker must not reset or fail those tasks.
create or replace function public.ultron_claim_next_task()
returns setof public.agent_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.agent_tasks;
begin
  update public.agent_tasks as task
     set status = case when task.attempts < 3 then 'QUEUED' else 'FAILED' end,
         error_code = 'WORKER_LEASE_EXPIRED',
         result = jsonb_build_object(
           'message', 'The worker stopped before confirming task completion. The task was recovered according to its retry limit.',
           'retry', task.attempts < 3
         ),
         started_at = null,
         finished_at = case when task.attempts < 3 then null else now() end,
         updated_at = now()
   where task.status = 'RUNNING'
     and task.started_at is not null
     and task.started_at < now() - interval '5 minutes'
     and task.input->>'executionMode' in ('allowlisted_worker', 'employee_worker');

  update public.agent_tasks as task
     set status = 'RUNNING',
         attempts = task.attempts + 1,
         started_at = now(),
         error_code = null,
         updated_at = now()
   where task.id = (
     select candidate.id
       from public.agent_tasks as candidate
      where candidate.status = 'QUEUED'
        and candidate.attempts < 3
        and candidate.input->>'executionMode' in ('allowlisted_worker', 'employee_worker')
        and (
          candidate.attempts = 0
          or candidate.updated_at <= now() - case candidate.attempts
            when 1 then interval '10 seconds'
            when 2 then interval '30 seconds'
            else interval '60 seconds'
          end
        )
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
