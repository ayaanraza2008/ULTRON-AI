-- Additive follow-up: revalidate a claimed Windows action after the local
-- approval dialog and immediately before the fixed local process is started.
-- This is separate from the original queue migration so already-deployed
-- installations can apply the security hardening without replaying history.

create or replace function public.authorize_desktop_companion_command(
  p_token_hash text,
  p_device_id uuid,
  p_command_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authorized boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_device_id is null
     or p_command_id is null then
    return false;
  end if;

  select exists (
    select 1
      from public.desktop_companion_commands c
      join public.desktop_companion_devices d
        on d.id = c.device_record_id
     where c.id = p_command_id
       and d.token_hash = p_token_hash
       and d.device_id = p_device_id
       and d.revoked_at is null
       and c.status = 'delivered'
       and c.expires_at > pg_catalog.now()
  ) into v_authorized;

  return coalesce(v_authorized, false);
end;
$function$;

revoke all on function public.authorize_desktop_companion_command(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_desktop_companion_command(text, uuid, uuid)
  to service_role;
