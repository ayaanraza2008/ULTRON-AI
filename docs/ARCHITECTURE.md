# ULTRON AI Architecture

## Current phase: backend only
- Full frontend/UI work remains deferred until the final phase. A minimal source-controlled Windows wake-word companion and an Android on-device wake-word companion now exist; their CI builds do not constitute physical-device verification.
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
- Wake-word companions do not grant PC-control privileges. Desktop actions remain unavailable until a local bridge is authenticated, paired, scoped to allowlisted actions, and covered by visible permission prompts and an emergency stop.
- Consequential actions require explicit confirmation, audit events, least privilege, and an emergency stop.

## Live Chrome DevTools integration
- The optional TypeScript service in `chrome-devtools/` exposes a local HTTP action bridge and an MCP stdio server using Chromium's DevTools Protocol.
- Supported actions are tab status, navigation, unique-selector click/fill, visible page snapshot, screenshot, bounded console/network metadata, and short performance traces. It does not expose arbitrary JavaScript, shell commands, cookies, request bodies or secret field values.
- ULTRON's agent tool is owner-guarded by `ULTRON_INTEGRATION_OWNER_USER_ID` and uses `ULTRON_CHROME_DEVTOOLS_URL` plus a server-only `ULTRON_CHROME_DEVTOOLS_TOKEN`. Live connectivity is unverified until a local bridge and Chrome instance are running.
- A cloud-hosted backend cannot use its own `localhost` to reach the developer PC. Remote use requires an explicitly configured authenticated HTTPS gateway and should not expose the Chrome CDP port itself.

## Deployment
The Render service `ultron-ai` is hosted at https://ultron-ai-zvd7.onrender.com. Render Blueprint contains only the backend API service in this phase.
