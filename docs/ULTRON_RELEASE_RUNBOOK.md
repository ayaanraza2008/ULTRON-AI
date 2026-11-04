# ULTRON — RELEASE RUNBOOK (production release: owner-gated)

Nothing in this runbook has been executed against production. Follow strictly, in order.

## Status: PRODUCTION-READY software package ≠ DEPLOYED

## Step 1 — Complete approved PR #441 merge (conditions)
1. Push prepared sync state: `git push origin feat/ultron-final-100-completion` (fast-forward only, no force).
2. Wait for CI green on the exact pushed head.
3. GitHub `mergeable=true`. If still UNKNOWN/CONFLICTING, STOP.
4. `gh pr merge 441 --merge` and record merge SHA.
5. Post-merge: re-run suite on `main`; verify no candidate work lost.

## Step 2 — Supabase (owner)
1. Dashboard → Authentication → Policies: enable **Leaked password protection**.
2. Backup DB (pg_dump or Point-in-Time restore snapshot).
3. Apply migration `20261101180000_durable_paired_devices.sql` (forward-only; reviewed, bounded).
4. Confirm RLS still enforced on `durable_paired_devices` tables; service-role-only mutation paths intact.
5. Verify: signup works, isolation test with two accounts.
6. Rollback if fault: `20261101180000_durable_paired_devices.rollback.sql` — DESTRUCTIVE (drops tables/function). Never run casually; take backup first.

## Step 3 — Render environment (workspace: Ultron core, service: ultron-ai-core)
Required env matrix:
| Variable | Required? | Purpose | Current |
|---|---|---|---|
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | required | auth+DB connection | owner-secrets on Render |
| SUPABASE_ANON_KEY | required | client paths | owner-secrets on Render |
| OPENROUTER_API_KEY | required for brain | free-first provider routing | not set |
| GROQ_API_KEY | optional | secondary free provider | not set |
| CEREBRAS_API_KEY | optional | secondary free provider | not set |
| GEMINI_API_KEY | optional | currently AUTH_FAILED | rotate/replace or unset |
| NODE_ENV | required | must equal `production` | verify |
| PORT | auto | Render injects | verify |

1. Enter/update variables via Render dashboard (never in git).
2. Sync Blueprint (`render.yaml`) and confirm service definition diff contains no unplanned deletions.
3. Manual deploy AFTER credential configuration; confirm `/api/health` 200 and logs show structured boot with request IDs.
4. Rollback: Render → previous deployment.

## Step 4 — Deployment gate
Explicit `DEPLOY` instruction from the owner is required before any production deployment. The above steps prepare deployment; they do not authorize it.

## Step 5 — Post-deploy verification
1. Health + readiness endpoints return 200.
2. Sign up a test account; memory store/recall roundtrip.
3. Task lifecycle: create → execute → cancel; results persist.
4. Provider smoke `npm run smoke:model` from a machine holding the keys.
5. Monitor error rate + memory on the 8 GB-class deployment.

## Rollback plan (whole-release)
1. Render: redeploy previous image.
2. Git: `git revert -m 1 <merge-commit>` on `main` (never force).
3. Supabase: forward-migration rollback file (backup first, destructive).
4. Companion/ADB: unaffected server-side.
