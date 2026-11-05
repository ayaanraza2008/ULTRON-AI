# ULTRON AI — RELEASE RUNBOOK & ROLLBACK PROCEDURES
## Production Release 1.0 Candidate Specification and Operational Runbook

**Date:** 2026-11-06  
**Repository:** `ayaanraza2008/ULTRON-AI`  
**Production Target:** Render Core (`https://ultron-ai-core.onrender.com`)  
**Living Core UI:** Render Web (`https://ultron-core-interface.onrender.com`)  
**Database Backend:** Supabase PostgreSQL  
**Current PR:** [#478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478) (`feat/ultron-operation-infinity-multidevice` → `main`)  
**Deployment Lock:** **LOCKED — AWAITING OPERATOR COMMAND `DEPLOY`**

---

## 1. RELEASE SPECIFICATION & BASELINE

### Candidate Identity
- **Release Version:** 1.0.0-rc.infinity
- **Branch:** `feat/ultron-operation-infinity-multidevice`
- **Target Release Branch:** `main`
- **Quality Gate Status:** PASSED (388/388 files clean, 0 security findings, 246 test suites green)
- **Robotics Excluded:** 0% weight, strictly omitted from scope

---

## 2. STRICT DEPLOYMENT LOCK DECLARATION

> [!CAUTION]
> **PRODUCTION DEPLOYMENT LOCK IS IN EFFECT.**
> To prevent unintentional disruptions to live services or databases, NO automated merge to `main`, NO live database migrations, NO Render blueprint deployments, and NO production secret modifications will occur until the user inputs the exact literal command:
>
> ```
> DEPLOY
> ```
>
> All preparation, validation, and verification steps are complete and ready for instant execution once unlocked.

---

## 3. PRE-DEPLOYMENT VERIFICATION CHECKLIST

Before executing the release, the operator must verify:

- [x] Syntax check clean across all files (`node scripts/check-syntax.mjs` → 388/388).
- [x] Master security scan clean (`npm run security:report` → 0 vulnerabilities, 0 findings).
- [x] Multi-device test suite passed (`node --test tests/multidevice-operation-infinity.test.js` → 15 passed).
- [x] Multi-device persistence & scale tests passed (`node --test tests/multidevice-persistence.test.js` → 7 passed).
- [x] Worker & AI Employee test suite passed (`node --test tests/employees.test.js tests/worker.test.js` → 140 passed).
- [x] Render core production endpoint responding (`GET https://ultron-ai-core.onrender.com/api/health` → HTTP 200).
- [x] Render web interface responding (`GET https://ultron-core-interface.onrender.com/` → HTTP 200).
- [x] Android Companion APK built successfully in CI.
- [x] Windows Companion C# executable built successfully in CI.

---

## 4. STEP-BY-STEP DEPLOYMENT PROCEDURE (UPON `DEPLOY` COMMAND)

When the explicit literal command **`DEPLOY`** is received, execute the following sequence:

### Step 1: Merge PR #478 to `main`
```bash
git checkout main
git pull origin main
git merge --ff-only feat/ultron-operation-infinity-multidevice
git push origin main
```

### Step 2: Continuous Integration Build Verification
- Monitor GitHub Actions for commit on `main`.
- Confirm `build-android-companion`, `build-windows-companion`, and `test` workflows complete green.

### Step 3: Render Deployment Trigger
Render is configured for auto-deployment on `main` push:
- Monitor Render deployment logs for service `Ultron core`.
- Verify build command completes: `npm install --omit=dev`.
- Verify start command starts server: `node scripts/start-ultron.mjs`.

### Step 4: Live Health & Capability Verification
Execute live HTTP probes against production:
```bash
# 1. Health Probe
curl -sS https://ultron-ai-core.onrender.com/api/health
# Expected: {"status":"healthy","providerConfigured":true,"accessConfigured":true}

# 2. Capabilities Inventory Probe
curl -sS https://ultron-ai-core.onrender.com/api/capabilities
# Expected: JSON catalog of registered tools and permissions

# 3. Multi-Device Fleet Status Probe
curl -sS https://ultron-ai-core.onrender.com/api/jarvis/status
```

---

## 5. COMPREHENSIVE ROLLBACK RUNBOOK

If any post-deployment anomaly, unhandled regression, or latency degradation is observed, follow this rollback procedure immediately:

### 5.1 Fast Production Rollback (< 2 Minutes)
1. Navigate to the Render Dashboard: **Render → `Ultron core` → Deploys**.
2. Select previous stable deployment (Commit `9c72bb6f` / `25b66fd7`).
3. Click **Rollback to this deploy**.
4. Render immediately switches traffic to the previous container image without rebuilding.

### 5.2 Git Repository Rollback
```bash
# Revert the merge commit on main
git checkout main
git pull origin main
git revert -m 1 HEAD --no-edit
git push origin main
```

### 5.3 Database Schema Rollback (If Required)
If database migrations require rollback, apply the non-destructive rollback scripts located in `supabase/rollback/`:
- `supabase/rollback/20261104110000_paired_device_telemetry.rollback.sql`
- `supabase/rollback/20261101180000_durable_paired_devices.rollback.sql`
- `supabase/rollback/20261106000000_multidevice_state_persistence.rollback.sql`

> [!WARNING]
> Database rollbacks are explicitly labeled DESTRUCTIVE if they drop tables. Rollback scripts must NEVER use `DROP TABLE ... CASCADE` to prevent collateral data loss in linked user records.

---

## 6. POST-DEPLOYMENT MONITORING & ESCALATION

- **Render Service Monitoring:** Check memory usage (< 512MB) and response latency (< 500ms).
- **Supabase Pooler:** Verify connection pool count and CPU usage.
- **Incident Escalation:** If Render service restarts exceed 3 in 10 minutes, trigger Fast Rollback immediately.
