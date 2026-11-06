-- Atomic compare-and-swap writes for ULTRON multi-device state.
-- All mutations are serialized per key inside PostgreSQL, including first insert.
create or replace function public.save_ultron_multidevice_state(
  p_key text,
  p_value jsonb,
  p_expected_version integer default null
)
returns table (
  success boolean,
  version integer,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
  next_version integer;
begin
  if p_key is null or char_length(p_key) < 1 or char_length(p_key) > 240 or p_value is null then
    raise exception 'invalid state key or value' using errcode = '22023';
  end if;

  if p_expected_version is not null and p_expected_version < 0 then
    raise exception 'invalid expected version' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ultron_multidevice_state:' || p_key, 0));

  select s.version
    into current_version
    from public.ultron_multidevice_state as s
   where s.key = p_key
   for update;

  current_version := coalesce(current_version, 0);

  if p_expected_version is not null and p_expected_version <> current_version then
    return query select false, current_version, 'VERSION_CONFLICT'::text;
    return;
  end if;

  next_version := current_version + 1;

  insert into public.ultron_multidevice_state (key, value, version, updated_at)
  values (p_key, p_value, next_version, now())
  on conflict (key) do update
    set value = excluded.value,
        version = excluded.version,
        updated_at = excluded.updated_at;

  return query select true, next_version, null::text;
end;
$$;

revoke all on function public.save_ultron_multidevice_state(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_ultron_multidevice_state(text, jsonb, integer) to service_role;
