-- Private, per-user reminder records for ULTRON.
-- This migration is source-only until an owner explicitly applies it.

create table if not exists public.user_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 2000),
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_reminders_owner_status_due_idx
  on public.user_reminders (user_id, status, due_at asc);

alter table public.user_reminders enable row level security;

drop policy if exists user_reminders_select_own on public.user_reminders;
create policy user_reminders_select_own on public.user_reminders
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_reminders_insert_own on public.user_reminders;
create policy user_reminders_insert_own on public.user_reminders
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_reminders_update_own on public.user_reminders;
create policy user_reminders_update_own on public.user_reminders
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_reminders_delete_own on public.user_reminders;
create policy user_reminders_delete_own on public.user_reminders
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists user_reminders_set_updated_at on public.user_reminders;
create trigger user_reminders_set_updated_at
  before update on public.user_reminders
  for each row execute function public.ultron_set_updated_at();

revoke all on table public.user_reminders from public, anon, authenticated;
grant select, insert, update, delete on table public.user_reminders to authenticated;
