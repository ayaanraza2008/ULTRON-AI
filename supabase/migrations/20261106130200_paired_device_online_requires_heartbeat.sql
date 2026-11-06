-- Pairing establishes ownership and credentials, not device availability.
-- A device becomes online only after a real heartbeat updates last_seen_at.
alter table public.paired_devices
  alter column last_seen_at drop not null;

alter table public.paired_devices
  alter column last_seen_at drop default;

-- The original claim function wrote the pairing timestamp as last_seen_at.
-- Clear those synthetic observations so already-claimed but never-connected
-- companions are not reported as online immediately after this migration.
update public.paired_devices
   set last_seen_at = null
 where last_seen_at is not null
   and last_seen_at = paired_at;

create or replace function public.claim_pending_device_pairing(p_code text)
returns table (
  device_id uuid,
  owner_user_id uuid,
  device_name text,
  platform text,
  token_hash text,
  token_prefix text,
  encrypted_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairing public.pending_device_pairings%rowtype;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'invalid or expired pairing code' using errcode = 'P0001';
  end if;

  select *
    into pairing
    from public.pending_device_pairings pd
   where pd.code = p_code
     and pd.approved = true
     and pd.approved_by is not null
     and pd.device_id is not null
     and pd.token_hash is not null
     and pd.token_prefix is not null
     and pd.encrypted_token is not null
     and pd.expires_at > now()
   for update;

  if not found then
    raise exception 'invalid, expired, or already claimed pairing code' using errcode = 'P0001';
  end if;

  insert into public.paired_devices (
    id, owner_user_id, device_name, platform, token_hash, token_prefix,
    status, capabilities, paired_at, last_seen_at
  ) values (
    pairing.device_id,
    pairing.approved_by,
    pairing.device_name,
    pairing.platform,
    pairing.token_hash,
    pairing.token_prefix,
    'active',
    '{}'::jsonb,
    now(),
    null
  );

  delete from public.pending_device_pairings where code = pairing.code;

  return query
    select pairing.device_id, pairing.approved_by, pairing.device_name,
           pairing.platform, pairing.token_hash, pairing.token_prefix, pairing.encrypted_token;
end;
$$;

revoke all on function public.claim_pending_device_pairing(text) from public, anon, authenticated;
grant execute on function public.claim_pending_device_pairing(text) to service_role;
