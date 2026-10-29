# ULTRON cross-sector verification matrix

Last inspected: 2026-10-29 UTC. This matrix separates source/CI evidence from live production behavior.

## Verified with evidence

| Sector | Result | Evidence / limit |
|---|---|---|
| Source and regression tests | PASS | Main commit `6b7f09d97508fc2be2085695d862a921e1ae8487`; [CI run 40909210938](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40909210938); 653 tests, 652 pass, 0 fail, 1 skipped. |
| World Intelligence build | PASS | Same CI run; build and ULTRON bridge injection passed, with large-chunk warnings. |
| Production revision workflow | PASS, narrow scope | [Run 40909211008](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40909211008) confirmed health, required configuration flags and revision match for its configured URL; not a full provider/auth/worker/device E2E test. |
| Supabase project | PASS | Project `opdjfhwepmcprbqojpat` reports `ACTIVE_HEALTHY`. |
| Database security baseline | PASS, read-only audit | All eight public tables have RLS; ownership policies are present; no direct `anon` grants to public tables/sequences in inspected grants; worker SECURITY DEFINER functions have empty search_path and execute grants only to `service_role`. |
| Build Your Own X integration | PASS | PR #392 merged; bounded task-matched guidance; no runtime tutorial download/execution. |
| Migration ledger alignment | IN BRANCH | Active filenames align with the inspected 15-version remote ledger; duplicate worker scaffold archived outside active migrations. Regression test added. |

## Still blocked or not independently verified

| Sector | State | Exact next verification |
|---|---|---|
| AI text and fallback | NOT LIVE-VERIFIED | Run the redacted model smoke with actual server-side provider key/model; record a non-empty completion plus fallback behavior. Configuration flags are not proof of inference. |
| Vision | NOT LIVE-VERIFIED | Run the redacted image challenge through a model that supports vision; verify semantic challenge output, not just HTTP 200. |
| Auth and cross-account isolation | BLOCKED FOR E2E | Two dedicated disposable identities are needed to run `npm run test:supabase:e2e`. |
| Conversations, memory and documents | PARTIAL | Owner read/write, cross-user denial, upload/download/delete and cleanup require authenticated live E2E. |
| Background tasks | BLOCKED FOR LIVE SMOKE | Need deployed worker, a dedicated smoke-user UUID and server-side Supabase/provider credentials. Opt-in worker smoke creates one temporary task; explicit write authorization remains required. |
| Password security | OPEN WARNING | Supabase Security Advisor flags leaked-password protection disabled. See [official Auth password security docs](https://supabase.com/docs/guides/auth/password-security); configure only in an eligible Auth configuration. No billing/plan change made. |
| Signup/recovery/email/Google/phone OTP | NOT LIVE-VERIFIED | Requires correct provider toggles, redirect allow-list and real email/SMS delivery. |
| Voice/STT/TTS | NOT LIVE-VERIFIED | Hindi/English speech quality, interruption, latency and device failure recovery need real microphone/speaker tests. |
| Browser/external integrations | NOT LIVE-VERIFIED | Require owner-scoped credentials and safe live read-only requests. |
| Windows companion | NOT COMPLETE | Status protocol/adapter is not proof of a paired runtime. Authenticated permission-scoped companion and physical-device tests are needed. |
| Coding sandbox | NOT AVAILABLE | Arbitrary code execution stays disabled until a suitable isolated sandbox and resource/network/filesystem limits are implemented and tested. |
| Deployment identity | MIXED | Read-only Render inventory: `ultron-ai-core` in `Ultron core` is live at main SHA `6b7f09d97508fc2be2085695d862a921e1ae8487` and matches the production-check workflow. `ultron-ai` in `My Workspace` has 10 latest deploy records reported as `build_failed`. `render.yaml` declares the older `ultron-ai` service. Canonical target must be resolved before changing or triggering deployments. |
| Performance/accessibility | NEEDS DEVICE/BROWSER CHECKS | CI succeeds but map/globe chunks are large. Measure load time and verify keyboard, reduced-motion, screen-reader, mobile and desktop behavior. |

## Release boundaries

- No database migration, Render deploy, hosted environment variable, billing limit, or Auth plan setting was changed.
- Do not report overall 100% until each live blocker has its own passing evidence. Mock tests do not replace live provider/API or physical-device tests.


## Observed Render deployment split

- `Ultron core / ultron-ai-core` — `https://ultron-ai-core.onrender.com`; latest observed deploy for `6b7f09d97508fc2be2085695d862a921e1ae8487` is `live`.
- `My Workspace / ultron-ai` — `https://ultron-ai-zvd7.onrender.com`; the latest 10 deploy records returned on 2026-10-29 show `build_failed`, including a deployment attempt for that same main SHA.
- The green production-revision workflow validates only the first service. No Render setting, environment variable, deploy, restart, deletion, or service repointing was performed during this audit.
