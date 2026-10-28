# ULTRON AI — Verified Autonomy Requirements Matrix

**Snapshot date:** 2026-10-28 UTC  
**Audited default branch:** `main`  
**Audited main commit:** `c71929d33fc71e4a06556bf27d99c430472dae8b`  
**Scope:** backend, provider routing, task runtime, security, persistence, integrations, voice/device contracts, tests and CI. Frontend redesign and deployment are explicitly excluded.

This is an evidence ledger, not a claim of fictional JARVIS equivalence. A passing mock test proves the tested code path under that mock; it does not prove that an upstream provider, database, worker, microphone, or physical device works.

## Status definitions

- **Verified:** direct automated or live evidence supports the specific claim.
- **Implemented, not live-verified:** source code and/or deterministic tests exist, but a live dependency, device, or environment remains untested.
- **Blocked by owner action:** requires access, credentials, account, dashboard setting, device, or approval not available in this audit.
- **Failed:** reproducible failing test or live check.
- **Not implemented:** required capability is absent.
- **Not applicable:** documented rationale makes the requirement irrelevant to this scope.

## Requirements matrix

| Requirement | Existing implementation | Gap / risk | Verification method and current evidence | Status |
|---|---|---|---|---|
| Mainline backend build and regression suite | Node.js backend; `npm run check`; `npm test`; CI build job | CI is not live-service verification; historical runs include failures that should not be erased from the record | [Main CI, 2026-10-28](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40657928492): test job passed **553**, failed **0**, skipped **1**, total **554**; world-intelligence build passed | Verified for that commit and workflow |
| Provider interface and text routing | OpenAI-compatible provider routing, configured provider registry, bounded request deadlines, response size limits and fallback | Current runtime credentials/model access and quotas are not proven by CI; no provider key is committed or printed here | [Provider routing tests](https://github.com/ayaanraza2008/ULTRON-AI/blob/main/tests/model-provider-fallbacks.test.js); main CI passes | Implemented, not live-verified |
| Provider failure recovery | Tests cover rate limiting, HTTP 408, malformed/empty completions, timeouts, missing keys and multiple configured free-model IDs | Live free-model access and provider availability change over time; fallback cannot make an unavailable model available | Main CI provider-fallback tests; synthetic provider responses | Verified for tested deterministic fallback paths; live availability blocked by provider credentials/access |
| Vision inference | Vision routing and bounded vision request/response handling | Actual text-to-image input inference, account access and model capability must be tested against a live eligible model | Source/tests exist; live inference is not established by the main CI run | Implemented, not live-verified |
| Multi-step agent/tool execution | Agent router, tool schemas, risk classification, deduplication guards, bounded follow-up rounds and result validation | Tool integrations may be absent or misconfigured; consequential actions remain approval-gated | Main CI includes agent runtime, approval guard and tool intent guard coverage | Verified for covered mocked flows; live integrations unverified |
| Background task queue and worker lifecycle | Supabase-backed task claims, leases/heartbeat, retries, bounded backoff, cancellation checks, output validation and persistence handling | Worker is intentionally disabled unless explicitly configured; no live worker smoke test is claimed in this snapshot | [Worker tests](https://github.com/ayaanraza2008/ULTRON-AI/blob/main/tests/worker.test.js); main CI passes | Implemented, not live-verified |
| Actual queued task execution | Worker can claim/execute/persist tasks when configured | Requires trusted service-role credential, enabled worker, provider access and a dedicated test user; none should be pasted into chat | The opt-in live Supabase/task tests are skipped unless the exact test flags, project reference and dedicated accounts are provided | Blocked by owner action |
| Persistent memory and account isolation | Auth-scoped memory endpoints, account filters, preferences, data ownership guards and memory retrieval tests | Live cross-user isolation and memory quality/staleness behavior are not proven by mock tests alone | Main CI covers deterministic scope tests; live two-user E2E is skipped without disposable accounts | Implemented, not live-verified |
| Conversation/message ownership | Authenticated routes and ownership-scoped read/write logic | Need live RLS and cross-account test with separate users | Main CI unit/integration tests pass; production database is not modified for this audit | Verified for covered code paths; live RLS/account isolation unverified |
| Session revocation | Candidate PR [#320](https://github.com/ayaanraza2008/ULTRON-AI/pull/320) checks session registry and fails closed | Migration must be exercised in a disposable non-production Supabase project before any rollout; it is not applied to the existing database | PR CI on commit `7737bcdba2b5ebee7ff2d837e714f5fa7c21e8ad`: **561 passed, 0 failed, 1 skipped**; build passed. New tests cover false, unavailable, malformed JSON and non-boolean RPC responses | Implemented in open draft PR, not live-verified |
| Private document storage | Owner-scoped document storage/list/download/delete logic, bounded parsing and integrity metadata | Actual storage bucket/schema, upload persistence and cross-account file denial need non-production live verification | Existing tests run in CI; no live storage writes were performed in this audit | Implemented, not live-verified |
| SSRF and DNS-rebinding defense | `network-safety.js` validates public targets, resolves all answers, rejects mixed public/private answers, pins approved DNS answers to the actual request and blocks redirects by default | Static guard candidate PR [#322](https://github.com/ayaanraza2008/ULTRON-AI/pull/322) tracks 17 server-side outbound callers; new request callers must be added to that guard. Network egress policy remains a recommended independent layer | [Network safety tests](https://github.com/ayaanraza2008/ULTRON-AI/blob/main/tests/network-safety.test.js); [transport policy CI](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40679770424) passed the caller guard | Verified for tested transport and currently enumerated callers; candidate regression guard remains unmerged |
| Isolated code execution | Candidate PR [#319](https://github.com/ayaanraza2008/ULTRON-AI/pull/319) adds owner-only, default-off Node/Python containers with digest-pinned cached images, no network, read-only source/root filesystem and resource limits | Real Docker runtime, cached images, container exit status/timeout cleanup and host-specific behavior need a trusted local smoke test; no host-execution fallback should be added | PR CI on `82544a709ae30b30f7d3ee47281e5d5d23425c8b`: **567 passed, 0 failed, 1 skipped**; build passed. Deterministic Docker mocks only | Implemented in open draft PR, not live-verified |
| Coding sandbox test addition | Additional regression test on session-revocation candidate branch ensures malformed, object-shaped and array-shaped session RPC results fail closed | Wait for the new candidate commit's CI—not merely the prior commit's CI—before treating that change as verified | [Latest security PR CI](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40679028089): successful on commit `7737bcdba2b5ebee7ff2d837e714f5fa7c21e8ad`; **561 passed, 0 failed, 1 skipped** | Verified in CI for that candidate commit |
| Integration registry and readiness | Modular adapters/readiness checks distinguish configured versus unverified for many optional integrations | Most optional external apps have no live credentials/instances in the test environment; an entry in a catalog is not proof of connectivity | Main CI adapter/readiness tests pass; readiness responses deliberately avoid claiming live connectivity | Implemented, not live-verified per upstream |
| Browser automation | Authenticated optional Browser Use bridge client with URL policy, bounded steps and outcome validation | Bridge URL/token and external service are not configured/verified in this audit; consequential browser actions remain approval-gated | Main CI browser bridge policy and completion-validation tests pass | Implemented, not live-verified; configuration blocked by owner action if desired |
| Windows/desktop interaction | Current mainline adapter provides bounded companion status/readiness checks; separate draft PR [#317](https://github.com/ayaanraza2008/ULTRON-AI/pull/317) proposes an owner-approved action queue | A cloud backend does not by itself operate a local Windows device; actual pairing, owner approval, cancellation and physical action outcome require a local companion and test device | Source/mock tests only; no physical PC execution was performed | Partially implemented; live device operation blocked by owner hardware and pairing |
| Voice, wake-word and speech | Existing voice routing, speech adapters/readiness and wake-word text matching | Microphone access, background wake-word operation, interruption latency and real STT/TTS quality are device/browser dependent | Deterministic tests pass in CI; no physical-device voice session is claimed | Implemented, not live-verified |
| Secrets and logs | Provider keys are server-side; readiness responses omit secret values; tool results are redacted and bounded | Live secret-store configuration and rotation cannot be validated without trusted access | Secret-redaction/readiness/provider tests pass; this audit includes no secret values | Verified for tested redaction paths; live secret configuration unverified |
| Supabase leaked-password protection | Project owner can enable the Auth protection setting | The required dashboard setting is owner-controlled and was not changed | Existing project advisor previously reported the setting disabled; no dashboard mutation performed | Blocked by owner action |
| External-provider credentials and disposable E2E accounts | Opt-in smoke/E2E scripts exist and deliberately require explicit project identity and test-write flags | Dedicated test-only accounts, keys and service-role credentials must be configured outside chat in a trusted environment | Live Supabase isolation test remains skipped by default; live provider inference remains unproven | Blocked by owner action |
| Deployment and production verification | CI runs separately from production revision verification | Deployment is expressly frozen until a separate explicit authorization; no merge should be made into an auto-deploy branch merely to test code | No deployment was initiated by the audit or the candidate test commit; candidate changes remain on isolated branches | Not applicable until explicitly authorized |

## CI evidence snapshot

| Revision | Test job | Pass | Fail | Skip | Other job |
|---|---|---:|---:|---:|---|
| Main `c71929d33fc71e4a06556bf27d99c430472dae8b` | [Run 40657928492](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40657928492) | 553 | 0 | 1 | World-intelligence build passed |
| Sandbox PR `82544a709ae30b30f7d3ee47281e5d5d23425c8b` | [Run 40667428030](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40667428030) | 567 | 0 | 1 | World-intelligence build passed |
| Session-revocation PR `7737bcdba2b5ebee7ff2d837e714f5fa7c21e8ad` | [Run 40679028089](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40679028089) | 561 | 0 | 1 | World-intelligence build passed |
| Outbound transport policy PR `b5743790e7fa5d3ecdb80affdf0b4b425adebe2e` | [Run 40679770424](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40679770424) | 555 | 0 | 1 | World-intelligence build passed; static outbound caller guard passed |
| Task idempotency PR `b93e843831ea449b7f686830153210a1bcc4d0a8` | [Run 40680576831](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40680576831) | 559 | 0 | 1 | World-intelligence build passed; task retry/concurrency tests passed |

Each CI run also reported **0 dependency vulnerabilities** in the audited install/audit steps. The one skipped test in these snapshots is the opt-in live Supabase two-user E2E workflow; it requires a verified test project, dedicated accounts, and explicit live-write confirmation. Skip is not equivalent to pass.

## Highest-priority remaining blockers

1. Perform live text/vision inference using a working free-provider credential and an eligible model, using a trusted secret store.
2. Run the two-account Supabase authentication, memory, conversation and storage isolation suite on a disposable non-production project.
3. Validate the session-revocation migration and E2E revocation flow on that disposable project before considering rollout.
4. Run a true worker smoke test with a disposable user, test-only service-role credential and explicitly enabled test worker; verify the persisted result and task-state transitions.
5. Run the coding sandbox on a trusted local host with digest-pinned images already cached; verify output, timeout/kill cleanup, non-zero exit handling and no-network isolation.
6. Validate Windows companion and real voice operation on the physical device before describing those capabilities as working.
7. Keep the outbound transport policy list synchronized as new server-side HTTP callers are added; review user-influenced URLs and forwarded credentials and retain network-egress restrictions as an independent layer.
8. Ask the project owner to enable leaked-password protection in Supabase Auth when ready to make that owner-controlled security change.

## Release invariant

No merge, migration application, production secret change, infrastructure change or deployment is authorized by this document. Keep #319 and #320 as isolated draft pull requests until their specific live-verification prerequisites are fulfilled and final release authorization is separately given.
