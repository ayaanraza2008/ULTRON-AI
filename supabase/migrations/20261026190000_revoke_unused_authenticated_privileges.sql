-- Restrict authenticated browser roles to mutations supported by the current API.
-- Existing RLS policies already block cross-user access; revoke unused
-- table-level grants as defense in depth.
REVOKE UPDATE ON TABLE public.messages FROM authenticated;
REVOKE DELETE ON TABLE public.user_preferences FROM authenticated;
