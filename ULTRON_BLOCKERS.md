# ULTRON AI — Active Blocker & Dependency Register

**Audit date:** 2026-11-01 (Asia/Kolkata)  
**Candidate:** [PR #441](https://github.com/ayaanraza2008/ULTRON-AI/pull/441) — OPEN, NOT MERGED  
**Current branch head:** `14edc33ec5ba446280201c3adea10f0144e89980`  
**Last green code/test checkpoint:** `a3917b6e535147f08343053920c691af008ac0df`  
**Production base:** `main` at `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281`

**Safety rule:** Do not paste secrets into chat or commit them. Do not buy paid plans, write to production data, apply the Supabase migration, sync Render, merge or deploy without explicit owner approval.

| Priority | Area | Verified current truth | What still closes it |
|---|---|---|---|
| P0 | Live text inference | No current genuine live model completion is evidenced. Health/configuration flags are not inference proof. | Run `npm run smoke:model` with an approved provider secret and retain redacted result evidence. |
| P0 | Vision / Eyes | Vision adapter/tests exist; live image-Q&A is not verified. | Run `npm run smoke:vision` with an approved vision provider and synthetic non-sensitive image. |
| P0 | Worker execution | Worker logic and deterministic tests pass; live provider execution and Supabase persistence are not verified. | Execute a bounded disposable-user worker smoke; verify insert, claim, completion and cleanup. |
| P0 | Two-user RLS | The live two-account E2E remains the one skipped test. | Use two disposable Auth accounts and the explicit write gate; test cross-user reads/writes and cleanup. |
| P0 | Supabase Auth security | Security Advisor reports leaked-password protection disabled. | Review the Supabase Auth setting/plan and enable only with owner approval. |
| P1 | Device pairing code | Owner create/list/rotate/revoke APIs, one-time claim RPC, token hash verification, Windows DPAPI and Android Keystore storage are implemented and automated-tested in PR #441. | Apply migration `20261101180000_durable_paired_devices.sql` and provision `ULTRON_DEVICE_SIGNING_SECRET` through approved Render/secret-manager workflow; then test live pair/claim/revoke. |
| P1 | Device storage | Paired-device metadata/token hashes are designed for Supabase; pending credentials are AES-GCM encrypted. Production schema is not installed. | Apply reviewed migration with approval, verify RLS/owner isolation and restart behaviour. |
| P1 | Kokoro speech | Browser tries Kokoro `am_onyx` only when the backend confirms genuine audio; diagnostic tone is rejected and browser voice is fallback. | Install/verify ONNX runtime and model files on target Windows host or approved server; test intelligible speech, interrupt and fallback. |
| P1 | Fish Audio retirement | Active frontend calls no Fish endpoint; backend config always disables legacy Fish TTS/STT even if old key/flag exist; candidate Blueprint has no Fish env entries. | Remove any unused legacy provider constants/dead compatibility code in a later safe cleanup only if tests/other clients prove no dependency. |
| P1 | Windows companion | Pairing UI, DPAPI storage and current per-device authentication are implemented. CI x64 compile/publish passed. | Install artifact on actual Windows PC; test microphone, wake word, language recognition, pairing and harmless approved action round-trip. |
| P1 | Android companion | Pairing UI, Android Keystore storage and explicit on-device dictation command flow implemented. CI APK build/upload passed. | Install on physical Android device; verify permissions, foreground wake service, Hindi/English recognition, pairing and safe command response. |
| P1 | Browser automation | Python bridge/policy tests pass; paired browser runtime E2E remains unverified. | Pair a disposable browser session; test navigation/DOM extraction and consequential-action approval gating. |
| P1 | Coding sandbox | Fail-closed tests and Docker isolation options exist; target-host container isolation is unverified. | Run harmless resource/filesystem/network isolation checks on a dedicated Docker host. |
| P1 | Render Blueprint | Candidate maps the four live Ultron core services, correct URLs/health routes, shared browser token and generated secrets; no sync has happened. | Owner review and manual Blueprint validation/sync only after PR merge or approved release. |
| P1 | Render observability/staging | Render log/metrics retrieval did not provide enough evidence for full authenticated E2E; production frontend remains on old branch. | Restore visibility, sync only after approval, and run authenticated staging flows. |
| P1 | Third-party dependencies | Pinned World Intelligence build passes, but external source dependency install reports five high-severity advisories. ULTRON runtime audit reports zero. | Obtain package-level advisory details and review compatible fixes; never blind-run `npm audit fix`. |
| P1 | Media workflow | FFmpeg fixture-to-MP4 tests pass; full user-selected source video/audio workflow is not accepted end-to-end. | Test user-provided clips, audio tracks, voiceover and H.264/AAC playback in browser UI. |
| P2 | Robotics / HIL | CPU-friendly simulation/export source exists; external simulator fidelity and physical HIL are not verified. | Validate exported assets in intended simulator; test ROS/HIL only in a controlled lab. |
| P2 | External integrations | Registry includes native, adapter, partial and reference-level maturity. | Run scoped live round-trip tests for each integration actually intended for production. |

## Latest automation evidence

- [ULTRON CI run 41339384666](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41339384666): 1,255 tests, 1,254 passed, 0 failed, 1 skipped; syntax 318/318; runtime npm audit 0; configured security gate 0 confirmed findings.
- [Android Companion run 41339216276](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41339216276): debug APK compile and upload passed.
- [Windows Companion run 41339216284](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41339216284): x64 compile, standalone publish and upload passed.
- Current docs-only branch head `14edc33` has a new CI/build cycle in progress.

The skipped test is live two-account Supabase isolation. A passing test is not a live provider response. A compiled companion is not proof of installation or physical microphone behaviour. A migration file is not an applied production schema. A Blueprint file is not a synced deployment.
