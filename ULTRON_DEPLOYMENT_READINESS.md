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

- Render workspace `Ultron core` contains the backend and related services.
- The connected Supabase project `ULTRON-AI` is ACTIVE_HEALTHY in Mumbai (`ap-south-1`), under the Free organization plan.
- The remote migration ledger currently ends at `20261027185203_private_document_storage`.
- The live schema lacks `paired_devices`, `pending_device_pairings`, and `ultron_multidevice_state`.
- Candidate migrations now define the paired-device registry, telemetry fields and REST multi-device state table. They have **not** been applied to production.
- Supabase security advisor reports leaked-password protection disabled; the current plan does not include this feature. No paid upgrade is authorized.

## Required before release

1. Review and apply the pending migrations only after explicit owner authorization.
2. Verify cloud persistence and recovery across service restart; confirm no fallback file is mistaken for cloud durability.
3. Complete authenticated live AI inference and owner-isolation checks.
4. Complete browser, Windows and Android end-to-end pairing, sync, ACK, reconnect and revoke checks.
5. Complete physical companion and real voice/vision acceptance.
6. CI/security checks passed green on candidate commit `104e09cbe0e3167fb214e7e8bdad4abcafea3017` across all 6 PR workflows.
7. Review rollback procedure and confirm the production revision.

Do not merge, deploy, change production environment variables, sync a production Blueprint or apply production migrations until the owner explicitly issues `DEPLOY`.
