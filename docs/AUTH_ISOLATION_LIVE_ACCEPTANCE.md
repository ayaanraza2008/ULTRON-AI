# ULTRON Live Auth Isolation Acceptance

This manual GitHub Actions workflow runs the repository's existing two-account Supabase authentication and RLS isolation E2E test. It is disabled by default and only runs against the expected ULTRON-AI Supabase project.

## Required repository Actions secrets

Create two dedicated, confirmed, disposable Supabase Auth test accounts in project `opdjfhwepmcprbqojpat`. Add these secrets under GitHub Settings → Secrets and variables → Actions:

- `ULTRON_E2E_SUPABASE_PUBLISHABLE_KEY`
- `ULTRON_E2E_USER_A_EMAIL`
- `ULTRON_E2E_USER_A_PASSWORD`
- `ULTRON_E2E_USER_B_EMAIL`
- `ULTRON_E2E_USER_B_PASSWORD`

Do not use personal accounts. Do not share the values in chat. Do not use a service-role key; the test signs in as each user and performs requests using each user's JWT plus the public publishable key.

## How to run

1. Open GitHub Actions → **ULTRON Live Auth Isolation Acceptance**.
2. Select the `main` branch.
3. Set `confirm=YES` only after checking that both accounts are dedicated disposable test users.
4. Inspect the test output and confirm cleanup succeeded.

The workflow is explicitly gated and limited to the expected project URL/ref. It inserts temporary conversation, message and memory records, checks each user sees only their own rows, verifies an attempted forged owner insert is rejected, and deletes the test rows. It does not create accounts, send email/SMS, read production user content, or alter settings.

If a cleanup failure is reported, stop and inspect only the dedicated test accounts before running it again. The test reports IDs for cleanup diagnosis but does not print passwords, access tokens or other account data.

## What one pass proves

A pass proves row-level isolation for the tested conversations/messages/memory records and the tested forged-owner insert. It does not prove email recovery delivery, OAuth/OTP, storage policy behavior outside the tested scope, every account table, or all frontend flows.

Merging this workflow PR into `main` may trigger the current Render auto-deploy configuration despite not changing backend runtime code. Review deployment impact separately before merging.
