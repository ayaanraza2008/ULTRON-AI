-- Outbound-only Windows companion pairing and presence relay.
-- No remote command queue or PC-control endpoint is introduced by this migration.

create table if not exists public.desktop_companion_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique
    check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint desktop_companion_pairings_expiry_after_creation
    check (expires_at > created_at and expires_at <= created_at + interval '5 minutes')
);

create index if not exists desktop_companion_pairings_user_created_idx
  on public.desktop_companion_pairings (user_id, created_at desc);
create index if not exists desktop_companion_pairings_expiry_idx
  on public.desktop_companion_pairings (expires_at)
  where consumed_at is null;

create table if not exists public.desktop_companion_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_name text not null
    check (length(device_name) between 1 and 120),
  platform text not null default 'windows'
    check (platform = 'windows'),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, device_id)
);

create index if not exists desktop_companion_devices_user_created_idx
  on public.desktop_companion_devices (user_id, created_at desc);
create index if not exists desktop_companion_devices_last_seen_idx
  on public.desktop_companion_devices (user_id, last_seen_at desc)
  where revoked_at is null;

alter table public.desktop_companion_pairings enable row level security;
alter table public.desktop_companion_devices enable row level security;

drop policy if exists desktop_companion_pairings_insert_owner
  on public.desktop_companion_pairings;
create policy desktop_companion_pairings_insert_owner
  on public.desktop_companion_pairings
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists desktop_companion_devices_select_owner
  on public.desktop_companion_devices;
create policy desktop_companion_devices_select_owner
  on public.desktop_companion_devices
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.desktop_companion_pairings from public, anon, authenticated;
revoke all on table public.desktop_companion_devices from public, anon, authenticated;
grant insert (user_id, code_hash, expires_at)
  on table public.desktop_companion_pairings to authenticated;
grant select (
  id, user_id, device_id, device_name, platform, created_at, last_seen_at, revoked_at
) on table public.desktop_companion_devices to authenticated;
grant all on table public.desktop_companion_pairings to service_role;
grant all on table public.desktop_companion_devices to service_role;

create or replace function public.complete_desktop_companion_pairing(
  p_code_hash text,
  p_device_id uuid,
  p_device_name text,
  p_token_hash text
)
returns table(owner_user_id uuid, companion_device_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_device_record_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_device_id is null or p_device_name is null
     or length(pg_catalog.btrim(p_device_name)) < 1
     or length(pg_catalog.btrim(p_device_name)) > 120 then
    return;
  end if;

  update public.desktop_companion_pairings
     set consumed_at = pg_catalog.now()
   where code_hash = p_code_hash
     and consumed_at is null
     and expires_at > pg_catalog.now()
  returning user_id into v_user_id;

  if not found then
    return;
  end if;

  insert into public.desktop_companion_devices (
    user_id, device_id, device_name, platform, token_hash, last_seen_at, revoked_at
  ) values (
    v_user_id, p_device_id, pg_catalog.btrim(p_device_name), 'windows', p_token_hash, null, null
  )
  on conflict (user_id, device_id) do update
    set device_name = excluded.device_name,
        platform = excluded.platform,
        token_hash = excluded.token_hash,
        created_at = pg_catalog.now(),
        last_seen_at = null,
        revoked_at = null
  returning id into v_device_record_id;

  return query select v_user_id, v_device_record_id;
end;
$function$;

create or replace function public.record_desktop_companion_heartbeat(
  p_token_hash text,
  p_device_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device_record_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_device_id is null then
    return false;
  end if;

  update public.desktop_companion_devices
     set last_seen_at = pg_catalog.now()
   where token_hash = p_token_hash
     and device_id = p_device_id
     and revoked_at is null
  returning id into v_device_record_id;

  return v_device_record_id is not null;
end;
$function$;

create or replace function public.revoke_desktop_companion_device(
  p_device_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device_record_id uuid;
begin
  if p_device_id is null then
    return false;
  end if;

  update public.desktop_companion_devices
     set revoked_at = pg_catalog.now()
   where id = p_device_id
     and user_id = auth.uid()
     and revoked_at is null
  returning id into v_device_record_id;

  return v_device_record_id is not null;
end;
$function$;

revoke all on function public.complete_desktop_companion_pairing(text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.record_desktop_companion_heartbeat(text, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_desktop_companion_device(uuid)
  from public, anon;
grant execute on function public.complete_desktop_companion_pairing(text, uuid, text, text)
  to service_role;
grant execute on function public.record_desktop_companion_heartbeat(text, uuid)
  to service_role;
grant execute on function public.revoke_desktop_companion_device(uuid)
  to authenticated;
