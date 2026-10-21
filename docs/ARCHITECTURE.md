# ULTRON AI Architecture

## Target architecture
- Web UI: responsive client with chat, explicit voice states, connection status, and feature panels.
- API server: server-side provider adapter, validation, rate limits, timeout/cancellation handling, health/readiness endpoints, structured logs.
- Provider gateway: NaraRouter OpenAI-compatible API at `https://router.bynara.id/v1`; keep API key exclusively server-side.
- Persistence: dedicated Supabase project `ULTRON-AI`, ref `opdjfhwepmcprbqojpat`, region `ap-south-1`. Initial schema is applied; app integration and authenticated user mapping remain to be implemented.
- Windows companion: lightweight client sharing the backend, with visible microphone state and explicit desktop automation permissions.
- Optional services: voice, document parsing, web research, image/video generation, and desktop automation behind replaceable adapters; heavyweight inference must not run by default on the 8 GB RAM client.

## Initial request flow
1. Browser submits a bounded message to the server.
2. Server validates payload and configured model.
3. Server forwards the request to NaraRouter using a server-only Bearer key.
4. Server streams validated text deltas to the browser where supported.
5. Browser renders the response and exposes recoverable errors.
6. Once persistence is integrated, the server maps requests to an authenticated user and stores data in Supabase under RLS-enforced ownership.

## Database model
- `conversations` and `messages`: conversation history.
- `user_preferences`: language, voice, and retention preferences.
- `memory_items`: user-controlled memory; never store credentials here.
- `agent_tasks`: bounded task lifecycle and results.
- `audit_events`: security-relevant events without secrets or message bodies.

All six tables have Row Level Security enabled and owner-scoped policies. Do not use a service-role key in browser code. The existing `nox-ai` project is separate and must remain untouched.

## Security boundaries
- Provider secrets never reach browser code, local storage, public logs, or error responses.
- Treat uploaded documents and retrieved web pages as untrusted content.
- No arbitrary shell/file-system execution through the public web API.
- Authentication and authorization must be enforced server-side before personal memory or cross-device data is enabled.
- Desktop actions use least privilege, confirmation for consequential actions, audit events, and an emergency stop.

## Deployment
The Render service `ultron-ai` is hosted at https://ultron-ai-zvd7.onrender.com. Deploy only after server and build checks pass. Do not repoint another application's Render service by default.
