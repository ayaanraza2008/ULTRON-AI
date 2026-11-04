# ULTRON × HexStrike AI Integration

**Upstream:** https://github.com/0x4m4/hexstrike-ai  
**Upstream license:** MIT (copyright and license remain with the upstream author).  
**Integration mode:** optional external service; ULTRON does not vendor or auto-install HexStrike.

## What is integrated

ULTRON exposes a deliberately narrow, owner-only adapter to an already-installed HexStrike API service:

- Health check: `GET /api/integrations/hexstrike/status`
- Static scan allowlist: `POST /api/integrations/hexstrike/scan`
  - `trivy-fs`: local filesystem vulnerability scan
  - `trivy-config`: local configuration / IaC scan
  - `checkov`: local infrastructure-as-code scan

The adapter reuses ULTRON Supabase authentication, the configured integration-owner UUID, the existing target-authorization gateway, and Guardian audit events. Scan paths must be existing directories beneath a shared absolute workspace root; symlink/path traversal escapes are rejected. Requests and responses are bounded and redirects are disabled.

## Deliberately not exposed

HexStrike is a powerful cybersecurity framework. Its upstream MCP/server includes generic command execution and tools for active reconnaissance, exploitation, credential attacks, and other high-impact actions. ULTRON does **not** expose the generic `/api/command` endpoint, arbitrary MCP tool names, caller-supplied command arguments, exploit generation, brute force, password cracking, or active remote scanning through this adapter.

The selected tools perform local defensive analysis only. A successful scan means the tool completed, not that a target is secure. Review findings and verify them independently.

## Configuration

All values are server-side only:

```dotenv
HEXSTRIKE_ENABLED=false
HEXSTRIKE_BASE_URL=http://127.0.0.1:8888
HEXSTRIKE_API_TOKEN=
HEXSTRIKE_REMOTE_GATEWAY_CONFIRMED=false
HEXSTRIKE_SCAN_ROOT=
ULTRON_INTEGRATION_OWNER_USER_ID=
```

- Keep `HEXSTRIKE_ENABLED=false` until the service has been installed and reviewed.
- For same-host development, use explicit loopback HTTP only (for example `http://127.0.0.1:8888`).
- Remote use requires HTTPS behind a private authentication gateway that validates the bearer token. Set `HEXSTRIKE_REMOTE_GATEWAY_CONFIRMED=true` only after verifying that gateway. The upstream HexStrike server itself must not be exposed directly to the public internet.
- `HEXSTRIKE_SCAN_ROOT` must be an absolute directory visible to both ULTRON and HexStrike, ideally a dedicated read-only workspace mount. The submitted `target` is a relative subdirectory such as `.` or `project`.
- The owner UUID must match the signed-in Supabase Auth user. Non-owner users cannot inspect service health or launch scans.

## Installation notes

Follow the upstream README for Python and external-tool prerequisites. HexStrike is a separate Python service and expects its underlying security tools to be installed separately. Kali Linux / an isolated security VM or WSL2 environment is preferable to installing a large offensive-security toolchain directly on the everyday Windows host.

For local-only use, bind HexStrike to loopback (the upstream default is `127.0.0.1`) and run it as an unprivileged user in an isolated workspace. Do not install optional tools, run it as Administrator/root, or expose port 8888 publicly as part of this ULTRON change. ULTRON does not install Python dependencies or security binaries automatically.

A Render-hosted ULTRON backend cannot reach `127.0.0.1` on the owner's Windows PC. A later authenticated companion/private-network bridge is required for that topology; do not replace the local URL with an unauthenticated public endpoint.

## Verification

Run the targeted adapter tests with:

```bash
node --test tests/hexstrike-ai-integration.test.js
```

The tests use mocked upstream responses and prove route policy, owner gating, path containment, request shape, and failure classification. They do not prove that a live HexStrike service or external scanner binaries are installed or reachable.
