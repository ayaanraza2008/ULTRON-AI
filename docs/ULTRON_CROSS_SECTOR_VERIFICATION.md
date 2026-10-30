# ULTRON cross-sector verification matrix

Last inspected: 2026-10-29 UTC. This matrix separates source/CI evidence from live production behavior.

## Verified with evidence

| Sector | Result | Evidence / limit |
|---|---|---|
| Model picker and selected registry model dispatch | PASS — source CI; real provider unverified | `/api/models` now keeps distinct configured models that share one OpenAI-compatible base URL, and selecting a registry model preserves that provider when dispatching `/api/chat`. Regression tests verify both default free OpenRouter choices remain visible and an explicitly selected model is routed to its configured provider. [CI run 40953486540](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40953486540) passed; actual provider inference remains unverified. |
| PDF report generation | PASS — source CI; desktop app unverified | PDFKit replaces the hand-built serializer; bounded input and transient no-store endpoint remain. Byte-level xref/object-offset checks pass, and text extraction now passes with the bundled PDF.js v2 parser when given an exact `ArrayBuffer`. Tests cover one-page, multipage, unsupported-script substitution and input limits. [CI run 40951945536](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40951945536) passed. No separate Adobe/desktop PDF viewer round-trip was performed. |
| PowerPoint export | PASS — source CI; desktop app unverified | Replaced `pptxgenjs` (which brought a vulnerable `image-size` transitive dependency) with editable OpenXML slide generation using the existing `jszip` dependency. Regression tests check package parts, content, pagination and bounds. CI run 40951251429 passed; no PowerPoint desktop installation/round-trip test was run. |
| Dependency audit after presentation change | PASS — CI | Both `npm install --ignore-scripts` audit and `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities on [run 40953486540](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40953486540) after removing `pptxgenjs`; audit remains enabled. |
| Video Studio outbound HTTP | PASS — source CI and regression coverage | `video-studio/server.mjs` routes its model, stock-search, research and approved media-download requests through the shared DNS-pinned `safePinnedFetch` by default. Targeted transport-routing regression is included in [CI run 40946612120](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40946612120), which passed 794 tests, 0 failures, 1 intentionally skipped; the World Intelligence build/bridge and Windows installer parse also passed. This is source/CI evidence only; no live external provider request or production rollout was performed. |
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
| AI text and fallback | PARTIAL — source routing verified; live inference unverified | Added free-first priority for the agent runtime and chat proxy: configured OpenRouter/registry models precede default direct-key Groq/Gemini providers. Regression tests verify tool-capable free-model fallback and registry-first chat fallback [CI run 40953486540](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40953486540). Live model completion, provider quotas and real fallback success remain unverified. Groq `openai/gpt-oss-20b` is billed per token; Gemini free-tier eligibility/quotas are account-dependent ([Groq model/pricing](https://console.groq.com/docs/model/openai/gpt-oss-20b), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). |
| Vision | NOT LIVE-VERIFIED | Run the redacted image challenge through a model that supports vision; verify semantic challenge output, not just HTTP 200. |
| Auth and cross-account isolation | BLOCKED FOR E2E | Two dedicated disposable identities are needed to run `npm run test:supabase:e2e`. |
| Conversations, memory and documents | PARTIAL | Owner read/write, cross-user denial, upload/download/delete and cleanup require authenticated live E2E. |
| Background tasks | BLOCKED FOR LIVE SMOKE | Need deployed worker, a dedicated smoke-user UUID and server-side Supabase/provider credentials. Opt-in worker smoke creates one temporary task; explicit write authorization remains required. |
| Password security | OPEN WARNING | Supabase Security Advisor flags leaked-password protection disabled. See [official Auth password security docs](https://supabase.com/docs/guides/auth/password-security); configure only in an eligible Auth configuration. No billing/plan change made. |
| Signup/recovery/email/Google/phone OTP | NOT LIVE-VERIFIED | Requires correct provider toggles, redirect allow-list and real email/SMS delivery. |
| Voice/STT/TTS | NOT LIVE-VERIFIED | Hindi/English speech quality, interruption, latency and device failure recovery need real microphone/speaker tests. |
| Browser/external integrations | NOT LIVE-VERIFIED | Require owner-scoped credentials and safe live read-only requests. |
| Windows companion | NOT COMPLETE | Status protocol/adapter is not proof of a paired runtime. Authenticated permission-scoped companion and physical-device tests are needed. |
| Coding sandbox | PARTIAL — candidate only | PR #400 includes an opt-in, owner-only Docker path requiring a cached digest-pinned image, with network disabled, read-only filesystem, dropped capabilities, resource limits, raw-user source matching and cleanup. Fixed an unsupported `--sig-proxy` argument on `docker start`; regression test now asserts the exact supported command. [CI run 40951659560](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40951659560) passed. CI mocks Docker; actual Docker execution, image provenance and target-host isolation remain unverified. Mainline does not include this candidate until review/merge. |
| Deployment identity | MIXED | Read-only Render inventory: `ultron-ai-core` in `Ultron core` is live at main SHA `6b7f09d97508fc2be2085695d862a921e1ae8487` and matches the production-check workflow. `ultron-ai` in `My Workspace` has 10 recent deploy attempts blocked before build by Render's `pipeline_minutes_exhausted` event. `render.yaml` declares the older `ultron-ai` service. Canonical target must be resolved before changing or triggering deployments. |
| Performance/accessibility | NEEDS DEVICE/BROWSER CHECKS | CI succeeds but map/globe chunks are large. Measure load time and verify keyboard, reduced-motion, screen-reader, mobile and desktop behavior. |

## Release boundaries

- No database migration, Render deploy, hosted environment variable, billing limit, or Auth plan setting was changed.
- Do not report overall 100% until each live blocker has its own passing evidence. Mock tests do not replace live provider/API or physical-device tests.


## Observed Render deployment split

- `Ultron core / ultron-ai-core` — `https://ultron-ai-core.onrender.com`; latest observed deploy for `6b7f09d97508fc2be2085695d862a921e1ae8487` is `live`.
- `My Workspace / ultron-ai` — `https://ultron-ai-zvd7.onrender.com`; the 10 latest deploy attempts returned on 2026-10-29 were blocked before the application build by Render's `pipeline_minutes_exhausted` event, including an attempt for that same main SHA.
- The green production-revision workflow validates only the first service. No Render setting, environment variable, deploy, restart, deletion, or service repointing was performed during this audit.

## Local Video Studio Origin hardening — source-verified

- Fixed `video-studio/server.mjs` so Origin requests must use the same loopback **HTTP origin**, including the same host and port as the request Host header. A loopback hostname by itself is no longer treated as sufficient same-origin validation.
- Added regression assertions in `tests/video-studio.test.js`: exact same origin is accepted; a different loopback port, HTTPS origin, and remote origin are rejected; the existing hostile Host-header check remains.
- GitHub Actions passed for the PR source revision `cee5671d5ecf3df3bc71843010ef8b3b54d3c3a0`: [run 40945100841](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40945100841). Results: `npm run check` passed; `npm test` reported 793 tests, 792 passed, 0 failed, 1 skipped; World Intelligence build/bridge injection and Windows installer parsing passed; high-severity runtime dependency audit step passed.
- This is source/CI evidence only. The cross-sector PR remains unmerged and undeployed. Real provider inference, two-account Auth/RLS E2E, live worker completion, Supabase leaked-password protection, physical Windows pairing, and real Docker sandbox execution remain separate verification blockers.

## PDF and PowerPoint export verification checkpoint — 2026-10-29

- Latest completed source CI: [run 40951251429](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40951251429), candidate head `a05d149f5d37ac643b52c929f48c7c46ade560fb`: 806 tests, 805 passed, 0 failed, 1 skipped; syntax checks, dependency audits, the pinned World Intelligence build/bridge injection and Windows installer parser passed.
- PDF report generation uses the pinned `pdfkit@0.20.2`, retains the input and section bounds, and returns transient bytes without writing report contents to disk. Regression checks verify cross-reference offsets against actual object headers, the authenticated `no-store` response and extracted text for one-page/multipage output. Passing an exact `ArrayBuffer` to the bundled PDF.js v2 parser resolves the earlier `bad XRef entry` seen with a Node `Buffer` view. [CI run 40951945536](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40951945536) passed; a separate desktop PDF-reader round-trip has not been performed.
- PowerPoint generation now builds a 16:9 editable OpenXML package with text/shapes using existing `jszip`; `pptxgenjs` was removed to remove its vulnerable transitive `image-size` dependency. Package, text and pagination tests passed. No Microsoft PowerPoint desktop round-trip test has been performed.
- PR #400 remains open/unmerged. No deployment, production configuration or database mutation was part of this work.

## Coding sandbox CLI correction — source-tested

- Removed `--sig-proxy=true` from the `docker start` invocation. Signal-proxy is a `docker run` option, not a supported `docker start` option; this previously made a real sandbox start command fail despite mocked execution tests.
- `tests/coding-sandbox.test.js` now asserts the exact start argument vector and rejects the unsupported flag.
- Full CI [run 40951659560](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40951659560) passed on candidate head `3f3ba85d31c2e2a706483b4be11315ada3c13238`: 806 tests, 805 passed, 0 failed, 1 skipped; both dependency audits found 0 vulnerabilities; World Intelligence build/bridge and Windows installer parse passed.
- The test uses a mocked Docker executable. This corrects command construction only; a physical/local Docker smoke test with a cached digest-pinned image is still required before claiming code execution works end to end.

## Free-first provider ordering — source CI, live inference still pending

- Direct-key fallback priority in `agent-runtime.js` and `server.js` is now 1000/1001 for Groq/Gemini, below OpenRouter's priority 0 and configured registry alternatives; explicitly declared registry priorities remain in control.
- `tests/model-provider-fallbacks.test.js` verifies a free tool-capable OpenRouter registry model is attempted after the primary fails and before direct-key providers. `test/server.test.js` verifies registry providers precede direct-key fallbacks in the chat route.
- `.env.example` now notes that Groq's default `openai/gpt-oss-20b` model has per-token pricing and Gemini free-tier access/quotas depend on the account; no keys or paid settings were added.
- CI [run 40953486540](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40953486540), candidate head `4745258bfecb0cd76b2889915d23d587e4a4de44`: 809 tests, 808 passed, 0 failed, 1 skipped; both dependency audits reported 0 vulnerabilities; model picker/selected-provider regression tests, Windows installer parsing and World Intelligence build/bridge passed.
- These are routing regressions with mock credentials/responses. Live provider inference, account quotas and billing behavior remain unverified; no production deployment/configuration was changed.

## Repository-wide JavaScript syntax coverage — 2026-10-30

- Added `scripts/check-source.mjs` and appended it to `npm run check`. It recursively syntax-checks maintained `.js`, `.mjs`, and `.cjs` files with the active Node executable, skips dependency/build/cache/vendor directories and symbolic links, and reports each failing path without invoking a shell.
- Exercised the scanner in an isolated temporary fixture: valid nested JavaScript passed, an intentionally malformed `.mjs` file failed as expected, and invalid JavaScript inside ignored `node_modules` was not scanned. This validates scanner behavior, not the full repository contents.
- Latest completed full CI before this change: [run 40953760423](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40953760423), candidate head `861e863701d256bb2dd0203486d0d6acb8886455`: 809 tests, 808 passed, 0 failed, 1 skipped; all three CI jobs passed; install and production dependency audits reported 0 vulnerabilities.
- The scanner addition is included in candidate head `5b9933fbdac689b7f01554ae851e087334081a06`. Full CI [run 41044428018](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41044428018) completed successfully on this exact head: `npm run check` passed and reported **164 JavaScript source files syntax-checked**; `npm test` reported 809 tests, 808 passed, 0 failed, 1 skipped; local-assistant Python tests, Windows installer parser and World Intelligence build/bridge all passed; both dependency audits reported 0 vulnerabilities.
- No deployment, production setting, database, or PHANTOM/NOX project was changed.

