# ULTRON AI — Deployment Readiness

**Render workspace:** `Ultron core`  
**Backend service:** `ultron-ai-core`  
**Backend branch:** `main`  
**Auto-deploy:** Enabled  
**Current candidate:** PR #478 — `feat/ultron-operation-infinity-multidevice`

## Decision

**NOT READY FOR PRODUCTION MERGE OR DEPLOYMENT.**

The backend service auto-deploys commits to `main`. Merging the candidate could therefore trigger a production deployment. Keep PR #478 open and unmerged until the owner explicitly authorizes release.

## Verified infrastructure observations

- Render workspace `Ultron core` contains the backend, interface, browser bridge and research gateway services.
- The backend and companion services are on Render Free plans.
- The connected Supabase project is active in Mumbai and its organization is on the Free plan.
- The connected Supabase schema currently lacks the companion registry and multi-device state tables expected by the candidate.
- Supabase's security advisor reports leaked-password protection disabled; Supabase documents this feature as Pro and above. No paid upgrade is authorized.

## Required before release

1. Review and apply the pending database migrations only after explicit owner authorization.
2. Verify cloud persistence and recovery across service restart.
3. Complete live AI inference and owner-isolation checks.
4. Complete browser, Windows and Android end-to-end sync/ACK checks.
5. Complete physical companion and supported voice/vision acceptance.
6. Pass all CI/security checks on the exact final candidate HEAD.
7. Review rollback procedure and confirm the production revision.

Do not merge, deploy, change production environment variables, sync a production Blueprint or apply production migrations until the owner explicitly issues `DEPLOY`.
