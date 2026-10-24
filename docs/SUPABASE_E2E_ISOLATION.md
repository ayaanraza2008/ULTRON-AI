# Supabase two-account isolation test

This is an opt-in live end-to-end test for conversation, message, memory, and row-level security isolation. It is skipped during ordinary CI unless every required variable is set and the explicit write-confirmation value matches.

## Safety requirements

- Use two dedicated, confirmed Supabase Auth test accounts (A and B), never a personal or administrator account.
- This test intentionally writes temporary conversations, messages, and memory rows into the existing ULTRON Supabase project, then deletes them. Run it only when the project is healthy and test-account credentials are available.
- The test is hard-scoped to the current ULTRON project ref `opdjfhwepmcprbqojpat` and its HTTPS Supabase URL.
- Do not add these environment values to the repository, a frontend build, or logs. Use a local shell or approved CI secret store.

## Required environment

```sh
ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES
ULTRON_E2E_SUPABASE_PROJECT_REF=opdjfhwepmcprbqojpat
ULTRON_E2E_SUPABASE_URL=https://opdjfhwepmcprbqojpat.supabase.co
ULTRON_E2E_SUPABASE_PUBLISHABLE_KEY=<project publishable key>
ULTRON_E2E_USER_A_EMAIL=<dedicated test user A email>
ULTRON_E2E_USER_A_PASSWORD=<test user A password>
ULTRON_E2E_USER_B_EMAIL=<dedicated test user B email>
ULTRON_E2E_USER_B_PASSWORD=<test user B password>
```

Then run `npm test`. All other tests remain safe for normal CI; this live test skips unless the explicit confirmation and all credentials are provided.

## What it verifies

1. Both distinct test users can sign in using Supabase Auth.
2. Each user can create and read their own conversation, message, and memory row.
3. User A cannot read User B's conversation, message, or memory by row ID.
4. User A cannot create a conversation with User B's user ID.
5. Temporary rows are deleted after the test. A cleanup failure is reported explicitly; inspect the dedicated test accounts before rerunning.

A skipped test is not evidence that live RLS works. A passing run is limited to the tested accounts and flows; still check Supabase Auth configuration and the Security Advisor separately.
