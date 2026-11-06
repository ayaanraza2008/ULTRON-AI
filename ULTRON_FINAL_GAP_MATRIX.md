# ULTRON AI — Final Gap Matrix

| Domain | Source state | Acceptance status | Next proof |
|---|---|---|---|
| AI brain/provider routing | Implemented with automated tests | Live inference not verified | Authenticated completion through a configured provider and fallback test |
| Memory/history | APIs and persistence code exist | Cloud durability not verified | Owner-scoped write/read/restart recovery against the configured database |
| Agents/workers | Task lifecycle and worker code exist | Live worker completion not fully verified | Queue, lease, retry, cancellation and result retrieval in the configured runtime |
| Windows desktop | Agent and native companion source/build exist | Physical host not accepted | Pair a real Windows companion and verify allowlisted operations |
| Android companion | Bridge and native companion source/build exist | Physical handset not accepted | Install, pair, background sync, ACK and reconnect on a real device |
| Browser interface | Separate interface service and API surfaces exist | Live authenticated E2E not fully verified | Login, chat, memory and event stream against the current API |
| Multi-device | Registry, queues, ACK and persistence code exist | Shared cloud state blocked by missing schema | Apply reviewed schema, then test concurrent clients and recovery |
| Voice | Voice pipeline and tests exist | Hardware acceptance pending | Real microphone/speaker test with permission and interruption checks |
| Vision | Vision/screen modules and tests exist | Camera/screen acceptance pending | Real camera and screen input test with privacy masking |
| Security | TLS, owner-gating and automated scans exist | Supabase advisor has a plan-level warning | Verify exact-head scans and retain the disclosed free-plan limitation |
| Release | PR candidate and CI pipeline exist | Not production-ready | Exact-head CI, review, owner authorization and release checklist |

No aggregate percentage is published. Implementation, automated tests, live services and physical-client acceptance are separate evidence classes.
