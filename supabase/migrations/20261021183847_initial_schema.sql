-- ULTRON AI initial schema. Applied to the dedicated ULTRON-AI Supabase project; retain this file for reproducible setup.
-- All user-owned tables use RLS. Do not place provider secrets in these tables.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 240),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null check (char_length(content) <= 100000),
  model text,
  token_count integer check (token_count is null or token_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'hi', 'hinglish')),
  voice_enabled boolean not null default true,
  voice_input_locale text not null default 'en-IN',
  memory_enabled boolean not null default true,
  history_retention_days integer check (history_retention_days is null or history_retention_days between 1 and 3650),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('preference', 'project_fact', 'profile_note', 'document_reference')),
  title text not null check (char_length(title) <= 240),
  content text not null check (char_length(content) <= 20000),
  source text not null default 'user_approved' check (source in ('user_approved', 'document', 'conversation_summary')),
  is_active boolean not null default true,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 240),
  input jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'WAITING_FOR_PERMISSION', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED')),
  result jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) <= 120),
  target_type text check (target_type is null or char_length(target_type) <= 120),
  target_id text check (target_id is null or char_length(target_id) <= 240),
  outcome text not null default 'recorded' check (outcome in ('recorded', 'allowed', 'denied', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at asc);
create index if not exists messages_user_created_idx on public.messages (user_id, created_at desc);
create index if not exists memory_items_user_active_idx on public.memory_items (user_id, is_active, updated_at desc);
create index if not exists memory_items_expiry_idx on public.memory_items (expires_at) where expires_at is not null;
create index if not exists agent_tasks_user_created_idx on public.agent_tasks (user_id, created_at desc);
create index if not exists agent_tasks_user_status_idx on public.agent_tasks (user_id, status);
create index if not exists audit_events_user_created_idx on public.audit_events (user_id, created_at desc);

create or replace function public.ultron_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at before update on public.conversations
for each row execute function public.ultron_set_updated_at();

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at before update on public.user_preferences
for each row execute function public.ultron_set_updated_at();

drop trigger if exists memory_items_set_updated_at on public.memory_items;
create trigger memory_items_set_updated_at before update on public.memory_items
for each row execute function public.ultron_set_updated_at();

drop trigger if exists agent_tasks_set_updated_at on public.agent_tasks;
create trigger agent_tasks_set_updated_at before update on public.agent_tasks
for each row execute function public.ultron_set_updated_at();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.user_preferences enable row level security;
alter table public.memory_items enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations for select to authenticated using (user_id = auth.uid());
drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations for insert to authenticated with check (user_id = auth.uid());
drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists conversations_delete_own on public.conversations;
create policy conversations_delete_own on public.conversations for delete to authenticated using (user_id = auth.uid());

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages for select to authenticated using (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated using (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

drop policy if exists preferences_select_own on public.user_preferences;
create policy preferences_select_own on public.user_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists preferences_insert_own on public.user_preferences;
create policy preferences_insert_own on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
drop policy if exists preferences_update_own on public.user_preferences;
create policy preferences_update_own on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists memory_select_own on public.memory_items;
create policy memory_select_own on public.memory_items for select to authenticated using (user_id = auth.uid());
drop policy if exists memory_insert_own on public.memory_items;
create policy memory_insert_own on public.memory_items for insert to authenticated with check (user_id = auth.uid());
drop policy if exists memory_update_own on public.memory_items;
create policy memory_update_own on public.memory_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists memory_delete_own on public.memory_items;
create policy memory_delete_own on public.memory_items for delete to authenticated using (user_id = auth.uid());

drop policy if exists tasks_select_own on public.agent_tasks;
create policy tasks_select_own on public.agent_tasks for select to authenticated using (user_id = auth.uid());
drop policy if exists tasks_insert_own on public.agent_tasks;
create policy tasks_insert_own on public.agent_tasks for insert to authenticated with check (user_id = auth.uid());
drop policy if exists tasks_update_own on public.agent_tasks;
create policy tasks_update_own on public.agent_tasks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists tasks_delete_own on public.agent_tasks;
create policy tasks_delete_own on public.agent_tasks for delete to authenticated using (user_id = auth.uid());

drop policy if exists audit_select_own on public.audit_events;
create policy audit_select_own on public.audit_events for select to authenticated using (user_id = auth.uid());
drop policy if exists audit_insert_own on public.audit_events;
create policy audit_insert_own on public.audit_events for insert to authenticated with check (user_id = auth.uid());

comment on table public.memory_items is 'User-controlled memory. Never store API keys, passwords, or authentication tokens here.';
comment on table public.audit_events is 'Security-relevant events; avoid placing message bodies or credentials in metadata.';
