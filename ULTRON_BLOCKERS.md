# ULTRON AI — Current Release Blockers & External Dependencies

**Audit timestamp:** 2026-11-05 10:40 UTC (16:10 Asia/Kolkata)  
**Production source:** `main` — `573f31f953997cb0e546ef599f77e66cf8f7775b`  
**Render workspace:** `Ultron core`  
**Supabase project:** `opdjfhwepmcprbqojpat` (Mumbai / `ap-south-1`)  
**Scope:** software-only personal intelligent assistant. Physical robot construction and physical HIL are not software release criteria.

> **Release verdict: NOT PRODUCTION-READY.** The primary candidate PR #441 has already merged, but merge status is not production acceptance. Current work remains in review branches and live acceptance gates remain open. No deployment or production migration was performed during this audit.

## 1. Mainline and integration state

- PR [#441](https://github.com/ayaanraza2008/ULTRON-AI/pull/441), previously described in older status documents as an open candidate, was **merged** on 2026-11-04 20:39:39 UTC as merge commit `ad3e6a4326ccbfc1a898855827e937b8b89a4847`.
- Current `main` is `573f31f953997cb0e546ef599f77e66cf8f7775b`. Older references to `b00c2e81...` as current production base and #441 as still open are stale.
- PR [#473](https://github.com/ayaanraza2008/ULTRON-AI/pull/473) is the current consolidated integration candidate: mobile authorization + core action-bound approvals + AppFlowy/Immich owner-scoped private-data read adapters + agent routing/readiness. It is based on current main, head `708ea44f4f2556ea39190a5b412aca49f12441b0`, reported mergeable, and **78 commits ahead / 0 behind at creation**. Exact-head CI run [42012707211](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/42012707211) completed successfully: **1,640 passed, 0 failed, 3 skipped**; syntax 386/386; dependency audit 0 vulnerabilities; World Intelligence build passed. It remains open/unmerged.
- PR [#469](https://github.com/ayaanraza2008/ULTRON-AI/pull/469) contains mobile/core approval hardening and token-redacted, owner-scoped mobile audit history. Its exact head `8e7c593ceebfa4ab66796fbf52ac811057f6fb73` passed [CI run 42010670983](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/42010670983): 1,630 passed, 0 failed, 3 skipped; syntax 386/386; dependency audit 0 vulnerabilities; World Intelligence build passed. It remains open/unmerged. If #473 is selected, do not merge #469 independently.
- PR [#456](https://github.com/ayaanraza2008/ULTRON-AI/pull/456) reconciles local migration filenames with the 15-version remote ledger and moves destructive rollback scripts outside active migrations. Open, mergeable, unmerged. It does not apply SQL to production.
- PR [#460](https://github.com/ayaanraza2008/ULTRON-AI/pull/460) adds redacted Browser Use gateway diagnostics and truthful readiness. Its exact-head CI was reported successful; upstream gateway 502s and Render Chromium configuration drift remain unresolved.
- PR [#467](https://github.com/ayaanraza2008/ULTRON-AI/pull/467) adds worker readiness diagnostics; exact-head CI was reported successful. It does not prove a live task has completed.
- PR [#470](https://github.com/ayaanraza2008/ULTRON-AI/pull/470) hardens paired-device bearer parsing and missing-storage fail-closed behavior; exact-head CI passed. PR #473 also carries forward device/mobile changes; avoid duplicate merges.
- PR [#471](https://github.com/ayaanraza2008/ULTRON-AI/pull/471) fixes worker-smoke authentication for opaque Supabase secret keys. Exact-head CI passed: 1,608 passed, 0 failed, 3 skipped; syntax 386/386; dependency audit 0 vulnerabilities; World Intelligence build passed.
- PR [#466](https://github.com/ayaanraza2008/ULTRON-AI/pull/466) refreshes evidence documentation. Its exact-head CI passed: 1,607 passed, 0 failed, 3 skipped; syntax 386/386; dependency audit 0 vulnerabilities; World Intelligence build passed.
- Repository branch protection is not established: the earlier live query found `main` unprotected and no rulesets. Recheck before release.

## 2. P0 — External owner actions / live acceptance

| ID | Blocker | Evidence | Required closure |
|---|---|---|---|
| P0-01 | Supabase Auth leaked-password protection disabled | Security Advisor reports `Leaked Password Protection Disabled`. | Enable in Supabase Dashboard → Authentication → Attack Protection; verify advisor clears. |
| P0-02 | Live AI inference not accepted | Source-level provider fallback tests do not prove deployed provider credentials or inference. | Configure a valid provider key in Render, then run authenticated live text and vision acceptance. Never put keys in Git or logs. |
| P0-03 | Durable device pairing unavailable in production | Live migration ledger has 15 applied versions; `public.paired_devices` and `public.pending_device_pairings` are absent. | Review backup/rollback, then explicitly authorize and apply the additive paired-device migration followed by telemetry migration. |
| P0-04 | End-to-end live worker task unproven | Read-only live counts showed 0 agent tasks, 0 schedules, 0 memory items, and 0 audit events in the preceding 24 hours. Worker process startup alone is insufficient. | Use an authenticated test account and approved safe task; verify enqueue → claim → execution → persisted result → audit record → owner-scoped readback. |
| P0-05 | Production deployment / Render Blueprint sync not accepted | Four Render services exist; backend services track main while UI has a separate feature branch. Health-check paths are empty in live service metadata. | Review exact service revisions, Blueprint diff, health checks, and rollback plan before an explicitly authorized deploy. |

## 3. P1 — Software and operational work still in review

1. **Consolidated integration PR #473:** complete exact-head CI; inspect all changes, especially current-message private-data consent binding, owner scoping, and mobile approval proof consumption. AppFlowy/Immich calls are mocked in tests; no private live data was accessed.
2. **Migration ledger PR #456:** review migration filename alignment and rollback isolation; confirm exact live ledger again before any SQL action.
3. **Browser Use:** reconcile Render build command with the repository Blueprint's Playwright Chromium installation; diagnose upstream model-gateway 502s separately from local Chromium/CDP failures; require a real end-user browser task before declaring healthy.
4. **Worker:** execute an authenticated, persisted lifecycle smoke only in an isolated or explicitly approved test scope; verify lease renewal, stale recovery, result persistence, and audit events.
5. **Security and governance:** establish branch protection / required CI checks and review ownership; keep all high-risk tools approval-gated.

## 4. Render and telemetry evidence

- The four Render services are in workspace `Ultron core`. A fresh deployment query confirms core, Browser Use, and REA are live on `main` at `573f31f953997cb0e546ef599f77e66cf8f7775b`; the UI is live on `feature/ultron-live-core-interface-20261029` at `32e19e563cd791bdd55db7b668b12101d7a13c6f`. Do not assume a single synchronized release revision. All four have auto-deploy enabled.
- A 24-hour metrics query returned CPU, memory, and bandwidth samples for all four services. HTTP request counts, latency, and instance-count series were empty. This is partial telemetry, not proof of zero traffic.
- Live service health-check paths were empty even though the repository Blueprint specifies paths. Browser Use live build configuration did not fully match the Blueprint's Playwright/Chromium installation requirements.
- No deployment, service configuration mutation, secret update, or production migration was performed in this audit.

## 5. Supabase evidence

- Remote migration history: 15 applied versions, latest `20261027185203_private_document_storage`.
- Paired-device and telemetry migrations exist in source but are not applied to production. Live paired-device tables are absent.
- Read-only counts at the preceding audit: `agent_tasks=0`, `memory_items=0`, `employee_schedules=0`, `audit_events_last_24h=0`, `conversations=1`, `messages=8`.
- RLS was enabled on conversations, messages, memory, and agent tasks with owner-scoped policies observed. This does not replace live two-account acceptance.
- Security Advisor: one warning for leaked-password protection disabled. Performance Advisor: three informational unused-index notices. Do not drop indexes solely because low-volume tables currently show them as unused.

## 6. Release acceptance checklist

- [ ] Exact-head CI green on the selected consolidated PR; no stale-run substitution.
- [ ] Review all approval/consent boundaries and private-data owner scoping.
- [ ] Required branch protection and review policy enabled.
- [ ] Supabase leaked-password protection enabled and rechecked.
- [ ] Paired-device migrations backed up, reviewed, and explicitly authorized before application.
- [ ] Live text and vision inference verified through deployed API.
- [ ] Authenticated live worker task completes with persisted result and audit evidence.
- [ ] Live two-account RLS/API isolation accepted.
- [ ] Browser Use real task succeeds with Chromium and gateway diagnostics.
- [ ] Render Blueprint, health checks, and service revisions reconciled.
- [ ] Explicit release approval obtained before deployment.

**Safety boundary:** CI-green branches may be prepared and reviewed autonomously. Production secrets, production data/schema, PR merges, and Render deployment remain gated by explicit release authorization. Destructive rollback SQL must never be run without verified backup and explicit approval.
