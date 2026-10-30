-- Locally approved, fixed-action requests for paired Windows companions.
-- No shell commands, free-form arguments, filesystem paths, screenshots or input events.

create table if not exists public.desktop_companion_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_record_id uuid not null references public.desktop_companion_devices(id) on delete cascade,
  device_id uuid not null,
  action_name text not null
    check (action_name in ('launch_application', 'open_known_folder')),
  action_target text not null,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'denied', 'failed', 'expired')),
  result_code text
    check (result_code is null or result_code in (
      'ACTION_COMPLETED', 'USER_DENIED', 'LOCAL_APPROVAL_REQUIRED',
      'ACTION_EXPIRED', 'ACTION_FAILED'
    )),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  claimed_at timestamptz,
  completed_at timestamptz,
  constraint desktop_companion_actions_target_allowlist
    check (
      (action_name = 'launch_application' and action_target in ('notepad', 'explorer', 'calculator'))
      or
      (action_name = 'open_known_folder' and action_target in ('desktop', 'documents', 'downloads'))
    ),
  constraint desktop_companion_actions_expiry_window
    check (expires_at > created_at and expires_at <= created_at + interval '2 minutes'),
  constraint desktop_companion_actions_claim_state
    check ((status = 'pending' and claimed_at is null) or status <> 'pending'),
  constraint desktop_companion_actions_completion_state
    check (
      (status in ('completed', 'denied', 'failed', 'expired') and completed_at is not null and result_code is not null)
      or
      (status in ('pending', 'claimed') and completed_at is null and result_code is null)
    )
);

create index if not exists desktop_companion_actions_device_pending_idx
  on public.desktop_companion_actions (device_record_id, created_at, id)
  where status = 'pending';

create index if not exists desktop_companion_actions_user_created_idx
  on public.desktop_companion_actions (user_id, created_at desc);

create unique index if not exists desktop_companion_actions_one_active_per_device_idx
  on public.desktop_companion_actions (device_record_id)
  where status in ('pending', 'claimed');

alter table public.desktop_companion_actions enable row level security;

drop policy if exists desktop_companion_actions_insert_owner
  on public.desktop_companion_actions;
create policy desktop_companion_actions_insert_owner
  on public.desktop_companion_actions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and claimed_at is null
    and completed_at is null
    and result_code is null
    and exists (
      select 1
        from public.desktop_companion_devices d
       where d.id = device_record_id
         and d.user_id = auth.uid()
         and d.device_id = desktop_companion_actions.device_id
         and d.platform = 'windows'
         and d.revoked_at is null
         and d.last_seen_at >= pg_catalog.now() - interval '90 seconds'
    )
  );

drop policy if exists desktop_companion_actions_select_owner
  on public.desktop_companion_actions;
create policy desktop_companion_actions_select_owner
  on public.desktop_companion_actions
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.desktop_companion_actions from public, anon, authenticated;
grant insert (
  user_id, device_record_id, device_id, action_name, action_target, expires_at
) on table public.desktop_companion_actions to authenticated;
grant select (
  id, user_id, device_record_id, device_id, action_name, action_target,
  status, result_code, created_at, expires_at, claimed_at, completed_at
) on table public.desktop_companion_actions to authenticated;
grant all on table public.desktop_companion_actions to service_role;

create or replace function public.claim_desktop_companion_action(
  p_token_hash text,
  p_device_id uuid
)
returns table(action_id uuid, action_name text, action_target text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device_record_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_device_id is null then
    return;
  end if;

  select d.id into v_device_record_id
    from public.desktop_companion_devices d
   where d.token_hash = p_token_hash
     and d.device_id = p_device_id
     and d.revoked_at is null
     and d.platform = 'windows';

  if v_device_record_id is null then
    return;
  end if;

  update public.desktop_companion_actions a
     set status = 'expired',
         result_code = 'ACTION_EXPIRED',
         completed_at = pg_catalog.now()
   where a.device_record_id = v_device_record_id
     and a.status in ('pending', 'claimed')
     and a.expires_at <= pg_catalog.now();

  return query
  with candidate as (
    select a.id
      from public.desktop_companion_actions a
     where a.device_record_id = v_device_record_id
       and a.status = 'pending'
       and a.expires_at > pg_catalog.now()
     order by a.created_at, a.id
     for update skip locked
     limit 1
  )
  update public.desktop_companion_actions a
     set status = 'claimed',
         claimed_at = pg_catalog.now()
    from candidate c
   where a.id = c.id
  returning a.id, a.action_name, a.action_target, a.expires_at;
end;
$function$;

create or replace function public.authorize_desktop_companion_action(
  p_token_hash text,
  p_device_id uuid,
  p_action_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authorized boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}
  p_token_hash text,
  p_device_id uuid,
  p_action_id uuid,
  p_status text,
  p_result_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_device_id is null or p_action_id is null
     or p_status is null or p_result_code is null
     or p_status not in ('completed', 'denied', 'failed', 'expired')
     or not (
       (p_status = 'completed' and p_result_code = 'ACTION_COMPLETED')
       or (p_status = 'denied' and p_result_code in ('USER_DENIED', 'LOCAL_APPROVAL_REQUIRED'))
       or (p_status = 'failed' and p_result_code = 'ACTION_FAILED')
       or (p_status = 'expired' and p_result_code = 'ACTION_EXPIRED')
     ) then
    return false;
  end if;

  update public.desktop_companion_actions a
     set status = p_status,
         result_code = p_result_code,
         completed_at = pg_catalog.now()
   where a.id = p_action_id
     and a.status = 'claimed'
     and a.device_id = p_device_id
     and a.device_record_id in (
       select d.id
         from public.desktop_companion_devices d
        where d.token_hash = p_token_hash
          and d.device_id = p_device_id
          and d.revoked_at is null
     )
     and (
       (p_status = 'expired' and a.expires_at <= pg_catalog.now())
       or
       (p_status <> 'expired' and a.expires_at > pg_catalog.now())
     )
  returning a.id into v_action_id;

  return v_action_id is not null;
end;
$function$;

revoke all on function public.claim_desktop_companion_action(text, uuid)
  from public, anon, authenticated;
revoke all on function public.authorize_desktop_companion_action(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_desktop_companion_action(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_desktop_companion_action(text, uuid)
  to service_role;
grant execute on function public.authorize_desktop_companion_action(text, uuid, uuid)
  to service_role;
grant execute on function public.complete_desktop_companion_action(text, uuid, uuid, text, text)
  to service_role;

     or p_device_id is null or p_action_id is null then
    return false;
  end if;

  select exists (
    select 1
      from public.desktop_companion_devices d
      join public.desktop_companion_actions a
        on a.device_record_id = d.id
     where d.token_hash = p_token_hash
       and d.device_id = p_device_id
       and d.revoked_at is null
       and a.id = p_action_id
       and a.device_id = p_device_id
       and a.status = 'claimed'
       and a.expires_at > pg_catalog.now()
  ) into v_authorized;

  return coalesce(v_authorized, false);
end;
$function$;

create or replace function public.complete_desktop_companion_action(
  p_token_hash text,
  p_device_id uuid,
  p_action_id uuid,
  p_status text,
  p_result_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_device_id is null or p_action_id is null
     or p_status is null or p_result_code is null
     or p_status not in ('completed', 'denied', 'failed', 'expired')
     or not (
       (p_status = 'completed' and p_result_code = 'ACTION_COMPLETED')
       or (p_status = 'denied' and p_result_code in ('USER_DENIED', 'LOCAL_APPROVAL_REQUIRED'))
       or (p_status = 'failed' and p_result_code = 'ACTION_FAILED')
       or (p_status = 'expired' and p_result_code = 'ACTION_EXPIRED')
     ) then
    return false;
  end if;

  update public.desktop_companion_actions a
     set status = p_status,
         result_code = p_result_code,
         completed_at = pg_catalog.now()
   where a.id = p_action_id
     and a.status = 'claimed'
     and a.device_id = p_device_id
     and a.device_record_id in (
       select d.id
         from public.desktop_companion_devices d
        where d.token_hash = p_token_hash
          and d.device_id = p_device_id
          and d.revoked_at is null
     )
     and (
       (p_status = 'expired' and a.expires_at <= pg_catalog.now())
       or
       (p_status <> 'expired' and a.expires_at > pg_catalog.now())
     )
  returning a.id into v_action_id;

  return v_action_id is not null;
end;
$function$;

revoke all on function public.claim_desktop_companion_action(text, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_desktop_companion_action(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_desktop_companion_action(text, uuid)
  to service_role;
grant execute on function public.complete_desktop_companion_action(text, uuid, uuid, text, text)
  to service_role;
