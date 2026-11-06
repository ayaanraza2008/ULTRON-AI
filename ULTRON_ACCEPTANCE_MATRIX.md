# ULTRON AI — Acceptance Matrix

**Candidate:** PR #478 — `feat/ultron-operation-infinity-multidevice`  
**Decision:** Not yet accepted for production release.

| Area | Software acceptance | Live acceptance |
|---|---|---|
| AI inference | Unit/provider routing tests | Authenticated provider completion required |
| Memory/history | API and unit tests | Owner isolation and restart durability required |
| Agents/workers | Lifecycle and permission tests | Real queue execution and result retrieval required |
| Windows | Source tests and CI build | Physical pairing and supported OS action outcomes required |
| Android | Source tests and CI build | Physical installation, permissions and background behavior required |
| Browser | UI/API route tests | Authenticated live interface and event stream required |
| Multi-device | Queue/ACK/persistence tests | Shared cloud schema and cross-client delivery required |
| Voice | Pipeline and activation tests | Real microphone/speaker acceptance required |
| Vision | OCR/scene/screen tests | Real camera/screen acceptance required |
| Security | Automated scans and authorization tests | Production owner configuration and Supabase plan warning review required |

## Acceptance rules

- Builds are not physical-device acceptance.
- Mocks are not live-service acceptance.
- A successful network write is not an application-level ACK.
- Local file fallback is not cloud durability.
- A green health endpoint is not proof of inference, memory or device operation.

Keep production deployment locked until every applicable release gate is satisfied or explicitly recorded as an accepted limitation by the owner.
