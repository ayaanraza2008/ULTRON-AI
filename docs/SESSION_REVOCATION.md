# ULTRON Supabase Session Revocation Guard

## Current status

This change is a **draft source change only**. Its migration has not been applied to any Supabase project, and no live service has been redeployed as part of this work. Do not represent it as production-verified.

## What it changes

Protected Supabase-backed API requests validate the signed access token with Supabase Auth, then call `public.ultron_is_current_session_active()` with that same bearer token. The function has no caller-supplied arguments. It accepts a request only when the signed JWT has a valid `session_id` and the corresponding row in `auth.sessions` belongs to the current `auth.uid()`.

The API fails closed if the RPC returns false, is missing, times out, or cannot be decoded. Refreshed access tokens are validated the same way before the server writes replacement auth cookies or reads user data. Sign-out reports a remote revocation only after Supabase Auth confirms it.

## Required rollout dependency

The server change depends on migration `20261028150000_ultron_is_current_auth_session_active.sql`.

1. Validate the migration in a **disposable non-production Supabase project** with the matching Supabase Auth schema.
2. Run migration contract tests and SQL/security review. Confirm the function's `SECURITY DEFINER`, empty `search_path`, fully-qualified object names, absence of user/session parameters, and explicit execute grants.
3. Run two-account end-to-end tests using dedicated disposable accounts: normal access works; sign-out/revocation stops subsequent protected API reads; user A cannot read user B data; an unavailable RPC fails closed; refresh checks the new token.
4. Only in a separately authorized final release, apply the migration first and then deploy the server revision that calls the RPC. Do not deploy the server change before the function exists, because fail-closed behavior will reject Supabase sessions.
5. Verify the published commit, health endpoint, authenticated reads, revoked-token rejection and session renewal after release. Keep the prior service and database recovery path intact until those checks pass.

## Rollback guidance

The migration adds a narrowly scoped function and does not alter tables or user rows. Reverting the application code can leave the function in place while recovery is assessed; do not automatically drop it. If migration application fails, stop before deploying application code. Never disable the guard just to mask a missing migration.

## Verification boundaries

Mocked route tests and migration-source contract tests prove behavior under controlled responses, not the live Supabase Auth/session semantics. Live two-user E2E and the migration itself remain explicitly unverified until performed against a disposable test project. Keep credentials out of source and reports.
