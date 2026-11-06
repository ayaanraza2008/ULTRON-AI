# ULTRON AI — Remaining Blockers

**Development PR:** [#478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478)  
**Branch:** `feat/ultron-operation-infinity-multidevice`  
**Release decision:** Not ready for production merge/deployment.

## Live evidence checked

- Connected Supabase project `ULTRON-AI` (`opdjfhwepmcprbqojpat`) is ACTIVE_HEALTHY in `ap-south-1`.
- Its applied migration ledger currently ends at `20261027185203_private_document_storage`.
- Its public schema currently does not contain `paired_devices`, `pending_device_pairings`, or `ultron_multidevice_state`.
- Supabase security advisor reports leaked-password protection disabled.
- Latest PR CI passed 100% green across all 6 workflow checks on commit `104e09cbe0e3167fb214e7e8bdad4abcafea3017` (including `20261106120000_ultron_multidevice_state.sql` and migration ledger tests).

| Priority | Blocker | What is done | Evidence still required |
|---|---|---|---|
| P0 | Supabase schema drift | Candidate branch contains durable paired-device and telemetry migrations; added `20261106120000_ultron_multidevice_state.sql` for the REST adapter's actual table contract, with service-role-only grants and RLS. | Review and apply the ordered migrations to the connected project only after explicit production authorization; then verify the remote migration ledger and tables. |
| P0 | Cloud persistence/recovery | 6-point verification battery implemented and verified in `tests/multidevice-persistence.test.js` (write, read, version update, revocation, unauthorized rejection, and restart recovery). REST/PG adapters explicitly distinguish `cloudPersisted: true` from mock/local fallback. Migration `20261106120000_ultron_multidevice_state.sql` defines private table contract. | Authenticated live write/read/ACK/revoke and restart recovery must prove `cloudPersisted: true` against production Supabase after authorized migration application. |
| P0 | Live AI inference | Protected live-inference test `tests/live-inference-acceptance.test.js` verified (zero-leakage, genuine inference, fallback, and clean unconfigured blocking). Workflow `.github/workflows/model-live-acceptance.yml` updated to support manual execution directly on `feat/ultron-operation-infinity-multidevice` without requiring prior merge. | Trigger manual acceptance workflow with protected `ULTRON_OPENROUTER_API_KEY` repository secret on branch. |
| P0 | Owner-only production configuration | Owner gating code and tests exist. | Verify deployed personal-mode settings, owner identity, signup restrictions and non-owner rejection without exposing secret values. |
| P1 | Cross-client protocol | Pairing, state sync, ACK/retry/revoke code and automated tests exist. | End-to-end acceptance across browser, Windows and Android against the live schema and service. |
| P1 | Windows/Android hardware acceptance | Companion CI builds pass on the previously verified candidate. | Install, pair and exercise the Windows executable and Android APK on actual devices; verify background/reconnect behavior. |
| P1 | Voice and vision acceptance | Software adapters and CI checks exist. | Test real microphone, speaker, camera and screen permissions on supported hardware. |
| P1 | Auth leaked-password protection | Security advisor confirms it is disabled; connected organization is Free. | Requires an eligible paid Supabase plan. No upgrade authorized; remains an accepted external plan limitation. |
| P2 | Exact-head verification | CI passed green on commit `104e09cbe0e3167fb214e7e8bdad4abcafea3017` across all 6 PR checks (Windows companion, Android companion, World Intelligence, and push/PR test suites). | Software gate passed. External physical hardware and production release authorization (`DEPLOY`) remain pending. |

## Completed source-scope cleanup

The dedicated physical robotics/simulation implementation, routes and device type are excluded from the software product scope. A regression test guards this boundary. Windows, Android, browser, AI, voice, vision and multi-device software capabilities remain in scope.

## Release lock

Do not merge PR #478 into `main` or deploy to Render. The backend tracks `main` with automatic deploy enabled. Production schema changes and deployment remain locked until the owner explicitly authorizes them with `DEPLOY`.
