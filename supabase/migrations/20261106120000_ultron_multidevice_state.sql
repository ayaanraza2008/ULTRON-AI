-- Durable shared state backing the Supabase REST multi-device persistence adapter.
-- The service-role backend is the only writer/reader; browser roles must never
-- enumerate device state, pending deliveries, or revocation records.

create table if not exists public.ultron_multidevice_state (
  key text primary key
    check (char_length(key) between 1 and 240),
  value jsonb not null,
  version integer not null default 1
    check (version >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.ultron_multidevice_state is
  'Private ULTRON multi-device persistence. Access only through the server-side service role.';

alter table public.ultron_multidevice_state enable row level security;

-- No browser role should read or mutate cross-device state. The backend uses
-- the service-role key over HTTPS; it is never shipped to clients.
revoke all on table public.ultron_multidevice_state from public, anon, authenticated;
grant all on table public.ultron_multidevice_state to service_role;
