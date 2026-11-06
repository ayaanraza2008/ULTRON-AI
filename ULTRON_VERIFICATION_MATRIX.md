# ULTRON AI — Verification Matrix

| Capability | Automated evidence | Live evidence required | Current disposition |
|---|---|---|---|
| AI brain/provider routing | Provider fallback and brain-router tests | Real authenticated inference | Pending |
| Memory/history | Cognitive-memory and API tests | Cross-restart owner-scoped persistence | Pending |
| Agent orchestration | Agent matrix and lifecycle tests | Real worker result lifecycle | Pending |
| Windows desktop assistance | Windows agent tests and companion build | Physical host pairing and operation | Pending |
| Android companion | Android bridge tests and companion build | Physical handset install/pair/background sync | Pending |
| Browser interface | UI and API route tests | Authenticated browser-to-API E2E | Pending |
| Multi-device state | Manager/persistence tests | Supabase schema, cloud writes, ACK/revoke and restart recovery | Blocked by missing live schema |
| Voice | Voice activation and pipeline tests | Microphone/speaker acceptance | Hardware pending |
| Vision | Vision, OCR and screen-observer tests | Camera/screen acceptance | Hardware pending |
| Security | Secret scanner, SAST, auth and TLS regression tests | Production owner configuration; leaked-password protection warning | Partially verified |

Run every check against the exact current PR HEAD. Do not reuse results from an earlier commit. The current GitHub Actions run is the source of truth for CI.
