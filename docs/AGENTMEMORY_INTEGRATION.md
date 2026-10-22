# ULTRON AgentMemory integration

ULTRON can use [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) as a separate persistent-memory service. This adapter integrates a small, bounded part of its REST API into the existing Node backend.

## Automatic behavior

- For relevant project, repository, coding, debugging, continuation, decision, and memory-context tasks, ULTRON automatically calls `POST /agentmemory/smart-search` and injects up to five bounded results into model context.
- Unrelated tasks skip external recall.
- When the service is configured, ULTRON captures only high-signal durable decisions/preferences or explicit remember/save requests through `POST /agentmemory/remember`; ordinary conversations are not blindly persisted.
- Capture can be disabled with `ULTRON_AGENTMEMORY_CAPTURE=false`.
- The existing Supabase memory preference is respected. If `memory_enabled=false`, external recall and capture are skipped.
- The upstream project namespace is automatically suffixed with the authenticated ULTRON user ID, preventing separate ULTRON accounts from sharing a project namespace.
- Memory results are untrusted reference data, never instructions. External-memory failures are logged and do not break the main chat path.

## Backend configuration

Set these as server-side environment variables only:

- `AGENTMEMORY_URL`: reachable HTTPS base URL for the AgentMemory service.
- `AGENTMEMORY_SECRET`: the same strong secret configured on the AgentMemory service. Never put this in frontend code or commit it.
- `ULTRON_AGENTMEMORY_PROJECT`: optional base namespace; defaults to `ultron-ai`.
- `ULTRON_AGENTMEMORY_CAPTURE`: optional; enabled when configured unless set to the literal string `false`.

The authenticated readiness endpoint is `GET /api/agent/agentmemory?task=Continue%20the%20previous%20repository%20implementation`. It returns configuration status and recall counts, not stored memory contents or proof that deployment is healthy. `GET /api/agent/tools` also reports whether the adapter is configured.

## Deployment requirements

The AgentMemory daemon is a separate Node.js 20+ service. Upstream's canonical setup is `npx -y @agentmemory/agentmemory@latest`; it starts the REST/MCP service (default port 3111) and the pinned iii engine. Validate `GET /agentmemory/health` or `/agentmemory/livez`, then test `POST /agentmemory/remember` and `POST /agentmemory/smart-search`. Protected REST calls require `Authorization: Bearer <AGENTMEMORY_SECRET>` when a secret is configured.

A hosted service must provide persistent storage for the AgentMemory state directory across restarts. An ephemeral free web-service filesystem is not sufficient for reliable long-term memory. Do not point a hosted ULTRON service at `localhost` unless both processes truly share the same host/container. Do not silently provision a paid plan or persistent disk without checking the account's billing implications.

Upstream reference: https://github.com/rohitg00/agentmemory
