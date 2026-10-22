# ULTRON AI Architecture

## Current phase: backend only
- Frontend/UI and Windows desktop shell are deferred until the final phase.
- API server: server-side provider adapter, validation, rate limits, timeout/cancellation handling, health/readiness endpoints, structured logs.
- Provider gateway: OpenAI-compatible OpenRouter API; keep API keys exclusively server-side.
- Persistence: dedicated Supabase project `ULTRON-AI`, ref `opdjfhwepmcprbqojpat`, region `ap-south-1`.
- Optional backend adapters: voice, document parsing, web research, image/video generation, AI Employee task queue, and desktop bridge status. Heavy inference must not run by default on an 8 GB RAM client.

## Backend request flow
1. API receives a bounded request.
2. Server validates payload and authenticated user.
3. Provider/integration adapters execute only allowlisted operations.
4. Task worker processes only explicitly permitted draft/research/report tasks.
5. Supabase stores owner-scoped records under RLS policies.

## Security boundaries
- Provider secrets never reach clients, logs, or error responses.
- Treat uploaded documents and retrieved pages as untrusted content.
- No arbitrary shell/file-system execution through the public API.
- Desktop actions remain unavailable until a separately authenticated local companion is implemented.
- Consequential actions require explicit confirmation, audit events, least privilege, and an emergency stop.

## Deployment
The Render service `ultron-ai` is hosted at https://ultron-ai-zvd7.onrender.com. Render Blueprint contains only the backend API service in this phase.
