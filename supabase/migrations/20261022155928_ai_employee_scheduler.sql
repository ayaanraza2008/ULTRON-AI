-- Persistent AI Employee schedules and atomic worker claims.
alter table public.agent_tasks
  add column if not exists attempts integer not null default 0 check (attempts >= 0);

create table if not exists public.employee_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id text not null check (role_id in ('gtm-engineer','seo-aeo','web-dev','social-media','ad-manager','sales','customer-satisfaction','chief-of-staff')),
  routine_id text not null check (char_length(routine_id) between 1 and 80),
  goal text not null check (char_length(goal) between 1 and 2000),
  context text check (context is null or char_length(context) <= 4000),
  interval_minutes integer not null default 1440 check (interval_minutes between 60 and 10080),
  enabled boolean not null default true,
  next_run_at timestamptz not null default (now() + interval '1 day'),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_schedules_due_idx on public.employee_schedules (next_run_at) where enabled;
create index if not exists employee_schedules_user_idx on public.employee_schedules (user_id, created_at desc);
alter table public.employee_schedules enable row level security;
drop policy if exists employee_schedules_select_own on public.employee_schedules;
create policy employee_schedules_select_own on public.employee_schedules for select to authenticated using (user_id = auth.uid());
drop policy if exists employee_schedules_insert_own on public.employee_schedules;
create policy employee_schedules_insert_own on public.employee_schedules for insert to authenticated with check (user_id = auth.uid());
drop policy if exists employee_schedules_update_own on public.employee_schedules;
create policy employee_schedules_update_own on public.employee_schedules for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists employee_schedules_delete_own on public.employee_schedules;
create policy employee_schedules_delete_own on public.employee_schedules for delete to authenticated using (user_id = auth.uid());
drop trigger if exists employee_schedules_set_updated_at on public.employee_schedules;
create trigger employee_schedules_set_updated_at before update on public.employee_schedules
for each row execute function public.ultron_set_updated_at();
grant select, insert, update, delete on public.employee_schedules to authenticated;
grant all on public.employee_schedules to service_role;

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
     set status = 'RUNNING',
         attempts = task.attempts + 1,
         started_at = now(),
         error_code = null
   where task.id = (
     select candidate.id
       from public.agent_tasks as candidate
      where candidate.status = 'QUEUED'
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

create or replace function public.ultron_claim_due_employee_schedule()
returns setof public.agent_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  due public.employee_schedules;
  queued public.agent_tasks;
begin
  select * into due
    from public.employee_schedules
   where enabled = true and next_run_at <= now()
   order by next_run_at asc
   for update skip locked
   limit 1;
  if due.id is null then return; end if;

  update public.employee_schedules
     set last_run_at = now(),
         next_run_at = now() + make_interval(mins => due.interval_minutes)
   where id = due.id;

  insert into public.agent_tasks (user_id, title, input, status)
  values (
    due.user_id,
    left('AI Employee: ' || due.role_id || ' / ' || due.routine_id, 240),
    jsonb_build_object(
      'taskType', 'employee',
      'executionMode', 'employee_worker',
      'role', due.role_id,
      'routineId', due.routine_id,
      'mode', 'plan',
      'goal', due.goal,
      'context', due.context,
      'scheduleId', due.id,
      'requiresApproval', false,
      'createdBy', 'scheduler'
    ),
    'QUEUED'
  )
  returning * into queued;
  return next queued;
end;
$$;

revoke all on function public.ultron_claim_next_task() from public, anon, authenticated;
revoke all on function public.ultron_claim_due_employee_schedule() from public, anon, authenticated;
grant execute on function public.ultron_claim_next_task() to service_role;
grant execute on function public.ultron_claim_due_employee_schedule() to service_role;
