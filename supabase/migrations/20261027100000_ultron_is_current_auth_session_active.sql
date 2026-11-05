-- Prevent a still-unexpired Supabase access JWT from authorizing ULTRON
-- server routes after the backing Auth session has been revoked.
-- The only identity examined is the current request's signed JWT session_id/sub.
create or replace function public.ultron_is_current_session_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when auth.uid() is null then false
    when coalesce(auth.jwt() ->> 'session_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then false
    else exists (
      select 1
      from auth.sessions as s
      where s.id = (auth.jwt() ->> 'session_id')::uuid
        and s.user_id = auth.uid()
    )
  end;
$function$;

-- SECURITY DEFINER is necessary to inspect auth.sessions without exposing it
-- through the Data API. The function takes no user/session arguments and only
-- reports whether the caller's own signed session currently exists.
revoke all on function public.ultron_is_current_session_active() from public, anon, authenticated;
grant execute on function public.ultron_is_current_session_active() to authenticated;
