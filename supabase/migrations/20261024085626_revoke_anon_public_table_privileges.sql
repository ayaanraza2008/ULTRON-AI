-- ULTRON stores personal conversations, memory, and task state in public tables.
-- Anonymous sessions must not have table-level privileges; authenticated requests
-- continue to use the user's JWT and remain constrained by RLS policies.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
