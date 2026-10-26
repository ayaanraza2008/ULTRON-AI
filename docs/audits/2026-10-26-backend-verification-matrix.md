# ULTRON AI backend verification matrix — 2026-10-26

## Scope and scoring

This is an evidence snapshot of the existing `ayaanraza2008/ULTRON-AI` repository and the connected ULTRON Supabase project. It does **not** certify all production behavior. Frontend and deployment implementation are explicitly deferred and excluded from the score.

The original dashboard did not expose a reproducible denominator. For this rebaseline, each of the four dashboard areas has six fixed acceptance clusters with equal weight. Per cluster: **VERIFIED = 1 point; PARTIALLY VERIFIED = 0.5; FAILED, BLOCKED, or NOT IMPLEMENTED = 0.** Each category is points divided by six. The overall backend score is the unweighted mean of the four category scores, preserving the same equal-category approach implied by the original 99/75/75/70 average. This score is a checklist score, not source-code coverage or a provider-quality claim. A blocked external check receives no verified credit.

## Current source and CI evidence

- Main revision inspected: `aa20fb15ddf4c6302cc25c310c945efc4ca207b4`.
- Main CI run [40287870102](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40287870102): Python bridge policy/syntax checks passed; `npm audit --omit=dev --audit-level=high` passed; `npm run check` passed; `npm test` reported **507 tests, 506 passed, 0 failed, 1 skipped**; the pinned God’s Eye bridge build passed. The run failed only in the production health step because `/api/health` returned `status=ok` and the three required configuration flags, but no `build.commit`. It is not evidence of a backend unit-test failure.
- Candidate PR [#279](https://github.com/ayaanraza2008/ULTRON-AI/pull/279) separates ordinary source CI from a read-only production revision check that can run only after a manual dispatch on `main`. It also includes the two-file worker smoke result-validation fix from PR #278 and regression tests. Candidate CI [40351782352](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40351782352) passed for `scripts/worker-smoke.mjs` and its tests, with **508 tests, 507 passed, 0 failed, 1 skipped**; the pinned integration build also passed. After recording the DNS-rebinding limitation, full branch CI [40353141004](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40353141004) passed with **508 tests, 507 passed, 0 failed, 1 skipped** and its pinned integration build passed. A subsequent documentation-reference refresh also passed full CI in [40353416998](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40353416998) with the same 508/507/0/1 test summary. This branch is not merged, so `main` still contains the old production-check coupling and the old smoke behavior.
- Two useful but not-yet-merged backend candidate fixes were also reviewed: [PR #278](https://github.com/ayaanraza2008/ULTRON-AI/pull/278) adds validation of the persisted worker result instead of trusting `COMPLETED` alone (its CI run [40343057141](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40343057141) passed); the same two-file fix and tests have now been copied into PR #279's candidate branch for combined CI validation. [PR #261](https://github.com/ayaanraza2008/ULTRON-AI/pull/261) fixes duplicate migration-version prefixes and malformed SQL comments (CI run [40329661239](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40329661239) passed). PR #261 remains separate and unmerged; no deployment was triggered.

## Live Supabase read-only evidence

Project `opdjfhwepmcprbqojpat` reports `ACTIVE_HEALTHY` in `ap-south-1`, with 14 migrations in the live migration history. A read-only catalog query on 2026-10-26 found:

- Row-level security enabled on all seven application tables: `agent_tasks`, `audit_events`, `conversations`, `employee_schedules`, `memory_items`, `messages`, and `user_preferences`.
- Zero `TRUNCATE` or `TRIGGER` table grants for `anon` or `authenticated` on those tables.
- No browser-role INSERT policy on `audit_events`.
- The `agent_tasks_guard_client_updates` trigger is present.
- Both `ultron_claim_due_employee_schedule` and `ultron_claim_next_task` have an empty `search_path` setting.

The live Security Advisor still reports **Leaked Password Protection Disabled**. This was not changed because production settings are out of scope. The live two-account isolation test and the full Auth flows were not run; the repository’s opt-in test deliberately skips without dedicated test-account credentials and an explicit write confirmation.

## Verification matrix

### Backend automated tests — **83.3%** (5 / 6 weighted points)

| Acceptance cluster | Implementation / evidence | Result |
|---|---|---|
| Main Node test suite | Main CI run 40287870102; 506/507 discovered tests passed, no test failures | PARTIALLY VERIFIED — one E2E test skipped |
| JavaScript syntax/preflight | `npm run check` passed in CI | VERIFIED |
| Browser Use Python policy and syntax | `browser-use-bridge/test_navigation_policy.py` passed in CI | VERIFIED |
| High-severity runtime dependency audit | `npm audit --omit=dev --audit-level=high` passed in CI | VERIFIED |
| Regression and failure-path cases | Existing tests cover provider fallback, malformed/oversized responses, timeouts, task retry/lease/cancellation, and authorization guards; the suite passed | VERIFIED at deterministic test level |
| Flakiness / mutation-strength assessment | No dedicated mutation-testing run or repeated-run flake report was available in this audit; one live E2E test remains skipped | PARTIALLY VERIFIED |

The main-branch raw **test execution pass ratio is 506/507 = 99.8%**; the hardened candidate branch passed **507/508 = 99.8%** after adding one regression test. These pass ratios are distinct from checklist completeness and are not code coverage.

### AI providers and integrations — **58.3%** (3.5 / 6 weighted points)

| Acceptance cluster | Implementation / evidence | Result |
|---|---|---|
| Provider configuration and fallback | Provider routing/fallback code and regression tests are present; CI passes | VERIFIED for deterministic behavior |
| Timeout, rate-limit, malformed response and response-size handling | Provider/worker tests cover these failure paths; CI passes | VERIFIED for deterministic behavior |
| Model and vision routing | `tests/vision-routing.test.js`, model fallback and chat fallback tests are included in the passing suite | VERIFIED for routing logic, not live model capability |
| Integration registration, input validation, permissions and output handling | Multiple adapters and mock-based tests exist; external service workflows are not all exercised end-to-end | PARTIALLY VERIFIED |
| Real text inference against an eligible configured provider | No live provider smoke request was run in this audit; production health flags indicate configuration only | BLOCKED — credential-backed, authorized live request required |
| Real vision inference and external integration execution | No live vision request or authenticated external service operation was run | BLOCKED — configured model/service availability and real output remain unproven |

### Authentication and security — **50.0%** (3 / 6 weighted points)

| Acceptance cluster | Implementation / evidence | Result |
|---|---|---|
| Auth route validation, rate limiting and secret-safe error paths | Corresponding regression tests are present and pass; actual Supabase Auth flows were not exercised | PARTIALLY VERIFIED |
| RLS enabled on all application tables | Live schema inspection confirms RLS is enabled on all seven application tables | VERIFIED |
| Browser privilege and server-authored audit protections | Live SQL confirms no browser `TRUNCATE`/`TRIGGER` grants, no audit INSERT policy, the task-update guard trigger, and empty worker-RPC search paths | VERIFIED |
| Migration source consistency | Main still has duplicate `202610220001` filename prefixes and the task-worker SQL begins with a literal escaped newline in a comment; candidate PR #261 fixes the version collision/comment and its CI is green | PARTIALLY VERIFIED — fix is not on main |
| Live signup/login/session refresh/recovery and two-account isolation | Not run with dedicated synthetic accounts; opt-in two-account E2E is skipped without required test credentials and explicit write confirmation | BLOCKED |
| Leaked-password protection | Current live Supabase Security Advisor reports this setting disabled | FAILED — requires owner action in Supabase Auth password-security settings |

### Live task execution — **50.0%** (3 / 6 weighted points)

| Acceptance cluster | Implementation / evidence | Result |
|---|---|---|
| Request validation, allowlisted task modes and approval/permission gates | Deterministic task/agent tests pass in CI | VERIFIED at code/test level |
| Retries, backoff, lease renewal, cancellation races and stale recovery | Worker regression tests pass; live schema shows hardened worker RPCs and applied recovery-related migrations | VERIFIED for deterministic code paths, not live task execution |
| Validate persisted result before reporting smoke-test success | Main smoke script still treats `COMPLETED` as success. PR #279 candidate includes the tested PR #278 implementation and regression cases requiring a non-empty, role/mode-matched `employee_output` result; candidate CI passed | PARTIALLY VERIFIED — candidate fix is not on main |
| Real provider-backed queued task from enqueue through persisted result | `npm run smoke:worker` was not run against the live database/provider | BLOCKED — needs dedicated test-user UUID, service-role key in a trusted environment, enabled worker, provider key/quota, and explicit smoke confirmation |
| Real non-destructive tool invocation through the full orchestration pipeline | Deterministic adapter/tool tests exist; no authenticated live external tool operation was run | BLOCKED — no authorized test service/session supplied to this audit |
| Persistence/recovery state transitions in a live task run | Live function/schema presence is confirmed; no controlled live state-machine test was run | PARTIALLY VERIFIED |

## Overall evidence score

| Area | Starting estimate | Recalculated checklist score |
|---|---:|---:|
| Backend automated tests | 99% | 83.3% |
| AI providers & integrations | 75% | 58.3% |
| Authentication & security | 75% | 50.0% |
| Live task execution | 70% | 50.0% |
| **Overall backend verification** | **80%** | **60.4%** |

Calculation: `(83.3 + 58.3 + 50.0 + 50.0) / 4 = 60.4%`. The decrease is intentional: the starting dashboard figures had no visible denominator, while this score gives no verified credit to blocked or failed live acceptance checks. It does not imply the code is only 60.4% implemented; it means that strict evidence for all in-scope acceptance clusters is not yet available.

### Candidate branch score after this turn's verified code changes

The unmerged candidate branch passed [run 40352157134](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40352157134), including the worker result-validation implementation and regression tests. On that candidate branch only, the persisted-result acceptance cluster moves from **PARTIALLY VERIFIED** to **VERIFIED** because deterministic tests now reject missing, empty, or role/mode-mismatched results.

| Area | Main score | Candidate branch score |
|---|---:|---:|
| Backend automated tests | 83.3% | 83.3% |
| AI providers & integrations | 58.3% | 58.3% |
| Authentication & security | 50.0% | 50.0% |
| Live task execution | 50.0% | 58.3% |
| **Overall backend verification** | **60.4%** | **62.5%** |

Calculation for the candidate branch: `(83.3 + 58.3 + 50.0 + 58.3) / 4 = 62.5%`. This measures the candidate source plus deterministic CI evidence; it does **not** turn live provider, Auth, queue execution, or production verification into verified capabilities. It remains unmerged, so the main-branch score stays 60.4%.

## Remaining blockers and next action

1. **Provider / vision live tests:** run `npm run smoke:model` only from a trusted test environment with confirmed free-only provider credentials and explicit authorization; then do a separate image request against a model that actually advertises vision support. Do not place keys in source control or chat.
2. **Task worker live test:** run `npm run smoke:worker` with a dedicated non-production test user, service-role key from a protected secret store, enabled worker, valid provider credentials/quota, and `ULTRON_CONFIRM_WORKER_SMOKE=YES`. Verify persisted result and cleanup.
3. **Auth / account isolation:** configure dedicated disposable test users and execute the opt-in Supabase two-account E2E; inspect signup confirmation, recovery, session refresh, and any enabled Google/phone flows without bypassing confirmation.
4. **Leaked password protection:** owner must enable Supabase Auth leaked-password protection in project settings and re-run the Security Advisor. This audit did not modify production settings.
5. **Migration reproducibility:** review the green candidate PR #261 and ensure its filenames match the already-applied migration history before any approved schema rollout.
6. **Smoke result correctness:** the tested fix from PR #278 is also in PR #279's candidate branch. Verify combined CI and merge only as part of an approved source change; it is not part of `main`.
7. **Source/production CI separation:** review PR #279. It changes only CI workflow behavior and deliberately does not run the live-production check on every source push. Production remains unverified until the separately authorized manual verification passes.
8. **Outbound-fetch DNS rebinding:** `network-safety.js` rejects private/reserved IP literals and unsafe URL syntax, and upstream fetches use `redirect: "error"`; its own code comments explicitly state that DNS-rebinding protection is not provided. Before arbitrary user-influenced fetches are treated as production-complete, pin DNS resolution to a validated public address (including TLS SNI/Host correctness) or enforce network egress restrictions, and test rebind/redirect cases.

## Safety boundary

This audit used repository/API reads, inspected GitHub CI logs, edited source files only on the non-production candidate branch, and ran a read-only Supabase catalog query. It did not write to Supabase, create or delete live test data, read secret values, change Render settings, deploy, redeploy, or modify frontend files.
