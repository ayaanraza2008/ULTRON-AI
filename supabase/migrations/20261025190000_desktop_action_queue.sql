-- Outbound-only Windows companion queue. Browser-facing users can inspect their own
-- actions, but only the backend service role can enqueue, approve, claim, or complete them.
create table if not exists public.desktop_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  action_type text not null check (action_type in ('system_info', 'launch_app')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'WAITING_FOR_PERMISSION'
    check (status in ('WAITING_FOR_PERMISSION', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  requires_approval boolean not null default true,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error_code text check (error_code is null or error_code in (
    'ACTION_NOT_APPROVED', 'ACTION_NOT_SUPPORTED', 'APP_NOT_ALLOWED',
    'APP_LAUNCH_FAILED', 'SYSTEM_INFO_FAILED', 'RESULT_INVALID'
  )),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'QUEUED' or not requires_approval or approved_at is not null),
  check (status not in ('COMPLETED', 'FAILED', 'CANCELLED') or finished_at is not null)
);

create index if not exists desktop_actions_user_created_idx
  on public.desktop_actions (user_id, created_at desc);
create index if not exists desktop_actions_device_queue_idx
  on public.desktop_actions (user_id, device_id, created_at)
  where status = 'QUEUED';

alter table public.desktop_actions enable row level security;
drop policy if exists desktop_actions_select_own on public.desktop_actions;
create policy desktop_actions_select_own on public.desktop_actions
  for select to authenticated using (user_id = auth.uid());

-- All writes go through bounded backend routes and a single atomic service-role claim RPC.
revoke all on table public.desktop_actions from public, anon, authenticated;
grant select on table public.desktop_actions to authenticated;
grant all on table public.desktop_actions to service_role;

drop trigger if exists desktop_actions_set_updated_at on public.desktop_actions;
create trigger desktop_actions_set_updated_at before update on public.desktop_actions
for each row execute function public.ultron_set_updated_at();

create or replace function public.ultron_claim_next_desktop_action(p_user_id uuid, p_device_id text)
returns setof public.desktop_actions
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidate as (
    select id
      from public.desktop_actions
     where user_id = p_user_id
       and device_id = p_device_id
       and status = 'QUEUED'
       and (not requires_approval or approved_at is not null)
     order by created_at asc
     for update skip locked
     limit 1
  )
  update public.desktop_actions as action
     set status = 'RUNNING',
         started_at = now(),
         updated_at = now()
    from candidate
   where action.id = candidate.id
     and action.status = 'QUEUED'
     and (not action.requires_approval or action.approved_at is not null)
  returning action.*;
$$;

revoke all on function public.ultron_claim_next_desktop_action(uuid, text) from public, anon, authenticated;
grant execute on function public.ultron_claim_next_desktop_action(uuid, text) to service_role;
