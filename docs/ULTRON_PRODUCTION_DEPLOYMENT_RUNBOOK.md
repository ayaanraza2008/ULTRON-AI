# ULTRON Production Deployment Runbook (Phase 24 gate)

- **Deploy trigger:** the literal owner phrase `DEPLOY` — nothing else.
- **Deployment is NOT authorized by this document's existence.**

## Pre-deploy checklist (re-verify on the day)

1. `gh pr view 441` → merged, or merged-equivalent state on `main`; if not, complete Phase 22 first.
2. `main` HEAD SHA recorded: `git rev-parse origin/main`.
3. CI green on `main` (`test`, `world-intelligence-build`).
4. `npm test` green on `main` locally (record totals; do not hide skips).
5. `npm run check` → 384+/384+ clean.
6. Security suite green (`node --test tests/*security*` plus scanner audit).
7. Owner credentials configured in **Render Dashboard** (`Ultron core` workspace): OpenRouter key or valid AI Studio key; Supabase service role/publishable keys; `APP_ACCESS_PASSWORD`.
8. Supabase: **separately authorized** production application of the two pending migrations, in order:
   1. `20261101180000_durable_paired_devices.sql`
   2. `20261104110000_paired_device_telemetry.sql`
   Rollback files exist for safety (`*.rollback.sql`) but are destructive and require their own authorization.
9. Backup/rollback plan acknowledged (Render rollback to previous deploy; Supabase PITR or snapshot before migration).

## Deploy sequence

1. Confirm exact release: `git rev-parse origin/main` matches the approved SHA.
2. Render Dashboard → `ultron-ai-core` → Manual Deploy (or blueprint sync ONLY after dashboard diff review, per `render.yaml` header).
3. Watch deploy logs: build `npm install --ignore-scripts` must finish with 0 blocking errors; boot shows structured startup with request IDs; port bind OK.
4. Verify (public, read-only):
   - `GET https://ultron-ai-core.onrender.com/api/health` → HTTP 200; `build.commit` == released SHA.
   - `GET /` → interface service responds (cold start can take tens of seconds on free plan; retry once before treating failure).
   - `/api/runtime/readiness` (authenticated) → configured vs. verified capabilities.
5. Functional smoke, in order: authentication → submit one trivial message → provider responds (real inference; the phase-23 `NO_ELIGIBLE_PROVIDER` path must NOT be the observed outcome) → memory persistence check → one safe read-only tool task.
6. Inspect logs for errors/regressions for a full interval.

## Failure procedure

- Stop further risky changes.
- Preserve Render logs (download before retry).
- Render → Rollback to the previous deploy (pre-authorized procedure).
- If migration-related: migrations are NOT auto-applied by Render; any rollback is a separately authorized action per `*.rollback.sql` cautions.
- Report actual status only; never declare success before step 5 passes.

## Owner-side actions summary (current blockers)

| # | Action | Gate it clears |
|---|---|---|
| 1 | Merge PR #441 in GitHub UI (mergeable=UNKNOWN anomaly) | Phase 22 |
| 2 | Replace host/Render Gemini credential with an `AIzaSy…` AI Studio key (or add OpenRouter/Groq key) | Live AI round-trip |
| 3 | Provide Supabase dashboard access/token; enable Leaked Password Protection; authorize the 2 migrations | Supabase readiness |
| 4 | Send `DEPLOY` | Phase 24 |
