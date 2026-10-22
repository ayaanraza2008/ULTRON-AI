# Automatic AgentMemory integration

ULTRON can use [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) as an optional persistent memory service. The adapter is lightweight: it does not vendor the upstream engine into the Node API process or start a memory daemon automatically.

## Automatic behavior

- On relevant repository, coding, continuation, decision, or memory-context tasks, ULTRON automatically calls `POST /agentmemory/smart-search` and injects a small bounded set of results into the model context.
- Unrelated requests skip the external memory lookup.
- Durable capture calls `POST /agentmemory/remember` by default when configured, but only when the prompt explicitly signals a durable decision, preference, or remember/save request. Set `ULTRON_AGENTMEMORY_CAPTURE=false` to disable it.
- Existing per-user Supabase memory remains available; AgentMemory supplements it rather than replacing it.
- The authenticated `GET /api/agent/agentmemory?task=...` endpoint reports configuration and whether a task would be checked. It does not expose secrets or prove the remote service is live.

## Configuration

Set these as server-side environment variables in Render or local backend configuration:

- `AGENTMEMORY_URL`: base URL of a reachable AgentMemory server, e.g. `http://localhost:3111` only for a local backend. Hosted ULTRON must use a network-reachable HTTPS URL.
- `AGENTMEMORY_SECRET`: the matching AgentMemory shared secret; never expose it to frontend code or commit it.
- `ULTRON_AGENTMEMORY_PROJECT`: optional base project namespace; defaults to `ultron-ai`. ULTRON automatically scopes the project per authenticated user to prevent cross-account memory leakage.
- `ULTRON_AGENTMEMORY_CAPTURE`: optional; defaults to enabled once configured. Set `false` to disable capture of explicitly signaled durable context.

The adapter uses the upstream REST routes `/agentmemory/smart-search` and `/agentmemory/remember`. Calls time out quickly and fail open: if AgentMemory is down or misconfigured, ULTRON's main chat remains usable and logs a bounded error code.

## Deployment and safety notes

AgentMemory is a separate service with its own runtime and persistent storage. Deploy it separately according to the upstream installation guide, and confirm its health endpoint before wiring ULTRON. Do not point a cloud-hosted Render service at its own `localhost` or at a private address that is not reachable from the service.

Memory results are untrusted reference data, never instructions. The adapter does not automatically store every conversation; capture is limited to obvious durable-context phrases and can be disabled with the environment variable above. Avoid storing personal secrets, credentials, or sensitive data. Secret redaction provided by upstream is a defense-in-depth measure, not permission to submit secrets.

## Upstream

- Repository: https://github.com/rohitg00/agentmemory
- License: Apache-2.0 (see upstream LICENSE)
- REST/MCP features and deployment requirements may change upstream. ULTRON's adapter intentionally uses only a small REST surface.
