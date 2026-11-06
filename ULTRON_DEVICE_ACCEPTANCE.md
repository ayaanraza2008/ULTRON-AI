# ULTRON AI — Device Acceptance Matrix

**Date:** 2026-11-06  
**Repository:** `ayaanraza2008/ULTRON-AI`  
**Development PR:** [#478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478)  
**Status:** Software candidate; physical-device acceptance remains pending.

## Platform matrix

| Platform | Implemented surface | Software/build evidence | Remaining acceptance |
|---|---|---|---|
| Windows PC/laptop | Companion pairing, system telemetry, allowlisted app launch, tracked task inspect/stop | Node tests and Windows companion CI build | Install on a real Windows host; pair; verify permissions, acknowledgements, task exit and emergency stop. |
| Android phone/tablet | Companion pairing, state polling, local state storage, background worker and ACK | Android companion CI build and Kotlin source review | Install on a real device; verify pairing, runtime permissions, background restrictions, reconnect and ACK-after-write. |
| Web browser | Owner-authenticated command center, device pairing, SSE/WebSocket surfaces | UI and route tests | Verify browser login, live state updates, reconnect, revoke and multi-tab behavior against the deployed API. |
| Multi-device fleet | Device registry, presence, capability routing, queued delivery and versioned shared state | Unit/integration tests | Verify concurrent clients, stale-device expiry, owner isolation and durable recovery across service restart. |

## Acceptance rules

- A successful Windows or Android build is not physical-device acceptance.
- A mocked adapter is not proof of a live transport.
- A successful socket write is not an application-level ACK.
- A health endpoint response is not proof of working chat, memory, inference, or device control.
- Unavailable clients and providers must return explicit errors; they must never report fabricated success.

## Release decision

Do not mark the platform matrix fully accepted until the physical and end-to-end checks above are performed. Keep the production release locked until the owner explicitly authorizes it.
