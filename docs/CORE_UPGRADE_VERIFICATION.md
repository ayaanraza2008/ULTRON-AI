# ULTRON core upgrade verification

This document separates implementation progress from live capability claims.

## Core capability areas

| Area | Backend work | What proves it works |
|---|---|---|
| AI brain | Provider adapters, streaming, model fallback, vision routing | Successful authenticated real text and image inference against the configured provider |
| Memory and identity | Supabase-backed APIs and account-scoped memory paths | Signup/sign-in/recovery E2E, persistent conversation round-trip, and cross-account denial tests |
| Autonomous agents | Task planning, allowlisted tools, background worker, retry/lease tracking, quality gates | A real task completes, is persisted, can be cancelled, and reports truthful final state |
| PC and voice | Browser/desktop adapters and speech integrations | Authenticated paired Windows companion plus real microphone/speaker/provider checks on the target device |
| Reliability and security | Readiness diagnostics, regression tests, secret-safe status, risk classification and confirmation gates | CI passes and live deployment/provider/device tests pass independently |

## Current implementation rules

- Keep frontend work deferred until backend capabilities have been verified.
- Do not treat configured credentials or URLs as proof of live functionality.
- Do not expose provider credentials in logs, API responses, tests, or source control.
- Keep destructive actions, private-data access, device control, and external side effects behind task-specific authorization/confirmation.
- Do not enable arbitrary code execution without a hardened isolated runner and resource/network/filesystem limits.
- Prefer free-tier providers and optional local integrations; do not download large models automatically.
- A cloud service cannot directly access a user's localhost or control a physical PC without an authenticated companion.

## Remaining live-verification blockers

1. Real OpenRouter text/vision inference and fallback under rate limits.
2. Supabase signup, confirmation, login, recovery, session renewal, persistence, and row-level account isolation.
3. Live worker task completion, retries, cancellation, and stale-lease recovery.
4. Real research, speech-to-text, and text-to-speech provider requests.
5. Browser automation and Windows companion pairing on a real device.
6. A hardened sandbox before any untrusted code execution is enabled.

This is a verification checklist, not a claim that the listed blockers are already resolved.
