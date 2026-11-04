# Render Blueprint Reconciliation — Live vs Candidate

**Audit date:** 2026-11-03  
**Workspace:** `Ultron core`  
**Canonical status:** `../ULTRON_STATUS.md`  
**Release decision:** NO-GO. This document is read-only evidence. The candidate Blueprint has not been synced.

## Live Render configuration observed

The four existing services were inspected in the Render workspace. Their live metadata reports these branches and deployed commits:

| Existing service | Live branch | Live deployed commit | Live configured `healthCheckPath` | Candidate Blueprint path |
|---|---|---|---|---|
| `ultron-ai-core` | `main` | `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281` | Empty | `/api/health` |
| `ultron-core-interface` | `feature/ultron-live-core-interface-20261029` | `68b042641bc1e4a0ab56953df36637402c47df86` | Empty | `/` |
| `ultron-browser-use-core` | `main` | `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281` | Empty | `/health` |
| `ultron-rea-gateway` | `main` | `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281` | Empty | `/healthz` |

All four services are in the expected workspace. The backend, browser bridge and REA gateway are on `main`; the interface remains on a separate feature branch. The live configuration is therefore not one coherent release candidate.

Render returned no usable CPU, memory, request-count or latency samples during this audit. Empty metrics are classified as `NOT_TESTED`, not as zero usage.

## Live process/log evidence

- Backend logs on 2026-11-03 show `node scripts/start-ultron.mjs`, `ULTRON task worker started`, and `ULTRON AI listening on port 10000`.
- Interface logs on 2026-11-03 show `node core-ui-proxy.mjs` and `ULTRON CORE interface listening on port 10000`.
- These logs prove process startup only. They do not prove authenticated API, browser task, worker queue, or end-user round-trip acceptance.
- Browser bridge logs on 2026-10-31 show repeated `FileNotFoundError: [Errno 2] No such file or directory`, missing local browser binary messages, CDP session recreation failures, and failed agent runs. The live Browser Use service was not operationally verified.

## Candidate Blueprint changes

The candidate `render.yaml` maps the four existing service names and declares:

| Service | Candidate source branch | Candidate health path |
|---|---|---|
| `ultron-ai-core` | `main` | `/api/health` |
| `ultron-core-interface` | `main` | `/` |
| `ultron-browser-use-core` | `main` | `/health` |
| `ultron-rea-gateway` | `main` | `/healthz` |

The Browser Use candidate build command now installs Playwright Chromium with OS dependencies. Its startup probe launches Chromium once; `/health` returns HTTP 503 if Chromium or the configured model gateway is unavailable. CI includes a real Chromium launch test. These are candidate changes only and require latest-head CI confirmation plus later authorized Render verification.

The Blueprint also contains environment-variable references and shared service-token wiring. This is not proof that the live Render secrets are populated correctly. Secret values were not read or exposed during this audit.

## Required release sequence

1. Finish reviewing PR #441 and obtain green CI on the exact final candidate SHA.
2. Review the Blueprint diff against all four existing Render services in the Dashboard.
3. Verify all required environment-variable names and service-to-service token references without exposing values.
4. Confirm that the four health endpoints return healthy responses on the candidate build.
5. Obtain explicit owner approval before syncing the Blueprint or deploying.
6. After authorized deployment, verify deployed SHA, health endpoints, authenticated API round-trip, browser smoke, worker lifecycle and telemetry.
7. Preserve the previous deployment IDs and a rollback path before changing any service.

## Safety constraints

- Do not sync this Blueprint automatically.
- Do not delete, recreate, rename or replace existing services.
- Do not mutate production secrets during audit.
- Do not claim a candidate Blueprint review is a live deployment.
- Do not run production migrations as part of Render sync.
- The existing interface/backend branch mismatch remains a release blocker until reconciled under an approved plan.

See `ULTRON_STATUS.md` for the single evidence-backed acceptance matrix and readiness calculation.
