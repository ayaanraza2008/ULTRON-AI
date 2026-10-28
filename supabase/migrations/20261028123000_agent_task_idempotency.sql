-- Make explicitly keyed task enqueue requests safe to retry after a lost response.
-- The idempotency hash and request fingerprint live inside the existing input JSONB,
-- so this additive index requires no row rewrite and leaves existing unkeyed tasks alone.
create unique index if not exists agent_tasks_user_idempotency_key_uidx
  on public.agent_tasks (user_id, (input ->> 'idempotencyKey'))
  where input ? 'idempotencyKey';
