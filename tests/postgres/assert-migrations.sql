-- PostgreSQL integration assertions for the two new backend migrations.
DO $$
DECLARE
  owner_id uuid := '00000000-0000-4000-8000-000000000001';
  queued_id uuid := '00000000-0000-4000-8000-000000000101';
  expired_id uuid := '00000000-0000-4000-8000-000000000102';
  expired_complete_rejected boolean := false;
  expired_failure_rejected boolean := false;
  claimed public.desktop_actions;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'desktop_actions' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'desktop_actions must have row-level security enabled';
  END IF;
  IF has_table_privilege('anon', 'public.desktop_actions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.desktop_actions', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles must not query desktop_actions directly';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.user_documents', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.user_documents', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.user_documents', 'DELETE')
     OR has_table_privilege('authenticated', 'public.user_documents', 'UPDATE') THEN
    RAISE EXCEPTION 'user_documents must grant only authenticated select/insert/delete';
  END IF;
  IF has_function_privilege('anon', 'public.ultron_claim_next_desktop_action(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ultron_claim_next_desktop_action(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'desktop action claim RPC must be service-role only';
  END IF;
  IF has_function_privilege('anon', 'public.ultron_search_user_documents(text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ultron_search_user_documents(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'document search RPC grants are not correctly scoped';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_documents'
      AND policyname = 'user_documents_select_own' AND qual LIKE '%auth.uid%'
  ) THEN
    RAISE EXCEPTION 'saved document select policy must be owner-scoped';
  END IF;

  INSERT INTO auth.users(id) VALUES (owner_id);

  INSERT INTO public.desktop_actions (
    id, user_id, action_type, payload, status, attempts, approved_at, lease_expires_at
  ) VALUES (
    queued_id, owner_id, 'launch_app', '{"app":"calculator"}'::jsonb,
    'QUEUED', 0, pg_catalog.now(), NULL
  );

  SELECT * INTO claimed
    FROM public.ultron_claim_next_desktop_action(owner_id);
  IF claimed.id IS DISTINCT FROM queued_id
     OR claimed.status IS DISTINCT FROM 'RUNNING'
     OR claimed.attempts IS DISTINCT FROM 1
     OR claimed.lease_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'claim RPC did not safely lease an approved action';
  END IF;

  INSERT INTO public.desktop_actions (
    id, user_id, action_type, payload, status, attempts, approved_at, lease_expires_at
  ) VALUES (
    expired_id, owner_id, 'launch_app', '{"app":"notepad"}'::jsonb,
    'RUNNING', 3, pg_catalog.now() - interval '5 minutes', pg_catalog.now() - interval '1 second'
  );

  BEGIN
    UPDATE public.desktop_actions
       SET status = 'COMPLETED', result = '{"ok":true}'::jsonb,
           finished_at = pg_catalog.now(), lease_expires_at = NULL
     WHERE id = expired_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    expired_complete_rejected := true;
  END;
  IF NOT expired_complete_rejected THEN
    RAISE EXCEPTION 'expired action lease was incorrectly accepted as completed';
  END IF;

  BEGIN
    UPDATE public.desktop_actions
       SET status = 'FAILED', error_code = 'ACTION_FAILED',
           finished_at = pg_catalog.now(), lease_expires_at = NULL
     WHERE id = expired_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    expired_failure_rejected := true;
  END;
  IF NOT expired_failure_rejected THEN
    RAISE EXCEPTION 'expired bridge acknowledgement was incorrectly accepted as failed';
  END IF;

  PERFORM * FROM public.ultron_claim_next_desktop_action(owner_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.desktop_actions
    WHERE id = expired_id AND status = 'FAILED'
      AND error_code = 'DESKTOP_ACTION_RETRY_EXHAUSTED' AND lease_expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'claim RPC must still terminally fail an expired action after max retries';
  END IF;

  RAISE NOTICE 'Migration integration assertions passed';
END;
$$;


-- Exercise actual row-level security and SECURITY INVOKER search as a non-owner.
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.user_documents (
  user_id, filename, format, source_bytes, character_count, extracted_text, content_sha256
) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner-only.txt', 'txt', 1,
   char_length('owner unique token'), 'owner unique token', repeat('a', 64)),
  ('00000000-0000-4000-8000-000000000002', 'other-only.txt', 'txt', 1,
   char_length('other private token'), 'other private token', repeat('b', 64));

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE
  visible_count integer;
  search_count integer;
  cross_owner_insert_rejected boolean := false;
BEGIN
  SELECT count(*) INTO visible_count FROM public.user_documents;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'RLS expected exactly one owner document, found %', visible_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_documents
    WHERE user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'RLS exposed another account''s document';
  END IF;

  SELECT count(*) INTO search_count
    FROM public.ultron_search_user_documents('owner unique token', 5);
  IF search_count <> 1 THEN
    RAISE EXCEPTION 'SECURITY INVOKER search did not return the current owner document';
  END IF;

  BEGIN
    INSERT INTO public.user_documents (
      user_id, filename, format, source_bytes, character_count, extracted_text, content_sha256
    ) VALUES (
      '00000000-0000-4000-8000-000000000002', 'forbidden.txt', 'txt', 1,
      char_length('forbidden data'), 'forbidden data', repeat('c', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    cross_owner_insert_rejected := true;
  END;
  IF NOT cross_owner_insert_rejected THEN
    RAISE EXCEPTION 'RLS allowed inserting a document for another account';
  END IF;
END;
$$;
RESET ROLE;

-- Verify real RLS behavior across two synthetic accounts for the existing application tables.
-- These rows exist only in the disposable PostgreSQL CI database.
INSERT INTO public.conversations (id, user_id, title) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'owner A test conversation'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000002', 'owner B test conversation');

INSERT INTO public.messages (id, conversation_id, user_id, role, content) VALUES
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000001', 'user', 'owner A private message'),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000202',
   '00000000-0000-4000-8000-000000000002', 'user', 'owner B private message');

INSERT INTO public.user_preferences (user_id, language) VALUES
  ('00000000-0000-4000-8000-000000000001', 'en'),
  ('00000000-0000-4000-8000-000000000002', 'hi');

INSERT INTO public.memory_items (user_id, kind, title, content) VALUES
  ('00000000-0000-4000-8000-000000000001', 'project_fact', 'A private memory', 'owner A memory sentinel'),
  ('00000000-0000-4000-8000-000000000002', 'project_fact', 'B private memory', 'owner B memory sentinel');

INSERT INTO public.agent_tasks (user_id, title, input, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner A task', '{}'::jsonb, 'QUEUED'),
  ('00000000-0000-4000-8000-000000000002', 'owner B task', '{}'::jsonb, 'QUEUED');

INSERT INTO public.employee_schedules (user_id, role_id, routine_id, goal) VALUES
  ('00000000-0000-4000-8000-000000000001', 'web-dev', 'isolation-a', 'synthetic owner A schedule'),
  ('00000000-0000-4000-8000-000000000002', 'web-dev', 'isolation-b', 'synthetic owner B schedule');

INSERT INTO public.audit_events (user_id, action, outcome) VALUES
  ('00000000-0000-4000-8000-000000000001', 'isolation_fixture', 'recorded'),
  ('00000000-0000-4000-8000-000000000002', 'isolation_fixture', 'recorded');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE
  row_count integer;
  cross_owner_insert_rejected boolean := false;
  cross_owner_reassign_rejected boolean := false;
  forged_completion_rejected boolean := false;
BEGIN
  SELECT count(*) INTO row_count FROM public.conversations;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.conversations WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Conversation RLS failed to isolate owner A';
  END IF;

  SELECT count(*) INTO row_count FROM public.messages;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.messages WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Message RLS failed to isolate owner A and their conversation';
  END IF;

  SELECT count(*) INTO row_count FROM public.user_preferences;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.user_preferences WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Preference RLS failed to isolate owner A';
  END IF;

  SELECT count(*) INTO row_count FROM public.memory_items;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.memory_items WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Memory RLS failed to isolate owner A';
  END IF;

  SELECT count(*) INTO row_count FROM public.agent_tasks;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.agent_tasks WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Task RLS failed to isolate owner A';
  END IF;

  SELECT count(*) INTO row_count FROM public.employee_schedules;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.employee_schedules WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Employee schedule RLS failed to isolate owner A';
  END IF;

  SELECT count(*) INTO row_count FROM public.audit_events WHERE action = 'isolation_fixture';
  IF row_count <> 1 OR EXISTS (
    SELECT 1 FROM public.audit_events
    WHERE action = 'isolation_fixture' AND user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'Audit-log RLS failed to isolate owner A';
  END IF;

  BEGIN
    INSERT INTO public.conversations (user_id, title)
    VALUES ('00000000-0000-4000-8000-000000000002', 'forbidden cross-owner insert');
  EXCEPTION WHEN insufficient_privilege THEN
    cross_owner_insert_rejected := true;
  END;
  IF NOT cross_owner_insert_rejected THEN
    RAISE EXCEPTION 'Conversation RLS allowed creating a row for owner B';
  END IF;

  BEGIN
    UPDATE public.memory_items
       SET user_id = '00000000-0000-4000-8000-000000000002'
     WHERE title = 'A private memory';
  EXCEPTION WHEN insufficient_privilege THEN
    cross_owner_reassign_rejected := true;
  END;
  IF NOT cross_owner_reassign_rejected THEN
    RAISE EXCEPTION 'Memory RLS allowed reassigning owner A data to owner B';
  END IF;

  BEGIN
    UPDATE public.agent_tasks
       SET status = 'COMPLETED', result = '{"forged":true}'::jsonb
     WHERE title = 'owner A task';
  EXCEPTION WHEN insufficient_privilege THEN
    forged_completion_rejected := true;
  END;
  IF NOT forged_completion_rejected THEN
    RAISE EXCEPTION 'Authenticated client could forge worker-owned task completion';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count FROM public.conversations;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.conversations WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Conversation RLS failed to isolate owner B';
  END IF;
  SELECT count(*) INTO row_count FROM public.messages;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.messages WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Message RLS failed to isolate owner B';
  END IF;
  SELECT count(*) INTO row_count FROM public.memory_items;
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.memory_items WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Memory RLS failed to isolate owner B';
  END IF;
END;
$$;
RESET ROLE;

