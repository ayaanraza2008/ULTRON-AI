# ULTRON continuation checkpoint

Updated: 2026-10-31 UTC (PR #430 feature checkpoint)

## Current repository state

- Project: `ayaanraza2008/ULTRON-AI`; preserve the existing ULTRON architecture and history.
- Default branch: `main`; current head: `92158d843e29c123f81e4c7a61cd88f462c2b58c`.
- PR #425 updated the evidence checkpoint; PR #426 merged owner-scoped Hermes native Runs support as `145ac4e648b0ce4bd7805e3420d4ddc92345b665`; PR #424 merged Harness2 executor hardening as `e608485b609e7d8f51d93dd4d033e636efd44975`; PR #428 merged the latest evidence checkpoint as `92158d843e29c123f81e4c7a61cd88f462c2b58c`.
- Main CI run [41173509393](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41173509393) passed `npm run check`, `npm test`, Python Browser Use/Harness2/Model Lab checks, dependency advisory reporting, and the pinned World Intelligence build.
- All Render calls were restricted to the **Ultron core** workspace. Render reports `ultron-ai-core`, `ultron-rea-gateway`, and `ultron-browser-use-core` live at exact main commit `92158d8` in the **Ultron core** workspace (deploys `dep-dbinue7avr4c73ba5t9g`, `dep-dbinue7avr4c73ba5t5g`, `dep-dbinue7avr4c73ba5t0g`).
- Production-revision health/config/exact-revision workflow [41172839283](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41172839283) passed for prior commit `145ac4e`; it has not yet been rerun for `92158d8`. Do not report that earlier check as proof for the later commit.
- PR #430 is a draft feature branch (`feature/scoped-approvals-and-code-sandbox-20261031`, open draft PR #430). It adds task-bound browser approvals, an opt-in restricted Docker Python runner, and a Hermes Windows setup/pairing runbook. ULTRON CI [41177558254](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41177558254) and Chrome bridge CI [41177558269](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41177558269) passed at code commit `1d35e1e`; subsequent branch changes are documentation-only. PR #430 has not been merged or deployed.
- Separate `ultron-core-interface` service remains live on `feature/ultron-live-core-interface-20261029` at `68b042641bc1e4a0ab56953df36637402c47df86`. It is an installable PWA shell; authenticated chat, voice and physical-device E2E remain unverified.
- Render log retrieval returned 503 and direct public-host resolution was unavailable in this execution environment. Render deployment status and GitHub CI are available evidence, but they do not prove every external integration works.

## Merged engineering improvements

### Hermes native Runs — PR #426

- Added owner-scoped native Runs submission, status polling, bounded cooperative stop handling, session-key hashing, and a redacted read-only smoke command.
- Corrected bracketed IPv6 host normalization; tests reject public IP-literal endpoints while preserving trusted local loopback and prevent fallback replay after an ambiguous/failed run submission.
- CI passed on the exact PR head before merge; merged as `145ac4e`.
- Hermes remains **disabled by default**. A secured reachable Hermes endpoint, credentials, owner UUID and a live smoke test are still required. A cloud service cannot reach the user's PC `localhost`; local PC automation requires an installed companion and authenticated network ingress.

### Harness2 executor hardening — PR #424

- Bounded captured CLI stdout to 1 MB and stderr to 64 KB while draining pipes; output floods terminate the child process and timeouts remain bounded.
- OpenCode tool permission is deny-by-default; Codex is read-only/ephemeral. Benchmark/answer schemas are strictly validated, atomic writes avoid planted temporary symlinks, and resume recovers a saved candidate after interruption.
- Merged as current `main` head `e608485`; the Harness2 tests passed in CI run `41173106830`.
- Real OpenCode/Codex use still requires locally installed CLIs and local authentication. The deterministic no-credential demo is not model-quality evidence or general autonomous execution.

### Existing safety improvements retained

- OpenSEO spend authority comes from the authenticated user's current prompt and bounded credit cap, not model-supplied approval fields.
- Chrome DevTools model self-approval is blocked. PR #430 adds an owner-bound one-use approval phrase, read-only inspection, target revalidation, and request-level risk propagation; this is source-tested but not merged or live-device verified. Its challenge store is process-local, so horizontal scaling requires a shared atomic store.
- Geo-Sleuth reverse-image sharing is opt-in from an exact current-user attestation; model-generated flags do not authorize external image sharing.
- Voice cloning derives consent from an exact current-user attestation. Source regression tests passed in current main CI; live VoiceStudio profile creation remains unverified.

## Supabase read-only audit (2026-10-31)

- Dedicated `ULTRON-AI` project is `ACTIVE_HEALTHY` in `ap-south-1`.
- Core account data tables have RLS enabled; `anon` has zero table-level grants on the public schema checked.
- Private document bucket `ultron-private-documents` is not public and has a 5 MiB object cap; owner-scoped storage policies and private-document migration history are present.
- Security Advisor reports **Leaked Password Protection disabled**. This requires the project owner to enable the Auth setting in Supabase; the current connected tools do not expose that setting. No database data or Auth settings were changed during this audit.

## Remaining acceptance gates

1. Live OpenRouter-compatible text and vision inference using authorized provider credentials; test model compatibility and fallback.
2. Supabase signup/sign-in, recovery email/reset and two-account conversation/message/memory isolation E2E. Enable leaked-password protection first.
3. Controlled queued task execution through a real worker, provider response, persisted result, retry/cancel and audit trail.
4. Memory preference-off, recall, expiry, deletion and cross-account isolation with dedicated test users.
5. Real Hindi/English STT/TTS and vision calls; verify audio quality, consent, latency and provider failure handling.
6. Install and pair Android/Windows companions on real devices; validate wake/stop, sleep/reboot, authentication, allowlisted actions and emergency-stop behavior. Full PC control is not yet implemented.
7. Configure and smoke-test Hermes only after a secured endpoint and owner scope are available. Keep arbitrary shell and consequential actions gated.
8. PR #430 adds a restricted Docker Python sandbox with CPU/memory/time, filesystem/network restrictions and bounded output; it remains disabled until host isolation, image provenance and daemon cleanup are verified.
9. Run an approved outbound DNS-pinned transport check and real local Chrome/device E2E. PR #430 has a task-bound browser approval implementation, but keep the local bridge gate off until physical E2E and single-instance/shared-store constraints are resolved.
10. Validate each upstream integration's credentials, licenses, hardware, quotas and real behavior. Do not spend paid credits without an explicit user cap.

## Next actions

- Prioritize the real provider + two-account Auth/RLS + worker task acceptance tests using dedicated test identities.
- Enable Supabase leaked-password protection through the project owner's Auth settings and confirm the Security Advisor clears.
- Then complete speech/vision, Hermes local-agent pairing, physical-device checks, and isolated sandbox work.
- Keep Render operations restricted to the **Ultron core** workspace. Do not silently change secrets, plans, Auth settings, paid quotas or consequential integrations.
- Update this checkpoint and the acceptance matrix only from exact commit, workflow, deployment and end-to-end evidence. Do not publish an aggregate completion percentage where the external gates are not measured.
