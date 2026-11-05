-- ULTRON AI — Multi-Device Durable State & Monotonic Version Conflict Store
-- Migration: 20261106000000_multidevice_state_persistence.sql
--
-- Provides Render-compatible durable storage across container restarts and redeployments.
-- Strict Row-Level Security: table is accessible only to backend service_role / pool;
-- anonymous and authenticated browser roles are denied direct SELECT, INSERT, UPDATE, DELETE.

create table if not exists public.ultron_multidevice_state (
  key text primary key check (char_length(key) between 1 and 255),
  value jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);

create index if not exists ultron_multidevice_state_updated_idx
  on public.ultron_multidevice_state (updated_at desc);

alter table public.ultron_multidevice_state enable row level security;

-- Deny direct access to browser clients (anon, authenticated); service_role retains full access
drop policy if exists ultron_multidevice_state_isolate_clients on public.ultron_multidevice_state;
revoke all on table public.ultron_multidevice_state from anon, authenticated;
grant all on table public.ultron_multidevice_state to service_role;
