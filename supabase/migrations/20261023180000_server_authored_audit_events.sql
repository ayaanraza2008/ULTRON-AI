-- Keep security audit events server-authored. Browser clients can read their own
-- events, but must not be able to forge entries that appear to be trusted worker logs.
DROP POLICY IF EXISTS audit_insert_own ON public.audit_events;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER
  ON TABLE public.audit_events FROM anon, authenticated;
