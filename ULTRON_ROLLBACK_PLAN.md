# ULTRON AI — EMERGENCY ROLLBACK PLAN & RESTORATION RUNBOOK

- **Repository:** `ayaanraza2008/ULTRON-AI`
- **Current Development Branch:** `feat/ultron-operation-infinity-multidevice`
- **Base Stable Commit (on `main`):** `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281`
- **Render Service Base:** `ultron-ai-core` on Render Workspace `Ultron core`

---

## 1. Safety Principles & Data Protection

1. **Non-Destructive Principle:** Rollbacks must NEVER delete existing user data, conversation histories, or user preferences in the live Supabase project.
2. **Authorization Boundary:** Rollbacks on production require explicit operator confirmation.
3. **Audit Trail:** Every rollback action must be recorded in `audit_events` or release changelogs.

---

## 2. Codebase Rollback Scenarios

### Scenario A: Local Development Branch Reversion
If an uncommitted or local experimental change causes instability on `feat/ultron-operation-infinity-multidevice`:
```powershell
# Discard working tree changes cleanly
git restore .
git clean -fd

# Reset branch to last verified remote commit
git fetch origin feat/ultron-operation-infinity-multidevice
git reset --hard origin/feat/ultron-operation-infinity-multidevice
```

### Scenario B: Production Render Rollback (Post-Deploy)
If an authorized deployment to Render exhibits regressions in production:
1. **Instant Render Revert (Zero Downtime):**
   - Go to Render Dashboard -> `Ultron core` -> `ultron-ai-core`.
   - Under the **Deploys** tab, locate the prior stable deploy commit.
   - Click **Rollback to this deploy**. Render immediately re-routes live traffic to the previous healthy container.
2. **Git Branch Revert:**
   ```powershell
   git checkout main
   git revert -m 1 <merge-commit-sha>
   git push origin main
   ```

---

## 3. Database Migration Rollback

The 5 applied multi-device migrations have corresponding non-destructive rollback definitions located in `supabase/rollback/`:

```
+----------------------------------------------------+----------------------------------------------------+
| Active Migration                                   | Rollback Script                                    |
+----------------------------------------------------+----------------------------------------------------+
| 20261101180000_durable_paired_devices.sql          | 20261101180000_durable_paired_devices.rollback.sql |
| 20261104110000_paired_device_telemetry.sql         | 20261104110000_paired_device_telemetry.rollback.sql|
| 20261106120000_ultron_multidevice_state.sql        | 20261106120000_ultron_multidevice_state.rollback.sql|
| 20261106130000_atomic_multidevice_state_writes.sql | DROP FUNCTION IF EXISTS save_ultron_multidevice_state|
| 20261106130200_paired_device_online_requires_heartb| Restores NOT NULL constraints if desired           |
+----------------------------------------------------+----------------------------------------------------+
```

> [!CAUTION]
> Applying table-drop rollbacks to `paired_devices` or `ultron_multidevice_state` will revoke active companion sessions. Do NOT run table-drop rollbacks unless a catastrophic schema conflict occurs.

---

## 4. Verification Check After Rollback

After any rollback execution:
1. Probe health endpoint:
   ```powershell
   curl.exe -i https://ultron-ai-core.onrender.com/health
   ```
2. Run syntax and security audits:
   ```powershell
   npm run check
   npm run security:report
   ```
3. Run core unit tests:
   ```powershell
   npm test
   ```
