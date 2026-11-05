# ULTRON AI Architecture

## Current phase: integrated command-center frontend and backend; physical-device acceptance pending
- The cinematic ULTRON Living Core command-center frontend exists in source and is served by the separate Render service `ultron-core-interface`. As of 2026-11-05, that service is deployed from branch `feature/ultron-live-core-interface-20261029`, commit `32e19e563cd791bdd55db7b668b12101d7a13c6f`; its frontend-to-backend acceptance still needs verification.
- Source-controlled Windows and Android wake companions exist. CI build success does not establish physical-device pairing, microphone, background, or desktop-control behavior.
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
Read-only Render inspection on 2026-11-05 found these services in workspace `Ultron core`:
- `ultron-ai-core` — https://ultron-ai-core.onrender.com, tracks `main`; latest deployment is live at `573f31f953997cb0e546ef599f77e66cf8f7775b`.
- `ultron-browser-use-core` — https://ultron-browser-use-core.onrender.com, tracks `main`; latest deployment is live at the same main commit. A startup smoke at 2026-11-05 07:50:26 UTC received HTTP 200 from the ULTRON model gateway using `openrouter/free` and returned a non-empty response. This is one successful Browser Use inference smoke, not proof of sustained availability or general chat/vision quality.
- `ultron-rea-gateway` — https://ultron-rea-gateway.onrender.com, tracks `main`; latest deployment is live at the same main commit.
- `ultron-core-interface` — https://ultron-core-interface.onrender.com, tracks `feature/ultron-live-core-interface-20261029`; latest deployment is live at `32e19e563cd791bdd55db7b668b12101d7a13c6f`.

All four services were observed on Render free plans with auto-deploy enabled. This document records observed state only; do not trigger deployments or change service configuration as part of an audit.
