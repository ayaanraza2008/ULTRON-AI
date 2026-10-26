-- Harden the trigger function against mutable search_path resolution.
alter function public.ultron_set_updated_at() set search_path = public, pg_temp;
