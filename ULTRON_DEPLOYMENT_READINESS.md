# ULTRON AI — Deployment Readiness

**Render workspace:** `Ultron core`  
**Backend service:** `ultron-ai-core`  
**Backend branch:** `main`  
**Auto-deploy:** Enabled  
**Candidate:** [PR #478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478)

## Decision

**NOT READY FOR PRODUCTION MERGE OR DEPLOYMENT.**

Merging this candidate may automatically deploy the backend to Render. Keep PR #478 open and unmerged until the owner explicitly authorizes release.

## Release gates

1. All required CI workflows must pass on the exact latest PR head.
2. Review candidate Supabase migrations and apply them only after explicit owner authorization.
3. Verify live authenticated cloud persistence, version conflict handling, acknowledgements, revocation and restart recovery.
4. Complete genuine live AI inference and automatic provider fallback acceptance.
5. Verify owner-only production configuration and account isolation.
6. Complete browser, Windows and Android pairing/synchronization acceptance.
7. Complete voice and vision acceptance on supported devices.
8. Review rollback procedure and verify the production revision before any authorized release.

## Known infrastructure constraints

- Candidate Supabase migrations have not been applied to production.
- Live schema/persistence acceptance therefore remains blocked.
- Supabase leaked-password protection is reported unavailable on the current Free plan; no paid upgrade is authorized.
- Automated builds and unit tests do not prove live cloud behavior or physical companion operation.

## Authorization boundary

Do not merge, deploy, change production environment variables, sync a production Blueprint or apply production database migrations until the owner explicitly issues `DEPLOY`. Engineering review, source fixes, branch commits and non-production verification may continue without that release authorization.
