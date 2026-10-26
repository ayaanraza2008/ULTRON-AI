-- Store only extracted document text, not uploaded source binaries.
-- Every row is owner-scoped through RLS, and search runs as the caller.
create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 240),
  format text not null check (format in ('txt', 'md', 'csv', 'json', 'html', 'pdf', 'docx')),
  source_bytes integer not null check (source_bytes between 1 and 5000000),
  character_count integer not null check (character_count between 1 and 100000),
  extracted_text text not null check (char_length(extracted_text) between 1 and 100000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(filename, '') || ' ' || coalesce(extracted_text, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (character_count = char_length(extracted_text))
);

create index if not exists user_documents_owner_created_idx
  on public.user_documents (user_id, created_at desc);
create index if not exists user_documents_owner_format_created_idx
  on public.user_documents (user_id, format, created_at desc);
create index if not exists user_documents_search_idx
  on public.user_documents using gin (search_vector);

alter table public.user_documents enable row level security;

drop policy if exists user_documents_select_own on public.user_documents;
create policy user_documents_select_own
  on public.user_documents for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_documents_insert_own on public.user_documents;
create policy user_documents_insert_own
  on public.user_documents for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_documents_delete_own on public.user_documents;
create policy user_documents_delete_own
  on public.user_documents for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.user_documents from public, anon;
grant select, insert, delete on table public.user_documents to authenticated;
grant all on table public.user_documents to service_role;

drop trigger if exists user_documents_set_updated_at on public.user_documents;
create trigger user_documents_set_updated_at
before update on public.user_documents
for each row execute function public.ultron_set_updated_at();

create or replace function public.ultron_search_user_documents(p_query text, p_limit integer default 5)
returns table (
  id uuid,
  filename text,
  format text,
  character_count integer,
  excerpt text,
  created_at timestamptz,
  rank real
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean_query text := left(btrim(coalesce(p_query, '')), 200);
  search_query tsquery;
  result_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to search saved documents'
      using errcode = '42501';
  end if;
  if char_length(clean_query) < 2 then
    return;
  end if;

  search_query := pg_catalog.websearch_to_tsquery('simple'::regconfig, clean_query);
  if search_query = ''::tsquery then
    return;
  end if;

  return query
    select
      document.id,
      document.filename,
      document.format,
      document.character_count,
      left(
        pg_catalog.ts_headline(
          'simple'::regconfig,
          document.extracted_text,
          search_query,
          'StartSel=⟦,StopSel=⟧,MaxWords=36,MinWords=12,ShortWord=2,FragmentDelimiter= …'
        ),
        2000
      ) as excerpt,
      document.created_at,
      pg_catalog.ts_rank(document.search_vector, search_query) as rank
    from public.user_documents as document
    where document.user_id = auth.uid()
      and document.search_vector @@ search_query
    order by pg_catalog.ts_rank(document.search_vector, search_query) desc, document.created_at desc
    limit result_limit;
end;
$$;

revoke all on function public.ultron_search_user_documents(text, integer) from public, anon;
grant execute on function public.ultron_search_user_documents(text, integer) to authenticated;
