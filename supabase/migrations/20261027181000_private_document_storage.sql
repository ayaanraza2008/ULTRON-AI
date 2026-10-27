-- Private, per-user binary document storage for ULTRON AI.
-- Files are uploaded explicitly by an authenticated user; this bucket is never public.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 240),
  mime_type text not null check (mime_type in (
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'text/html',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique check (
    char_length(storage_path) <= 400
    and storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(txt|md|markdown|csv|json|html|htm|pdf|docx)
  created_at timestamptz not null default now()
);

create index if not exists documents_user_created_idx
  on public.documents (user_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
  );

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The user can list, create, and delete only their own metadata rows. Metadata is
-- immutable via this table grant; replacing files requires a separate upload flow.
revoke all on table public.documents from public, anon, authenticated;
grant select, insert, delete on table public.documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ultron-private-documents',
  'ultron-private-documents',
  false,
  5242880,
  array[
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'text/html',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do nothing;

drop policy if exists ultron_private_documents_select_own on storage.objects;
create policy ultron_private_documents_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ultron-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists ultron_private_documents_insert_own on storage.objects;
create policy ultron_private_documents_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ultron-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists ultron_private_documents_delete_own on storage.objects;
create policy ultron_private_documents_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ultron-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

  ),
  created_at timestamptz not null default now()
);

create index if not exists documents_user_created_idx
  on public.documents (user_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
  );

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The user can list, create, and delete only their own metadata rows. Metadata is
-- immutable via this table grant; replacing files requires a separate upload flow.
revoke all on table public.documents from public, anon, authenticated;
grant select, insert, delete on table public.documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ultron-private-documents',
  'ultron-private-documents',
  false,
  5242880,
  array[
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'text/html',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do nothing;

drop policy if exists ultron_private_documents_select_own on storage.objects;
create policy ultron_private_documents_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ultron-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists ultron_private_documents_insert_own on storage.objects;
create policy ultron_private_documents_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ultron-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists ultron_private_documents_delete_own on storage.objects;
create policy ultron_private_documents_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ultron-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
