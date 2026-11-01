# ULTRON AI — Render Blueprint Reconciliation

**Render workspace:** `Ultron core`  
**Repository:** `ayaanraza2008/ULTRON-AI`  
**Candidate:** [PR #441](https://github.com/ayaanraza2008/ULTRON-AI/pull/441) — open, unmerged  
**Production baseline:** `main` at `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281`

## Current verified service map

The live workspace listing contains exactly these four services:

| Existing service | Service ID | Live branch | Runtime | Current URL / health route |
|---|---|---|---|---|
| `ultron-ai-core` | `srv-dbgrug6c6qcc73cg9cv0` | `main` | Node | `https://ultron-ai-core.onrender.com/api/health` |
| `ultron-core-interface` | `srv-dbh4sfmc6qcc73fs9f10` | `feature/ultron-live-core-interface-20261029` | Node | `https://ultron-core-interface.onrender.com/` |
| `ultron-browser-use-core` | `srv-dbhjre0ae00c73dv6ke0` | `main` | Python | `/health` |
| `ultron-rea-gateway` | `srv-dbhjg5gn74is73e6r2lg` | `main` | Node | `/healthz` |

All four live services were reported as Free plan / Singapore. The REA service's package requires Node `>=24.22.1`; the candidate Blueprint sets Node `24.22.1` for that service.

There is no World Intelligence service in the current `Ultron core` workspace listing. The backend's `WORLD_INTELLIGENCE_URL` is retained as an optional external/legacy endpoint, but this Blueprint does not create or claim to manage that external service.

## What was corrected in candidate `render.yaml`

The candidate Blueprint now defines the four existing service names exactly once and includes:

1. Backend `ultron-ai-core`, Node, `npm install --ignore-scripts` / `npm start`, health `/api/health`.
2. Interface `ultron-core-interface`, Node, `node core-ui-proxy.mjs`, health `/`, targeting `main` after the release is merged.
3. Browser bridge `ultron-browser-use-core`, Python, existing Uvicorn command, health `/health`. Its `ULTRON_BROWSER_USE_TOKEN` uses Render `fromService` wiring to reference the backend service's token; its model gateway URL targets the backend's authenticated internal browser-use proxy.
4. REA gateway `ultron-rea-gateway`, Node `24.22.1`, existing `rea-gateway` build/start commands, health `/healthz`, and a generated `REA_MCP_TOKEN`.

The backend now has a generated dedicated `ULTRON_DEVICE_SIGNING_SECRET` declaration for the Supabase-backed device token encryption. The REA validator was corrected to accept Render's generated standard Base64 token format as well as URL-safe tokens.

The old duplicate `ultron-world-intelligence`, `ultron-world-intelligence-globe`, and `ultron-world-intelligence-live` service declarations were removed from this workspace's Blueprint. The deprecated Fish Audio environment declarations were also removed.

## Important release and sync conditions

**This Blueprint has not been synced. No Render service has been changed or deployed.**

- The candidate `ultron-core-interface` definition points to `main`; the current live interface service still points to the older feature branch. Do not sync until PR #441 is reviewed and merged by the owner, or an explicit staging plan is approved.
- Keep existing environment values. Secret entries remain `sync: false` where the owner must supply them; the browser bridge shares its backend token using `fromService`.
- The new generated device signing secret only becomes present in Render after an approved Blueprint sync. The Supabase migration `20261101180000_durable_paired_devices.sql` is not applied to production.
- The paired-device routes therefore return a storage-not-ready/configuration error until the migration and secret are applied intentionally.
- The REA token is generated only when the Blueprint is synced. Existing service secrets are not revealed or copied into this document.
- The `WORLD_INTELLIGENCE_URL` value is kept for compatibility, but the referenced service is not part of the verified four-service workspace map.

## Validation evidence and limitation

- The service IDs, names, branches, runtimes, build/start commands and health routes above were checked against the live Render workspace service records and repository source.
- The current Render JSON Schema was inspected for service, health check, region, plan, environment-variable, `generateValue`, and `fromService.envVarKey` fields.
- Repository regression tests now enforce the four-service map, health paths, browser token wiring, REA settings, generated signing secret, and absence of retired Fish Audio/duplicate World Intelligence declarations.
- A Render CLI `render blueprints validate` run was not available in this environment; therefore this is schema-reviewed and CI-tested, not claimed as a CLI validation result.

## Deployment safety

No Blueprint sync, deployment, plan upgrade, production secret mutation, database write, or Supabase migration was performed. Manual sync remains an owner-approved production change.
