# ULTRON — PRODUCTION BLOCKERS (live verified 2026-11-04)

Each blocker lists the exact actor required to clear it. No blocker is silently worked around.

## B1 — PR #441 mergeability unknown
- GitHub reports `mergeable=UNKNOWN` even though the PR head merges cleanly into `main` locally (verified via `git merge --no-commit --no-ff fetch(pull/441/head)` on a scratch branch — clean).
- **Action:** owner push the reviewed sync state (commits `0b72a258`, merge `3eb00b80`) to `feat/ultron-final-100-completion` (already prepared locally; fast-forward, no force). GitHub recomputes mergeability and CI runs on the new head. Merge is executed only when `mergeable=true` and required checks are green.

## B2 — Supabase production security
- Leaked Password Protection: reported disabled historically; **cannot be verified without Supabase dashboard access.**
- Migration `supabase/migrations/20261101180000_durable_paired_devices.sql` reviewed but NOT applied to production.
- **Owner action:** enable Leaked Password Protection in Dashboard → Auth; apply the single forward migration; keep the destructive rollback file never executed against prod (backup first regardless).

## B3 — AI provider credentials
| Provider | Env var | Status |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | NOT_CONFIGURED on host |
| Groq | `GROQ_API_KEY` | NOT_CONFIGURED |
| Cerebras | `CEREBRAS_API_KEY` | NOT_CONFIGURED |
| Gemini | `GEMINI_API_KEY` | SET but AUTH_FAILED (HTTP 401 — invalid key) |

- **Owner action:** rotate/obtain a valid Gemini key or remove it, and provide OpenRouter (+optional Groq) keys as Render env vars. No provider responds today; fallback chain cannot be exercised live.

## B4 — Render deployment configuration
- Workspace `Ultron core`, service `ultron-ai-core`, URL `https://ultron-ai-core.onrender.com` exist as config references; **no Render API/Dashboard credentials on this host**, so service state cannot be inspected live.
- **Owner action:** verify env matrix (see release runbook), sync blueprint, health-check `/health`.

## B5 — Physical device acceptance
- `adb.exe` / Android device: NOT connected → mobile physical acceptance impossible.
- Windows companion executable not installed on host → desktop acceptance impossible.
- Microphone/speaker/camera physical verification NOT performed.
- These are hardware-gated and cannot be claimed from software tests.

## B6 — Direct Chromium/CDP genuine control
- `direct-chromium-driver.js` currently executes navigation via bounded HTTP fetch (labeled `HTTP_FETCH_PREVIEW` honestly) and reports `simulated: true` for interaction methods instead of fabricating success.
- Real CDP control (launch host Edge/Chromium headless, WebSocket DevTools, Page.navigate/Runtime.evaluate via Node 24 built-in WebSocket) is the next implementation step. Antigravity-era fabricated success results were REMOVED.

## B7 — Skipped tests (6, all environment-gated, documented)
1. coding-sandbox.test.js — Docker daemon unavailable on host (CI-only execution).
2. computer-device.test.js — symlink creation privilege unavailable.
3. paired-device-migration.test.js — no real PostgreSQL on host.
4. supabase-isolation-real-pg.test.js — no real PostgreSQL on host.
5. worker-queue-lifecycle.test.js — no real PostgreSQL on host.
6. worker-runtime-process.test.js — no real PostgreSQL on host.
All execute automatically in Docker-backed CI environments.

## Non-blockers (resolved this session)
- EGO-Lite SSRF contradiction: loopback now strictly test-only (`allowTestLoopback`), cloud metadata + RFC1918 + `0.0.0.0` unconditionally blocked.
- Truthful driver attribution inserted across registry wrappers (never label HTTP preview as Ego Lite or as real CDP).
- TaskSpace cleanup by-name resolution fixed (`finish`/`getTaskSpace`).
- tool-registry wrapper returns `success: true` restored for `windows_display_brightness` (get), `system_hardware_monitor`, `browser_url_normalizer`.
