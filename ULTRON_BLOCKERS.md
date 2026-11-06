# ULTRON AI — Remaining Acceptance Blockers

**Development PR:** [#478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478)  
**Branch:** `feat/ultron-operation-infinity-multidevice`  
**Release decision:** Not ready for production merge/deployment.

## Scope boundary

Physical robotics, simulation, actuation and robot hardware are excluded. The PR removes the dedicated robotics implementation, routes, device type and robotics-specific tests. Browser, Windows, Android, AI, voice, vision and multi-device software remain in scope.

## P0 — Software release gates

| Blocker | Current state | Required evidence |
|---|---|---|
| Exact-head CI | A benchmark-source syntax defect and a stale test assertion were found and corrected in this PR. | All required GitHub Actions checks green on the latest PR head, including tests, syntax, security and both companion builds. |
| Durable cloud persistence | Candidate adapter, migration and 6-point automated persistence tests exist. | Live authenticated write/read/version/ACK/revoke/restart test with `cloudPersisted: true` after authorized migration. |
| Live AI inference | Protected acceptance test and candidate-branch manual workflow exist. | Successful genuine inference and fallback using the protected repository secret; no secret values in logs. |
| Owner-only configuration | Owner gating code and automated tests exist. | Verify production owner identity, signup restrictions and non-owner rejection without exposing secrets. |

## P1 — Integration acceptance

- Verify browser, Windows and Android pairing, synchronization, acknowledgements, reconnect and revoke.
- Install and exercise companion applications on supported Windows and Android devices.
- Verify real microphone, speaker, camera and screen-observation permissions.
- Confirm external provider failures are surfaced honestly and never represented as successful execution.

## External plan limitation

Supabase leaked-password protection is reported unavailable on the connected Free plan. No paid upgrade is authorized. Record this as an accepted external limitation unless the owner chooses a plan change.

## Release lock

Do not merge PR #478, deploy to Render, change production environment variables, sync a production Blueprint or apply production migrations until the owner explicitly authorizes release with `DEPLOY`.
