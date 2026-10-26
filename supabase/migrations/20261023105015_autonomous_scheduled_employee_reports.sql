-- Scheduled AI Employee runs should produce evidence-aware reports, not only plans.
-- The workflow remains bounded: research (when configured), synthesis, and structural quality checks.
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
    left('AI Employee report: ' || due.role_id || ' / ' || due.routine_id, 240),
    jsonb_build_object(
      'taskType', 'autonomous',
      'executionMode', 'employee_worker',
      'role', due.role_id,
      'routineId', due.routine_id,
      'mode', 'report',
      'goal', due.goal,
      'context', due.context,
      'scheduleId', due.id,
      'requiresApproval', false,
      'approved', true,
      'createdBy', 'scheduler'
    ),
    'QUEUED'
  )
  returning * into queued;
  return next queued;
end;
$$;

revoke all on function public.ultron_claim_due_employee_schedule() from public, anon, authenticated;
grant execute on function public.ultron_claim_due_employee_schedule() to service_role;
