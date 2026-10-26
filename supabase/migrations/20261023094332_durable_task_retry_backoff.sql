-- Persist retry pacing in the task row so worker restarts do not reset backoff.
-- Attempt 1 waits 10s before retry; attempt 2 waits 30s. The existing worker
-- stops retrying after three total attempts.
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
      and attempts < 3
      and (
        attempts = 0
        or updated_at <= now() - case attempts
          when 1 then interval '10 seconds'
          when 2 then interval '30 seconds'
          else interval '60 seconds'
        end
      )
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
