-- Authenticated clients may cancel their own queued/running tasks, but must not forge
-- worker-owned execution state, results, errors, or task inputs. Service-role workers
-- retain full state-transition privileges; RLS still scopes rows to their owner.

create or replace function public.ultron_guard_agent_task_client_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if old.status not in ('QUEUED', 'RUNNING', 'WAITING_FOR_PERMISSION')
       or new.status <> 'CANCELLED'
       or (to_jsonb(new) - 'status' - 'updated_at')
          is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Authenticated clients may only cancel their own active tasks'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists agent_tasks_guard_client_updates on public.agent_tasks;
create trigger agent_tasks_guard_client_updates
before update on public.agent_tasks
for each row execute function public.ultron_guard_agent_task_client_updates();

revoke all on function public.ultron_guard_agent_task_client_updates() from public;
