-- Queue only a narrowly allow-listed set of local Windows actions.
-- Browser-facing roles get no direct table or RPC access. The API authenticates the
-- owner, requires a separate bridge bearer token, and every action needs explicit approval.
create table if not exists public.desktop_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('launch_app', 'system_info')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  status text not null default 'PENDING_APPROVAL'
    check (status in ('PENDING_APPROVAL', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  approved_at timestamptz,
  started_at timestamptz,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 4096)),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') or approved_at is not null),
  check ((status = 'RUNNING' and lease_expires_at is not null) or (status <> 'RUNNING' and lease_expires_at is null))
);

create index if not exists desktop_actions_owner_created_idx
  on public.desktop_actions (user_id, created_at desc);
create index if not exists desktop_actions_owner_status_created_idx
  on public.desktop_actions (user_id, status, created_at asc);

alter table public.desktop_actions enable row level security;
revoke all on table public.desktop_actions from public, anon, authenticated;
grant all on table public.desktop_actions to service_role;

drop trigger if exists desktop_actions_set_updated_at on public.desktop_actions;
create trigger desktop_actions_set_updated_at
before update on public.desktop_actions
for each row execute function public.ultron_set_updated_at();

create or replace function public.ultron_guard_desktop_action_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.user_id is distinct from new.user_id
     or old.action_type is distinct from new.action_type
     or old.payload is distinct from new.payload
     or old.created_at is distinct from new.created_at then
    raise exception 'Desktop action identity and payload are immutable'
      using errcode = '42501';
  end if;

  if old.status in ('COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED') then
    raise exception 'Terminal desktop actions cannot transition'
      using errcode = '42501';
  end if;

  if old.status = 'PENDING_APPROVAL' and new.status not in ('QUEUED', 'CANCELLED') then
    raise exception 'Desktop action requires explicit approval before it can be queued'
      using errcode = '42501';
  end if;

  if old.status = 'QUEUED' and new.status not in ('RUNNING', 'CANCELLED') then
    raise exception 'Invalid queued desktop action transition'
      using errcode = '42501';
  end if;

  if old.status = 'RUNNING' and new.status not in ('RUNNING', 'COMPLETED', 'FAILED') then
    raise exception 'Invalid running desktop action transition'
      using errcode = '42501';
  end if;

  if old.status = 'QUEUED' and new.status = 'RUNNING'
     and (new.attempts <> old.attempts + 1
       or new.started_at is null
       or new.lease_expires_at is null
       or new.lease_expires_at <= now()
       or new.finished_at is not null) then
    raise exception 'Claimed desktop action must increment attempts and receive a live lease'
      using errcode = '42501';
  end if;

  if old.status = 'RUNNING' and new.status = 'RUNNING'
     and (new.attempts <> old.attempts + 1
       or old.lease_expires_at > now()
       or new.started_at is null
       or new.lease_expires_at is null
       or new.lease_expires_at <= now()) then
    raise exception 'Running desktop action can only be reclaimed after expiry with a new live lease'
      using errcode = '42501';
  end if;

  if old.status = 'RUNNING' and new.status in ('COMPLETED', 'FAILED')
     and (new.attempts <> old.attempts
       or new.lease_expires_at is not null
       or new.finished_at is null) then
    raise exception 'Action completion must preserve attempts and release its lease'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists desktop_actions_guard_transition on public.desktop_actions;
create trigger desktop_actions_guard_transition
before update on public.desktop_actions
for each row execute function public.ultron_guard_desktop_action_transition();
revoke all on function public.ultron_guard_desktop_action_transition() from public, anon, authenticated;

create or replace function public.ultron_audit_desktop_action_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_outcome text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (user_id, action, target_type, target_id, outcome, metadata)
    values (new.user_id, 'desktop_action.requested', 'desktop_action', new.id::text, 'recorded',
      jsonb_build_object('action_type', new.action_type, 'status', new.status));
    return new;
  end if;

  if old.status is distinct from new.status then
    v_action := case new.status
      when 'QUEUED' then 'desktop_action.approved'
      when 'RUNNING' then 'desktop_action.started'
      when 'COMPLETED' then 'desktop_action.completed'
      when 'FAILED' then 'desktop_action.failed'
      when 'CANCELLED' then 'desktop_action.cancelled'
      when 'BLOCKED' then 'desktop_action.blocked'
      else 'desktop_action.updated'
    end;
    v_outcome := case
      when new.status in ('QUEUED', 'RUNNING', 'COMPLETED') then 'allowed'
      when new.status in ('FAILED', 'BLOCKED') then 'failed'
      when new.status = 'CANCELLED' then 'denied'
      else 'recorded'
    end;
    insert into public.audit_events (user_id, action, target_type, target_id, outcome, metadata)
    values (new.user_id, v_action, 'desktop_action', new.id::text, v_outcome,
      jsonb_build_object(
        'action_type', new.action_type,
        'previous_status', old.status,
        'status', new.status,
        'attempts', new.attempts,
        'error_code', new.error_code
      ));
  end if;
  return new;
end;
$$;

drop trigger if exists desktop_actions_audit_changes on public.desktop_actions;
create trigger desktop_actions_audit_changes
after insert or update on public.desktop_actions
for each row execute function public.ultron_audit_desktop_action_changes();
revoke all on function public.ultron_audit_desktop_action_changes() from public, anon, authenticated;

-- Claim work atomically and recover an expired lease at most three times per action.
create or replace function public.ultron_claim_next_desktop_action(p_user_id uuid)
returns setof public.desktop_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.desktop_actions;
begin
  if p_user_id is null then
    return;
  end if;

  update public.desktop_actions
     set status = 'FAILED',
         error_code = 'DESKTOP_ACTION_RETRY_EXHAUSTED',
         lease_expires_at = null,
         finished_at = now(),
         updated_at = now()
   where user_id = p_user_id
     and status = 'RUNNING'
     and lease_expires_at <= now()
     and attempts >= 3;

  select * into claimed
    from public.desktop_actions
   where user_id = p_user_id
     and attempts < 3
     and (status = 'QUEUED' or (status = 'RUNNING' and lease_expires_at <= now()))
   order by created_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.desktop_actions
     set status = 'RUNNING',
         attempts = attempts + 1,
         started_at = now(),
         lease_expires_at = now() + interval '90 seconds',
         updated_at = now()
   where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

revoke all on function public.ultron_claim_next_desktop_action(uuid) from public, anon, authenticated;
grant execute on function public.ultron_claim_next_desktop_action(uuid) to service_role;
