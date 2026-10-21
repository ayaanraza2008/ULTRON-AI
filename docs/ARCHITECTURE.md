# ULTRON AI Architecture

## Target architecture
- Web UI: responsive client with chat, explicit voice states, connection status, and feature panels.
- API server: server-side provider adapter, validation, rate limits, timeout/cancellation handling, health/readiness endpoints, structured logs.
- Provider gateway: NaraRouter OpenAI-compatible API at `https://router.bynara.id/v1`; keep API key exclusively server-side.
- Persistence: PostgreSQL/Supabase after a dedicated project decision; use migrations and user-scoped access. Do not connect to a differently named project without explicit confirmation.
- Windows companion: lightweight client sharing the backend, with visible microphone state and explicit desktop automation permissions.
- Optional services: voice, document parsing, web research, image/video generation, and desktop automation behind replaceable adapters; heavyweight inference must not run by default on the 8 GB RAM client.

## Initial request flow
1. Browser submits a bounded message to the server.
2. Server validates payload and configured model.
3. Server forwards the request to NaraRouter using a server-only Bearer key.
4. Server streams validated text deltas to the browser where supported.
5. Browser renders the response and exposes recoverable errors.

## Security boundaries
- Provider secrets never reach browser code, local storage, public logs, or error responses.
- Treat uploaded documents and retrieved web pages as untrusted content.
- No arbitrary shell/file-system execution through the public web API.
- Authentication and authorization must be enforced server-side before personal memory or cross-device data is enabled.
- Desktop actions use least privilege, confirmation for consequential actions, audit events, and an emergency stop.

## Deployment
The repository currently has no linked Render service. Deploy only after the server and build checks pass, using a newly configured ULTRON service or another explicitly selected host. Do not repoint another application's Render service by default.
