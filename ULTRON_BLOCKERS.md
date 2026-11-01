# ULTRON AI — Active Blocker & Dependency Register

**Audit date:** 2026-11-01  
**Verified code commit:** `e54103f27f2034ca4e890a24879fbc1cd96018d6`  
**PR:** [#440](https://github.com/ayaanraza2008/ULTRON-AI/pull/440) — open, unmerged  
**Rule:** Never paste secrets into chat or commit them. Use a protected environment/secret manager. Do not buy a paid plan or change production state without owner approval.

| Priority | Area | Current truth | What closes it |
|---|---|---|---|
| P0 | Live text inference | Automated tests pass, but no current genuine live model response is evidenced. Previous model smoke reported no eligible/working provider. | Configure a free/approved provider securely; run `npm run smoke:model`; retain only redacted status evidence. |
| P0 | Vision / EYES | Vision adapter fails closed; live smoke previously required `OPENROUTER_API_KEY`. | Configure an eligible vision provider securely; run the real image-Q&A smoke with a synthetic, non-sensitive image. |
| P0 | Worker execution | Worker implementation/CI tests pass; a live task executed by a provider and persisted to Supabase is not verified. | Use a disposable test identity, secure service credentials, and `ULTRON_CONFIRM_WORKER_SMOKE=YES`; verify insert, claim, completion and cleanup. |
| P0 | Two-user RLS | One live Supabase isolation test is skipped in CI. | Two disposable Auth users and `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES`; verify cross-user read/write denial. |
| P0 | Supabase leaked-password protection | Prior Security Advisor inspection showed the platform setting disabled. App-side HIBP checks are supplemental and do not enable the platform control. | Review the Auth setting and current plan in Supabase Dashboard; enable only if available/approved. No plan upgrade was made. |
| P1 | Windows companion | .NET 8 x64 build/publish passes CI. Actual installed daemon, microphone, wake word, language recognition and harmless PC-control round-trip are unverified. | Install the CI artifact on the target Windows PC; pair with a dedicated secret; verify Hindi/English/Hinglish and allowlisted actions. |
| P1 | Kokoro speech | Kokoro integration and fail-closed diagnostic tone handling exist. This CI run does not prove genuine speech on the target PC. | Verify the real ONNX runtime, model and `am_onyx` voice files on the user's PC; capture a redacted pass/fail and intelligibility result. |
| P1 | Durable device hub | Encrypted local-file persistence is implemented/tested when explicitly enabled. Render volume persistence and restart recovery are unverified. | Provision durable storage and a dedicated random `ULTRON_DEVICE_SIGNING_SECRET`; verify restart, owner isolation, rotation and revocation. |
| P1 | Browser automation | Python bridge suites and safe action gates pass CI. Live paired-browser E2E is not evidenced. | Pair a disposable browser session; test navigation/DOM extraction; verify approval gating for consequential actions. |
| P1 | Coding sandbox | Fail-closed tests and Docker isolation options exist. Actual Docker runtime isolation on the target host is unverified. | Run harmless isolation tests on a host with Docker; verify resource, filesystem and network boundaries. |
| P1 | Media | Real FFmpeg-generated MP4 fixture and multi-track audio mixing (music + voiceover ducking + AAC stream export) verified in unit/integration test. Full user-selected footage workflow with live GUI picker remains to be exercised in browser session. | Disposable user-provided clip and audio tracks render dual-stream MP4 with verified AAC and H.264 streams; verified locally. |
| P1 | Frontend/backend release | Render backend is on `main`; frontend is on a separate feature branch; this PR is not deployed. No full authenticated staging E2E is evidenced. | Align revisions in staging; run sign-in, chat, voice, memory, tasks, files and device flows end-to-end. |
| P1 | Render observability | Service records report live, but metrics were empty and log retrieval returned 503; no HTTP health-check path is configured. | Restore log/metrics visibility; define and verify a fast readiness endpoint; exercise real requests and inspect runtime logs. |
| P2 | Robotics/HIL | CPU-friendly simulation/model export and training scenario code exist. Physical robot/HIL and external simulator fidelity are not verified. | Validate exported assets in the intended USD/robotics simulator; test ROS/HIL only on dedicated hardware in a safe lab. |
| P2 | External integrations | Register contains native, adapter, partial and reference-level entries. A listed adapter is not proof of a live round-trip. | Verify each intended integration with a real, scoped test and label it by maturity/evidence. |

## Verified software hardening added in this audit

- Recon no longer labels caller-supplied ports as `OPEN` or claims a valid TLS 1.3 certificate without a handshake.
- Scanner/Web audit findings carry caller-evidence provenance and a not-independently-verified status.
- Empty scan input is `NOT_ASSESSED`, never `SECURE`.
- Fish Audio will not activate from a leftover key alone; explicit `ULTRON_ENABLE_FISH_AUDIO=true` is required.

## Do not call these blockers resolved

A passing unit test is not a live model response. A Windows build is not a physical microphone test. A worker process starting is not proof of task execution. An encrypted local file is not proof of durable Render storage. A simulation model is not a physically trained robot.
