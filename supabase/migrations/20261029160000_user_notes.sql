-- Private, per-user notes for ULTRON.
-- This source migration is not applied to any live Supabase project by this PR.

create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 30000),
  tags text[] not null default '{}'::text[] check (
    cardinality(tags) <= 20
    and array_position(tags, null) is null
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notes_owner_updated_idx
  on public.user_notes (user_id, updated_at desc);

alter table public.user_notes enable row level security;

drop policy if exists user_notes_select_own on public.user_notes;
create policy user_notes_select_own on public.user_notes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_notes_insert_own on public.user_notes;
create policy user_notes_insert_own on public.user_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_notes_update_own on public.user_notes;
create policy user_notes_update_own on public.user_notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_notes_delete_own on public.user_notes;
create policy user_notes_delete_own on public.user_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists user_notes_set_updated_at on public.user_notes;
create trigger user_notes_set_updated_at
  before update on public.user_notes
  for each row execute function public.ultron_set_updated_at();

-- Revoke default table privileges before granting only owner-scoped authenticated CRUD.
revoke all on table public.user_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.user_notes to authenticated;
