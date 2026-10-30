# ULTRON AI + Hermes Agent Integration

**Status: IN PROGRESS.** ULTRON has an optional, owner-scoped Hermes API adapter. The separate Hermes Agent runtime is not installed or started by ULTRON, and it has not yet been live-verified against an actual Hermes API server.

## What is integrated today

ULTRON's `integrations/hermes-agent.js` currently provides:

- An opt-in adapter, disabled unless `HERMES_AGENT_ENABLED=true`.
- Exact Supabase owner-UUID checks for delegated tasks and optional direct chat-provider access.
- Read-only `GET /v1/models` and `GET /v1/capabilities` health discovery.
- Bounded, authenticated `POST /v1/chat/completions` task delegation, with a stable per-owner session key, an idempotency key, timeout/response limits and a safety-focused delegation prompt.
- Remote HTTPS-only URL validation, DNS-pinned network requests and no redirects.
- Explicit vision opt-in: vision is off unless `HERMES_AGENT_SUPPORTS_VISION=true`.

The capability check now understands the current nested `features` document and retains compatibility with the older flat flags. It can report whether the server advertises Chat Completions, Responses, run submission/status, SSE run events and run stopping.

**Capability discovery is not the same as feature integration.** ULTRON's current task adapter still sends Chat Completions requests. It does not yet drive Hermes' `/v1/runs`, `/v1/responses`, SSE progress stream, stop or approval lifecycle. Those must remain marked incomplete until implemented and tested.

## Install and verify Hermes on Windows

The current Hermes Quickstart recommends the Hermes Desktop installer for Windows. Follow the official [Hermes Quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart/) and install the runtime on the Windows computer that will host Hermes.

After installation:

1. Run `hermes setup` and deliberately choose a provider and the toolsets needed for the first test.
2. Run `hermes model` to inspect/select the model and confirm its context size, provider availability, quota and cost. A free-tier label does not guarantee uninterrupted availability or free usage for every account.
3. Complete a normal, harmless chat in Hermes before connecting ULTRON.
4. Run `hermes doctor` and resolve runtime/provider errors before enabling the API server.

Do not paste API keys or the contents of either `.env` file into chat, source files, issue comments or logs.

## Enable the authenticated Hermes API server

Hermes' API server exposes the agent through an OpenAI-compatible endpoint. Its terminal, file, web, memory and skill tools run with the permissions of the Hermes process. The API key is mandatory even when the server binds only to loopback. See the official [API Server guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).

In Hermes' private user configuration file (`~/.hermes/.env`, under the current Windows user's home directory), configure:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<generate-a-long-unique-secret>
```

Then start the API server with:

```powershell
hermes gateway
```

Keep the bind address at `127.0.0.1` for same-machine development. Leave `API_SERVER_CORS_ORIGINS` unset; ULTRON connects server-to-server and does not need browser CORS. Do not expose port 8642 directly to the public internet.

Before granting Hermes access to a real project, configure its terminal backend with an isolated sandbox (the Hermes security guide documents Docker and other sandbox backends). Keep environment forwarding empty unless a specific variable is essential. Do not use YOLO mode or disable dangerous-command approval. Review the working directory, mounts and resource limits; the documentation's example container limits may be too large for an 8 GB laptop.

## Configure ULTRON's backend

Set these values only in the backend process environment or its private secret manager—not in the frontend:

```dotenv
HERMES_AGENT_ENABLED=true
HERMES_AGENT_BASE_URL=http://127.0.0.1:8642/v1
HERMES_AGENT_API_KEY=<the-same-secret-as-API_SERVER_KEY>
HERMES_AGENT_MODEL=hermes-agent
ULTRON_INTEGRATION_OWNER_USER_ID=<the-authenticated-owner-supabase-uuid>
```

Optional settings:

- `HERMES_AGENT_CHAT_PROVIDER=true` exposes Hermes as a direct chat provider to the configured owner. Leave it unset/false during the first delegated-task test.
- `HERMES_AGENT_SUPPORTS_VISION=true` is an explicit opt-in only after an actual image request succeeds with the selected Hermes provider/model. It is false by default.
- `HERMES_AGENT_TIMEOUT_SECONDS` and `HERMES_AGENT_MAX_PROMPT_CHARS` can tune the already bounded request limits; stay within the code's clamps.

The Hermes API key and ULTRON integration key must match. The owner UUID must be the real authenticated Supabase user UUID; do not guess it or use a production user's data as test data.

## Network topology matters

- **Local development:** if ULTRON and Hermes both run on the same Windows machine, the loopback URL above can work.
- **Cloud-hosted ULTRON:** a Render/cloud process cannot reach `127.0.0.1` on your personal Windows PC. Do not put the loopback URL in a cloud environment and expect it to work.
- **Remote Hermes host:** use only a separately reviewed, authenticated HTTPS gateway reachable by the ULTRON backend. The current ULTRON network policy rejects private/LAN/metadata targets and unencrypted remote HTTP; do not disable those protections or publish the Hermes port without an access-control layer.

## Safe acceptance sequence

1. Verify Hermes starts and completes one harmless normal chat.
2. From the same host as ULTRON, authenticate to `GET /v1/models` and `GET /v1/capabilities`; confirm the configured model is listed and record the advertised feature flags.
3. Start ULTRON with the owner-scoped server environment and run its read-only Hermes health check.
4. Submit one harmless, read-only task from the authenticated ULTRON agent flow. Confirm the result, latency, timeout handling and redacted logs.
5. Verify a different ULTRON user is denied without any upstream Hermes request.
6. Test vision separately with a known image challenge before setting `HERMES_AGENT_SUPPORTS_VISION=true`.
7. Only then consider a separately reviewed increment for Hermes Runs API, streaming progress, cancellation, approvals and session continuation.

Record mocked tests, live API checks and physical-device checks separately. A green CI run is not proof that Hermes is installed, that provider credentials work, or that a task ran on the target PC.

## Current verification snapshot

PR [#406](https://github.com/ayaanraza2008/ULTRON-AI/pull/406) adds current capability-schema parsing, legacy compatibility and the fail-closed vision default. CI run [41098869935](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41098869935) passed: 837 Node tests (836 passed, 0 failed, 1 skipped) and all four CI jobs. The skipped test is the live two-account Supabase isolation test.

**Still unverified:** a reachable Hermes API server, real text/task delegation, semantic image understanding, target-PC sandbox behavior, cloud-to-Hermes networking and any Hermes Runs/SSE/stop/approval workflow. PR #406 is a draft and has not been merged. No production settings, secrets, databases or deployments were changed by this increment.
