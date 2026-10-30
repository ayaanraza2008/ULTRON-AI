-- Safe, expiring, owner-scoped Windows companion action requests.
-- Only fixed application and standard-folder actions are allowed. The paired PC
-- must claim each request once and obtain a fresh local user approval before execution.

create table if not exists public.desktop_companion_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_record_id uuid not null references public.desktop_companion_devices(id) on delete cascade,
  action_type text not null
    check (action_type in ('launch_application', 'open_known_folder')),
  target text not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'completed', 'rejected', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  completed_at timestamptz,
  result_code text,
  constraint desktop_companion_commands_target_allowlist check (
    (action_type = 'launch_application' and target in ('notepad', 'explorer', 'calculator'))
    or
    (action_type = 'open_known_folder' and target in ('desktop', 'documents', 'downloads'))
  ),
  constraint desktop_companion_commands_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '90 seconds'
  ),
  constraint desktop_companion_commands_result_code check (
    result_code is null or result_code in (
      'USER_APPROVED', 'USER_REJECTED', 'ACTION_COMPLETED',
      'ACTION_FAILED', 'APPROVAL_EXPIRED'
    )
  )
);

create index if not exists desktop_companion_commands_device_created_idx
  on public.desktop_companion_commands (device_record_id, created_at desc);
create index if not exists desktop_companion_commands_pending_idx
  on public.desktop_companion_commands (device_record_id, created_at)
  where status = 'pending';

alter table public.desktop_companion_commands enable row level security;

drop policy if exists desktop_companion_commands_select_owner
  on public.desktop_companion_commands;
create policy desktop_companion_commands_select_owner
  on public.desktop_companion_commands
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.desktop_companion_commands from public, anon, authenticated;
grant select (
  id, device_record_id, action_type, target, status,
  created_at, expires_at, delivered_at, completed_at, result_code
) on table public.desktop_companion_commands to authenticated;
grant all on table public.desktop_companion_commands to service_role;

-- The browser may request only one of the fixed actions above for a device
-- owned by the signed-in user. The device must have a recent heartbeat.
create or replace function public.create_desktop_companion_command(
  p_device_record_id uuid,
  p_action_type text,
  p_target text
)
returns table(command_id uuid, command_status text, command_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_device_id uuid;
  v_command_id uuid;
  v_expires_at timestamptz;
begin
  if v_user_id is null
     or p_device_record_id is null
     or p_action_type not in ('launch_application', 'open_known_folder')
     or not (
       (p_action_type = 'launch_application' and p_target in ('notepad', 'explorer', 'calculator'))
       or
       (p_action_type = 'open_known_folder' and p_target in ('desktop', 'documents', 'downloads'))
     ) then
    return;
  end if;

  select d.id into v_device_id
    from public.desktop_companion_devices d
   where d.id = p_device_record_id
     and d.user_id = v_user_id
     and d.revoked_at is null
     and d.last_seen_at >= pg_catalog.now() - interval '90 seconds'
   for update;

  if v_device_id is null then
    return;
  end if;

  update public.desktop_companion_commands
     set status = 'expired',
         completed_at = coalesce(completed_at, pg_catalog.now()),
         result_code = coalesce(result_code, 'APPROVAL_EXPIRED')
   where device_record_id = v_device_id
     and status in ('pending', 'delivered')
     and expires_at <= pg_catalog.now();

  -- At most one outstanding action per device. This prevents request flooding
  -- and means the user approves one clearly presented action at a time.
  if exists (
    select 1
      from public.desktop_companion_commands c
     where c.device_record_id = v_device_id
       and c.status in ('pending', 'delivered')
       and c.expires_at > pg_catalog.now()
  ) then
    return;
  end if;

  v_command_id := gen_random_uuid();
  v_expires_at := pg_catalog.now() + interval '60 seconds';
  insert into public.desktop_companion_commands (
    id, user_id, device_record_id, action_type, target, status, expires_at
  ) values (
    v_command_id, v_user_id, v_device_id, p_action_type, p_target, 'pending', v_expires_at
  );

  return query select v_command_id, 'pending'::text, v_expires_at;
end;
$function$;

-- Only the paired device token may claim a command for the same device.
-- SKIP LOCKED plus a state transition ensures a command is delivered once.
create or replace function public.claim_desktop_companion_command(
  p_token_hash text,
  p_device_id uuid
)
returns table(command_id uuid, action_type text, target text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_device_id is null then
    return;
  end if;

  update public.desktop_companion_commands
     set status = 'expired',
         completed_at = coalesce(completed_at, pg_catalog.now()),
         result_code = coalesce(result_code, 'APPROVAL_EXPIRED')
   where status in ('pending', 'delivered')
     and expires_at <= pg_catalog.now()
     and device_record_id in (
       select d.id from public.desktop_companion_devices d
        where d.token_hash = p_token_hash
          and d.device_id = p_device_id
          and d.revoked_at is null
     );

  return query
  with candidate as (
    select c.id
      from public.desktop_companion_commands c
      join public.desktop_companion_devices d on d.id = c.device_record_id
     where d.token_hash = p_token_hash
       and d.device_id = p_device_id
       and d.revoked_at is null
       and c.status = 'pending'
       and c.expires_at > pg_catalog.now()
     order by c.created_at asc
     for update of c skip locked
     limit 1
  )
  update public.desktop_companion_commands c
     set status = 'delivered',
         delivered_at = pg_catalog.now()
    from candidate
   where c.id = candidate.id
  returning c.id, c.action_type, c.target, c.expires_at;
end;
$function$;

-- A result is accepted only from the same still-active paired device and only
-- for a command previously delivered to it. Result codes are deliberately enum-like.
create or replace function public.complete_desktop_companion_command(
  p_token_hash text,
  p_device_id uuid,
  p_command_id uuid,
  p_status text,
  p_result_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_device_id is null
     or p_command_id is null
     or p_status not in ('completed', 'rejected', 'failed')
     or p_result_code not in (
       'USER_APPROVED', 'USER_REJECTED', 'ACTION_COMPLETED',
       'ACTION_FAILED', 'APPROVAL_EXPIRED'
     ) then
    return false;
  end if;

  update public.desktop_companion_commands c
     set status = p_status,
         completed_at = pg_catalog.now(),
         result_code = p_result_code
    from public.desktop_companion_devices d
   where c.id = p_command_id
     and c.device_record_id = d.id
     and d.token_hash = p_token_hash
     and d.device_id = p_device_id
     and d.revoked_at is null
     and c.status = 'delivered'
     and c.expires_at > pg_catalog.now()
  returning c.id into v_updated_id;

  return v_updated_id is not null;
end;
$function$;

revoke all on function public.create_desktop_companion_command(uuid, text, text)
  from public, anon;
revoke all on function public.claim_desktop_companion_command(text, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_desktop_companion_command(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_desktop_companion_command(uuid, text, text)
  to authenticated;
grant execute on function public.claim_desktop_companion_command(text, uuid)
  to service_role;
grant execute on function public.complete_desktop_companion_command(text, uuid, uuid, text, text)
  to service_role;
