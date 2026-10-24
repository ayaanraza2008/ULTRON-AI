# ULTRON AI Development State

Last verified: 2026-10-24 UTC

## Operating constraints
- Backend-first. Do not redesign, rebuild, or delete frontend source until explicitly authorized.
- Preserve the existing repository, Render service, and Supabase project.
- Free-first; never expose secrets in repository documentation.
- Treat configuration as unverified until the relevant live workflow succeeds.
- Consequential external actions require explicit approval.

## Verified progress
- PR #129: reject JWT-shaped strings and GitHub access-token formats from AgentMemory durable capture; merged, CI passed, and Render deployment verified `live` at commit `76a49edb5e08bd469fab596484330257e21344b1`.
- PR #130: AgentMemory recall and capture now fail closed when the authenticated user ID is absent, preventing fallback to a shared project namespace; regression test added, CI jobs passed, and Render deployment verified `live` at commit `56583bb56c438fa00cec917edd3166a1e053894a`.
- PR #122: server-side multi-provider fallback registry and regression coverage merged.
- PR #123: empty/malformed assistant completions trigger provider fallback in the main agent runtime; regression test merged.
- PR #124: Browser Use model proxy now rejects malformed/empty HTTP 200 completions and tries the next approved model; regression tests added. CI test job and world-intelligence build passed. Render deployment was queued at last check, not yet verified live.
- Render service `https://ultron-ai-zvd7.onrender.com` is configured for automatic deployment from `main`. Verified live deployment on 2026-10-24: commit `56583bb56c438fa00cec917edd3166a1e053894a` (PR #130), status `live`.
- Backend worker has an allowlist for research, AI Employee drafts, and bounded research-to-report workflows. It does not execute arbitrary code or perform external consequential actions.
- Readiness endpoint is intentionally a configuration/process snapshot, not proof of live provider, database, or device functionality.
- Supabase RLS policies and revocation of anonymous table grants have been applied, but two-account isolation still needs authenticated end-to-end testing.

## Known blockers / unverified capabilities
1. Live OpenRouter inference from the deployed API has not been independently verified with a real successful completion in this record.
2. Secondary provider fallback requires a valid server-side provider registry and credentials; live secondary-provider success is not yet proven.
3. Supabase sign-up, confirmation email, login, recovery, Google sign-in, and phone sign-in flows need live verification and provider configuration.
4. Conversation persistence and memory retrieval need authenticated integration tests, including two-user isolation.
5. Supabase Security Advisor currently reports **Leaked Password Protection Disabled**. Enable it in Supabase Auth security settings and rerun the advisor.
6. Tavily research, voice providers, Browser Use bridge, Windows companion pairing, and external integration deployments need live verification.
7. Windows automation requires a paired authenticated local companion; cloud hosting alone cannot control the user's PC.
8. Arbitrary code execution is intentionally unavailable without a suitable sandbox. Do not claim otherwise.

## Next actions, in order
1. Verify a real authenticated model completion through the deployed API using a safe smoke test that never prints or returns provider secrets; distinguish actual completion from configuration-only health.
2. Add authenticated Supabase integration tests for persistence and cross-account isolation when test identities/credentials are available.
3. Verify task worker execution and task state transitions against a test task; record actual completed/retried/failed outcomes.
4. Resolve the Supabase leaked-password protection warning via dashboard configuration, then recheck the security advisor.
5. Verify PR #124's Browser Use proxy deployment and live bridge behavior when bridge credentials are configured.
6. Continue backend capability work and regression tests. Frontend remains deferred.

## Reporting standard
For each capability, distinguish implemented, unit-tested, integration-tested, deployed, live-verified, and blocked. Never claim full autonomy, 100% correctness, or successful provider inference based only on configuration or a passing mock test.


## 2026-10-25 explicit worker smoke tooling
- Added npm run smoke:worker as an opt-in task-queue integration test guarded by ULTRON_CONFIRM_WORKER_SMOKE=YES.
- It requires a valid Supabase project URL, server-side service-role key, and existing test-user UUID; it inserts one plan-only task, polls boundedly, and attempts cleanup without emitting task content or credentials.
- Added mocked tests for confirmation gating, successful completion/cleanup, invalid configuration, failure redaction, and queued-task timeout cancellation.
- Live test remains unverified until run intentionally in a trusted environment with the needed server configuration. This command creates a real database row and may consume one model attempt; do not set the confirmation flag casually.
