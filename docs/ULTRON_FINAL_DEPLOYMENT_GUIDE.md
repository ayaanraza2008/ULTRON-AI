# ULTRON AI — Final Deployment Guide
## Production Deployment Runbook for Render Workspace: 'Ultron core'

---

## 1. Prerequisites & Environment Verification
- **Render Workspace:** `Ultron core` exclusively
- **Target Backend Service:** `ultron-ai-core`
- **Target Frontend Service:** `ultron-core-interface`
- **Production Branch:** `main` (Requires explicit operator approval before merging PR #440)
- **Supabase Project:** `opdjfhwepmcprbqojpat` (Region: `ap-south-1` Mumbai)

## 2. Pre-Deployment Quality Gates (Must All Pass)
1. `node scripts/check-syntax.mjs` (303/303 files verified clean)
2. `npm test` (1,162 tests passing, 0 failures)
3. `npm run security:report` (0 confirmed vulnerabilities, quality gate PASSED)
4. `node scripts/check-windows-companion.mjs` (5/5 checks passed)
5. `gh pr checks 440` (5/5 GitHub Actions CI workflows green)

## 3. Deployment Steps (Upon Operator Approval)
1. **Merge PR #440:**
   ```bash
   gh pr merge 440 --squash --body "Merge feat/ultron-cyber-core into main: Complete 56-repository integration, HEI, companion bridge, and security hardening"
   ```
2. **Trigger Render Deployment:**
   - In Render Dashboard under workspace `Ultron core`:
     - Select service `ultron-ai-core` -> Manual Deploy -> Deploy latest commit.
     - Select service `ultron-core-interface` -> Manual Deploy -> Deploy latest commit.
3. **Post-Deployment Health Checks:**
   - Verify Backend: `curl -f https://ultron-ai-core.onrender.com/api/health`
   - Verify Frontend: `curl -f https://ultron-core-interface.onrender.com`
   - Verify World Intelligence Bridge postMessage handshake.
