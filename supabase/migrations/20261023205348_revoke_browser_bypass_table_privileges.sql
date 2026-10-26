-- Prevent browser-facing roles from using table-level privileges that bypass RLS
-- (TRUNCATE) or create triggers (TRIGGER). Keep service_role/server operations intact.
-- RLS is still required for row-level SELECT/INSERT/UPDATE/DELETE.

revoke truncate, trigger on table
  public.agent_tasks,
  public.audit_events,
  public.conversations,
  public.employee_schedules,
  public.memory_items,
  public.messages,
  public.user_preferences
from anon, authenticated;

-- Keep future tables created by the current schema owner from inheriting these
-- broad browser-role privileges through PostgreSQL default privileges.
alter default privileges for role postgres in schema public
  revoke truncate, trigger on tables from anon, authenticated;
