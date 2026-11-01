-- Durable paired devices registry for ULTRON AI companion devices (Windows, Android, Linux).
-- Tokens are stored strictly as cryptographic SHA-256 digests; plaintext tokens are never persisted.

create table if not exists public.paired_devices (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null check (char_length(device_name) between 1 and 120),
  platform text not null check (platform in ('windows', 'android', 'linux', 'macos', 'ios')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix text not null check (char_length(token_prefix) between 4 and 20),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  paired_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists paired_devices_owner_idx
  on public.paired_devices (owner_user_id, status);

create index if not exists paired_devices_token_hash_idx
  on public.paired_devices (token_hash);

alter table public.paired_devices enable row level security;

drop policy if exists paired_devices_select_own on public.paired_devices;
create policy paired_devices_select_own on public.paired_devices
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists paired_devices_update_own on public.paired_devices;
create policy paired_devices_update_own on public.paired_devices
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists paired_devices_delete_own on public.paired_devices;
create policy paired_devices_delete_own on public.paired_devices
  for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- Pending device pairing codes (short-lived, single-use, 5-minute expiry)
create table if not exists public.pending_device_pairings (
  code text primary key check (code ~ '^[0-9]{6}$'),
  device_name text not null check (char_length(device_name) between 1 and 120),
  platform text not null check (platform in ('windows', 'android', 'linux', 'macos', 'ios')),
  approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete cascade,
  device_id uuid,
  token_hash text,
  encrypted_token text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

create index if not exists pending_pairings_expiry_idx
  on public.pending_device_pairings (expires_at);

alter table public.pending_device_pairings enable row level security;

drop policy if exists pending_pairings_select_owner on public.pending_device_pairings;
create policy pending_pairings_select_owner on public.pending_device_pairings
  for select to authenticated
  using (approved_by = (select auth.uid()) or approved = false);

drop policy if exists pending_pairings_update_owner on public.pending_device_pairings;
create policy pending_pairings_update_owner on public.pending_device_pairings
  for update to authenticated
  using (approved_by = (select auth.uid()) or approved = false)
  with check (approved_by = (select auth.uid()));
