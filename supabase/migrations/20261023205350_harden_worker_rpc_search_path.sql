-- Harden SECURITY DEFINER worker RPCs against object-shadowing through search_path.
-- Their table references are schema-qualified, and built-ins resolve through pg_catalog.
ALTER FUNCTION public.ultron_claim_due_employee_schedule() SET search_path = '';
ALTER FUNCTION public.ultron_claim_next_task() SET search_path = '';
