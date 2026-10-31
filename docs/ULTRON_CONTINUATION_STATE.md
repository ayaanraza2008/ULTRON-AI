# ULTRON continuation checkpoint

Updated: 2026-10-31 UTC

## Current repository state

- Project: `ayaanraza2008/ULTRON-AI`; preserve the existing ULTRON architecture and history.
- Default branch: `main`; current head verified in GitHub and Render: `a9dd9dd772214d60acdd0acdfc9112c50d206836`. The JARVIS review branch is separate; do not treat its commits as deployed.
- PR #426 merged owner-scoped Hermes native Runs support as `145ac4e648b0ce4bd7805e3420d4ddc92345b665`; PR #424 merged Harness2 executor hardening. PR #434 merged the manual worker-acceptance workflow and documentation into `main`, creating current head `a9dd9dd772214d60acdd0acdfc9112c50d206836`.
- Current `main` head `a9dd9dd` passed [CI run 41187893581](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41187893581), including test and pinned World Intelligence build. JARVIS review-branch head `f6d8c18ac2d97717f56c60d7add31847ca724701` passed [CI run 41188047166](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41188047166): `npm run check`, 709 passed / 0 failed / 1 skipped, and pinned World Intelligence build. Android and Windows builds for `f6d8c18` were still running at this checkpoint; both previously passed and produced artifacts at branch SHA `21f847cf`.
- All Render calls were restricted to the **Ultron core** workspace. Render reports `ultron-ai-core`, `ultron-rea-gateway`, and `ultron-browser-use-core` live at `main` commit `a9dd9dd`. `ultron-core-interface` remains a separate PWA service.
- Production-revision health/config/exact-revision workflow [41172839283](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41172839283) passed only for prior commit `145ac4e`; no exact-revision production verification for `a9dd9dd` has been confirmed.
- Separate `ultron-core-interface` service remains live on `feature/ultron-live-core-interface-20261029` at `68b042641bc1e4a0ab56953df36637402c47df86`. It is an installable PWA shell; authenticated chat, voice and physical-device E2E remain unverified.
- Render log retrieval returned 503 and direct public-host resolution was unavailable in this execution environment. Render deployment status and GitHub CI are available evidence, but they do not prove every external integration works.


## Resumed engineering update (2026-10-31)

- JARVIS × ULTRON review is tracked by [PR #431](https://github.com/ayaanraza2008/ULTRON-AI/pull/431), which remains open against `main`. [PR #432](https://github.com/ayaanraza2008/ULTRON-AI/pull/432) was squash-merged into the PR #431 feature branch, not into `main`.
- The hardening requires Supabase authentication plus the configured owner UUID, removes the pass-through auth default, disables normal Node child-process execution in both the HTTP route and helper, blocks placeholder “executed” task results, disables mock device/smart-home endpoints, labels reminders as process-memory-only, corrects server telemetry, and fixes a path-prefix traversal bug.
- The JARVIS feature branch CI at `f6d8c18ac2d97717f56c60d7add31847ca724701` passed run `41188047166` with 709 passing tests, 0 failing, 1 skipped, and the pinned World Intelligence build. Android and Windows build jobs for that exact SHA were still running at the checkpoint. Both companion artifacts were already built successfully on branch SHA `21f847cf`; those are compile/artifact evidence, not physical-device E2E.
- Both Windows and Android wake companions now open `https://ultron-core-interface.onrender.com/` instead of the retired `ultron-ai-zvd7` host. Regression coverage checks their target origin. The Windows companion is a wake-word launcher, not a Windows command-execution bridge; the Android companion is a local wake notifier, not full remote-phone control.
- Backend OpenRouter request metadata and the World Intelligence frame-ancestor setting in the JARVIS feature branch now use the current Core interface origin. The `scripts/model-vision-smoke.mjs` Referer was also corrected and added to the origin regression test; these changes remain on the unmerged JARVIS branch.
- [PR #433](https://github.com/ayaanraza2008/ULTRON-AI/pull/433) adds PWA proxy tests for same-origin session cookie forwarding, cookie-domain rewriting, pinned World Intelligence routing, and fail-closed paths. Its CI run `41187366080` passed. It remains open against the PWA feature branch; do not merge/deploy it implicitly.
- [PR #434](https://github.com/ayaanraza2008/ULTRON-AI/pull/434) was merged to `main` as `a9dd9dd`. The manual **ULTRON Live Worker Acceptance** workflow requires repository secrets `ULTRON_SMOKE_SUPABASE_SERVICE_ROLE_KEY` and `ULTRON_SMOKE_USER_ID`, plus a manual YES. CI run `41187572722` passed. The workflow has not been dispatched and no live task has been completed by it.
- Important correction: merging PR #434 unexpectedly triggered Render auto-deploy on the API service even though the PR only changed `.github/workflows/worker-live-acceptance.yml` and `docs/WORKER_LIVE_ACCEPTANCE.md`. Deploy `dep-dbir30jncjis73cte3ug` went live at `a9dd9dd` at 09:15:30 UTC on 2026-10-31. The deployment built successfully, reported zero npm vulnerabilities, and startup logs show the worker started and API listened. No application JavaScript, migrations, Render env values, Supabase Auth settings, schema, or user data were changed by that commit. The connector has no cancel-deploy action; no rollback or second deploy was initiated.

## Latest acceptance checkpoint (2026-10-31)

This block supersedes older JARVIS feature-head/test-count entries earlier in this continuation file.

- JARVIS PR #431 remains open against main at feature head `645c6c73fb8083548c26664ac622d442fbe6a298`. PR #432 hardening is merged into PR #431's feature branch only.
- CI run `41190064315` passed on that head: syntax gate, 715 passing tests, 0 failing, 1 skipped, pinned World Intelligence build passed. Android `41190064400` and Windows `41190064298` builds also passed and produced debug APK and x64 EXE artifacts. These are build artifacts only, not installation/pairing tests.
- JARVIS now queues only bounded owner-scoped employee plan/draft/review/report work through the existing Supabase worker; it exposes persisted owner-scoped list/detail, audit attempts, and policy-compliant status-only emergency cancellation. Arbitrary per-agent tool steps and code execution remain disabled. Queue acceptance returns QUEUED/202, not task completion.
- Computer workspace rejects existing symlink path components and uses no-follow final opens where available. This is not a general execution sandbox or proof against all filesystem races.
- PWA task drawer PR #439 (head `d3aff371d1b4a9304cb057401ee320b143b7bb40`) passed CI `41189957770`: 574 passed / 0 failed / 1 skipped and pinned build. It is open against the PWA feature branch and depends on PR #431.
- PWA proxy PR #433 (`41187366080`), provider acceptance PR #435 (`41188372014`), voice-language PR #436 (`41188780119`), Fish TTS PR #437 (`41188751437`), and two-account Auth/RLS acceptance PR #438 (`41188938512`) passed CI. All remain open; provider/Auth live workflows have not run.
- Live provider inference, two-account Auth E2E, actual worker task completion, and physical device installation/pairing remain unverified. Required GitHub Actions secrets are documented in `docs/BLOCKERS.md`; never paste secret values in chat.
- Render main remains `a9dd9dd772214d60acdd0acdfc9112c50d206836` in Ultron core. The PR #434 auto-deploy is documented above; no further deployment was initiated.

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
- Chrome DevTools model self-approval is blocked. Consequential external clicks remain disabled until task-bound user approval exists.
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
8. Build an isolated coding sandbox with CPU/memory/time, filesystem/network restrictions, auditing and explicit approvals before executing generated code.
9. Run an approved outbound DNS-pinned transport check and browser/device E2E. Keep consequential browser actions disabled until task-bound approval tokens exist.
10. Validate each upstream integration's credentials, licenses, hardware, quotas and real behavior. Do not spend paid credits without an explicit user cap.

## Next actions

- Prioritize live provider inference and two-account Auth/RLS E2E. For worker completion, add the two dedicated GitHub Actions secrets documented in PR #434 and dispatch its plan-only smoke workflow; never use a personal account or expose secrets in chat.
- Enable Supabase leaked-password protection through the project owner's Auth settings and confirm the Security Advisor clears.
- Then complete speech/vision, Hermes local-agent pairing, physical-device checks, and isolated sandbox work.
- Keep Render operations restricted to the **Ultron core** workspace. Do not silently change secrets, plans, Auth settings, paid quotas or consequential integrations.
- Update this checkpoint and the acceptance matrix only from exact commit, workflow, deployment and end-to-end evidence. Do not publish an aggregate completion percentage where the external gates are not measured.
