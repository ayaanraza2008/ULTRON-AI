# ULTRON AI — Active Blocker & Dependency Register

**Audit date:** 2026-11-01 (Asia/Kolkata)  
**Candidate:** [PR #441](https://github.com/ayaanraza2008/ULTRON-AI/pull/441) — OPEN, NOT MERGED  
**Audited implementation checkpoint:** `3336a99b492014c661a54f9b315400bbb81c6b45`  
**Production baseline:** `main` at `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281`

**Rule:** Never paste secrets into chat or commit them. Use protected repository/service secrets. Do not buy a paid plan, run production writes, apply database migrations, merge, or deploy without explicit owner approval.

| Priority | Area | Verified current truth | What closes it |
|---|---|---|---|
| P0 | Live text inference | No current genuine live model completion is evidenced. Health/configuration flags are not inference proof. | Run `npm run smoke:model` with an approved free/owner-approved provider credential; retain redacted response evidence. |
| P0 | Vision / Eyes | Adapter and tests exist; live image-Q&A is not verified. | Run `npm run smoke:vision` with an approved vision provider and a synthetic non-sensitive image. |
| P0 | Worker execution | Worker logic and deterministic tests pass; real provider execution and Supabase task persistence are unverified. | Execute a bounded disposable-user worker smoke, verify insert/claim/completion/cleanup, and keep secrets in CI/service secret storage. |
| P0 | Two-user RLS | The live two-account E2E is the one skipped test. Existing RLS inspection is not a substitute. | Use two disposable Auth accounts and the explicit write gate; verify cross-user reads/writes fail and cleanup succeeds. |
| P0 | Supabase Auth security | Security Advisor reports leaked-password protection disabled. App-side screening does not enable the platform setting. | Review the Supabase Auth setting and plan availability; enable only with owner approval. |
| P1 | Gesture runtime | PR #441 source path is now wired and automated checks pass. Physical camera/browser MediaPipe load and core response have not been tested on the target PC. | Test explicit camera permission, MediaPipe model load, one/two-hand gestures, stop/retry and CPU fallback on the target browser. |
| P1 | Kokoro / free speech | UI currently uses browser-installed speech by default. Kokoro adapter is not wired as the active speech service; missing runtime/model produces a diagnostic tone, not speech. | Wire a supported local Kokoro runtime, install verified model/voice files on the target PC, and test intelligible `am_onyx` speech plus interrupt/fallback. |
| P1 | Fish Audio removal | Backend compatibility code remains but requires explicit `ULTRON_ENABLE_FISH_AUDIO=true`; Fish-labelled frontend compatibility code/copy remains. | Remove the unused Fish UI/client path after the free speech replacement is accepted; verify no Fish requests are made in the default configuration. |
| P1 | Device pairing | DeviceHub is a local prototype and is not mounted in `server.js` or `integrations/router.js`. New Supabase migration is unapplied. No live owner-authenticated pairing API is proven. | Implement reviewed authenticated routes, rate-limits, expiring/single-use pairing, revocation and durable storage; apply migration only after separate approval and run owner-isolation/restart E2E. |
| P1 | Durable device storage | Render disk persistence and restart recovery are unverified; local encrypted JSON tests do not prove production durability. | Configure approved persistent storage and a dedicated random `ULTRON_DEVICE_SIGNING_SECRET`; test restart, owner isolation, rotation and revocation. |
| P1 | Windows companion | .NET x64 build/publish passes CI. Installed daemon, microphone, wake word, language recognition, pairing and harmless PC action round-trip are unverified. | Install the CI artifact on the target Windows PC; test microphone consent, Hindi/English/Hinglish, pairing and allowlisted actions. |
| P1 | Android companion | Source/policy tests exist; install and live on-device recognition/pairing are unverified. | Build/install on a test Android device and verify permission, foreground notification, stop control and paired safe action. |
| P1 | Browser automation | Python bridge/policy tests pass; authenticated paired-browser E2E is not evidenced. | Pair a disposable browser session; test navigation/DOM extraction and verify consequential actions remain approval-gated. |
| P1 | Coding sandbox | Fail-closed tests and Docker isolation options exist; actual Docker runtime isolation on the target host is unverified. | Run harmless resource, filesystem and network boundary tests on a dedicated Docker host. |
| P1 | Render reconciliation | Live service names/branches differ from candidate `render.yaml`; candidate also contains duplicate World Intelligence service definitions. | Reconcile service IDs/names/branches with the existing Ultron core workspace; review a non-destructive Blueprint diff before any sync. |
| P1 | Render observability / staging | Deploy metadata exists, but logs/metrics did not give enough evidence for authenticated full-stack acceptance. Backend and frontend run different source revisions. | Align revisions in a staging service, configure readiness/observability, and test sign-in, chat, voice, memory, tasks, files and devices. |
| P1 | Third-party World Intelligence build | Pinned external God’s Eye source build passes but reports 5 high-severity dependency advisories. ULTRON runtime `npm audit` is clean. | Obtain package-level audit details and a reviewed compatible upstream fix; do not run blind `npm audit fix`. |
| P1 | Media workflow | FFmpeg fixture-to-MP4 test passes; full user-selected source video/audio workflow is not accepted end-to-end. | Verify a disposable source clip with multiple audio tracks, voiceover, export and H.264/AAC playback in the actual UI. |
| P2 | Robotics / HIL | CPU-friendly simulation/model export code exists; external physics fidelity and physical robot/HIL are not verified. | Validate exported assets in the intended simulator; test ROS/HIL only in a dedicated, safe lab. |
| P2 | External integrations | Catalog entries include native, adapter, partial and reference-level maturity. Listing an integration does not prove a live round-trip. | Run a scoped smoke for each integration intended for production and label it by observed maturity/evidence. |

## Fixes already committed to PR #441

- Module-script loading for the ES-module gesture engine.
- Explicit user-operated hand-control toggle.
- Reuse of the approved Eyes camera stream and correct stream ownership.
- Single-pass gesture recognition with a single callback.
- Correct mapping for two-hand distance and horizontal direction events.
- Explicit CSP allowlist for the pinned MediaPipe runtime/WASM/model hosts.
- Removal of fabricated skin-centroid hand landmarks; unavailable inference now fails closed.
- Regression tests for the above paths.

## Latest automation

- [ULTRON CI run 41336219872](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41336219872): 1,250 Node tests, 1,249 passed, 0 failed, 1 skipped; syntax 318/318; runtime audit 0; configured security gate 0 findings.
- [Windows Companion run 41336219867](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41336219867): x64 build/publish passed.
- The skipped Node test is live two-account Supabase isolation.
- The separate external World Intelligence source build reports 5 high-severity dependency advisories.

A passing unit test is not a live provider response. A Windows build is not a physical microphone test. A device migration file is not an active pairing service. A local storage test is not proof of Render durable storage. A simulation export is not a physically trained robot.
