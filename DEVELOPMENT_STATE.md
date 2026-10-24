# ULTRON AI Development State

Last verified: 2026-10-24 UTC

## Operating constraints
- Backend-first. Do not redesign, rebuild, or delete frontend source until explicitly authorized.
- Preserve the existing repository, Render service, and Supabase project.
- Free-first; never expose secrets in repository documentation.
- Treat configuration as unverified until the relevant live workflow succeeds.
- Consequential external actions require explicit approval.

## Verified progress
- PR #122: server-side multi-provider fallback registry and regression coverage merged.
- PR #123: empty/malformed assistant completions trigger provider fallback in the main agent runtime; regression test merged.
- PR #124: Browser Use model proxy now rejects malformed/empty HTTP 200 completions and tries the next approved model; regression tests added. CI test job and world-intelligence build passed. Render deployment was queued at last check, not yet verified live.
- Latest previously live Render deployment: commit `e937668085fd33d3a1146d42e617bc8da5d37f47`, status `live`. Render service: `https://ultron-ai-zvd7.onrender.com`.
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
1. Verify PR #124's Render deployment reaches `live`; check the health endpoint and logs.
2. Add a safe live inference smoke test that never prints or returns provider secrets; distinguish actual completion from configuration-only health.
3. Add authenticated Supabase integration tests for persistence and cross-account isolation when test identities/credentials are available.
4. Verify task worker execution and task state transitions against a test task; record actual completed/retried/failed outcomes.
5. Resolve the Supabase leaked-password protection warning via dashboard configuration, then recheck the security advisor.
6. Continue backend capability work and regression tests. Frontend remains deferred.

## Reporting standard
For each capability, distinguish implemented, unit-tested, integration-tested, deployed, live-verified, and blocked. Never claim full autonomy, 100% correctness, or successful provider inference based only on configuration or a passing mock test.
