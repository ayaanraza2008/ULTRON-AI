# ULTRON AI — Remaining Blockers

**Development PR:** [#478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478)  
**Branch:** `feat/ultron-operation-infinity-multidevice`  
**Release decision:** Not ready for production merge/deployment.

| Priority | Blocker | Evidence needed to close |
|---|---|---|
| P0 | Supabase schema is behind the repository | Apply and verify the reviewed pending migrations only after explicit production authorization. The connected project currently lacks `paired_devices`, `pending_device_pairings`, and `ultron_multidevice_state`. |
| P0 | Cloud persistence is not yet proven | Confirm successful Supabase REST/PG writes, reads, ACKs and revocations; restart the service and prove recovery from shared storage rather than local file fallback. |
| P0 | Live AI inference | Complete an authenticated generative request through a configured provider and verify bounded fallback. |
| P0 | Owner-only production configuration | Verify personal mode, owner ID, signup restrictions and non-owner rejection without revealing secret values. |
| P1 | Cross-client state protocol | Verify browser, Windows and Android receive/apply/ACK, retries, reconnect, revoke and owner isolation. |
| P1 | Windows/Android hardware acceptance | Install and pair each companion on a real device; verify the supported operations and their acknowledgements. |
| P1 | Voice and vision acceptance | Verify real microphone, speaker, camera and screen-observation flows on supported clients. |
| P1 | Auth leaked-password protection | Supabase advisor reports this disabled. Supabase currently requires Pro or above; organization is Free. Keep this as a disclosed plan limitation unless the owner approves a paid change. |
| P2 | Exact-head release verification | All CI workflows, security checks and final diff review must pass on the exact candidate HEAD. |

## Completed source-scope cleanup

The product code no longer includes the dedicated simulation/hardware-control package, routes or device type. A regression test prevents those surfaces from returning. This cleanup does not change the Windows, Android, browser, AI, voice, vision or multi-device product goals.

## Release lock

Do not merge PR #478 into `main` or deploy to Render. The backend tracks `main` with automatic deploy enabled. Production schema changes and deployment remain locked until explicit `DEPLOY` authorization.
