# Hermes Agent local setup and ULTRON pairing

Last reviewed: 2026-10-31

This is a runbook for the separate NousResearch Hermes runtime. ULTRON's Hermes adapter does not install Hermes, configure its model provider, or pair a physical PC. It only calls an already-running, authenticated Hermes API server.

## 1. Install Hermes on the Windows host

Use the official Hermes Desktop installer for the simplest Windows experience, or the native PowerShell installer documented by Nous Research. The current native CLI is supported on Windows 10/11; WSL2 is also supported. The official installer downloads dependencies and runs setup, so review the current upstream guide before executing it.

Official references:
- https://hermes-agent.nousresearch.com/docs/getting-started/installation
- https://hermes-agent.nousresearch.com/docs/user-guide/windows-native
- https://hermes-agent.nousresearch.com/docs/user-guide/windows-wsl-quickstart

For native Windows PowerShell, the upstream documented command is:

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Then open a new PowerShell window and verify:

```powershell
hermes --version
hermes doctor
hermes setup
hermes model
```

Use a model with at least the 64K context window required by the current Hermes quickstart. Complete one ordinary chat successfully before enabling additional tools, browser, voice, cron, or remote execution. Do not enable unrestricted shell/file tools until the API boundary is secured.

## 2. Enable the local API server

Hermes API server exposes the agent's full toolset, including terminal and file operations. Keep it bound to loopback and require a strong random key even on localhost.

Edit `$HOME\.hermes\.env` (or the active Hermes profile's `.env`) and add:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<random-secret-at-least-32-characters>
```

Generate the key locally; do not paste it into ChatGPT, source control, screenshots, or logs. Keep CORS unset unless a browser frontend specifically needs it; if enabled, list only exact trusted origins.

Start the gateway:

```powershell
hermes gateway
```

In a second PowerShell window, verify the local endpoint:

```powershell
$headers = @{ Authorization = "Bearer $env:API_SERVER_KEY" }
Invoke-RestMethod -Uri "http://127.0.0.1:8642/v1/models" -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:8642/v1/capabilities" -Headers $headers
```

If the key is stored only in the Hermes env file, load it into the current PowerShell process from a secure local secret store or use a local HTTP client that can read it without printing it. Never use a weak example key in a real deployment.

Official API server reference:
https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server

## 3. Configure ULTRON

ULTRON's backend adapter expects these server-side variables:

```dotenv
HERMES_AGENT_ENABLED=true
HERMES_AGENT_BASE_URL=https://<private-https-host>/v1
HERMES_AGENT_API_KEY=<same-random-secret>
HERMES_AGENT_MODEL=hermes-agent
HERMES_AGENT_CHAT_PROVIDER=false
ULTRON_INTEGRATION_OWNER_USER_ID=<authenticated-owner-uuid>
```

Keep `HERMES_AGENT_CHAT_PROVIDER=false` initially. Verify the delegated task route first, then evaluate direct chat-provider fallback separately.

For a ULTRON backend running on the same Windows host, the base URL can be `http://127.0.0.1:8642/v1`. A Render-hosted ULTRON backend cannot reach the PC's loopback address. Remote pairing therefore requires a private, authenticated HTTPS ingress or an outbound local companion/tunnel. Do not expose port 8642 directly to the public Internet, do not port-forward it, and do not expose the Hermes key. The current ULTRON adapter supports the Hermes bearer key; any additional gateway access-control layer must be compatible with that request path.

## 4. Run the ULTRON smoke test

After setting the variables in the ULTRON backend's private environment:

```bash
npm run smoke:hermes
```

The smoke test checks the configured owner, model discovery and advertised capabilities. A passing result proves API reachability and metadata only; it does not prove task execution, local Windows control, safe terminal isolation, or physical-device pairing.

## 5. Windows and Android boundaries

- Windows native and WSL2 are supported Hermes install paths. Windows native feature support is not identical to WSL2; use the upstream platform matrix before enabling optional features.
- Hermes API server has access to the configured agent's tools. Start with the minimum toolsets and a sandboxed terminal backend. Never expose an unrestricted host shell through an unauthenticated public API.
- Android/Termux is a narrower, best-effort platform. The documented Termux path does not include Docker isolation or the local voice/browser extras used on desktop/server. Android may suspend background Termux processes.
- A working Hermes CLI on Android is not equivalent to Android OS control, microphone/wake-word integration, or an authenticated ULTRON companion.
- The ULTRON Windows companion and Android companion still require installation, pairing, permissions and real-device E2E verification. A cloud service cannot directly control a device's localhost.

## Acceptance checklist

- [ ] Hermes installed and `hermes doctor` passes on the actual Windows host.
- [ ] A normal Hermes chat succeeds with the selected provider/model.
- [ ] API server binds only to loopback and requires a strong key.
- [ ] `/v1/models` and `/v1/capabilities` return expected data locally.
- [ ] Remote ingress is private, HTTPS, authenticated, and does not expose the raw Hermes port.
- [ ] ULTRON owner-scoped smoke test passes from the deployed backend.
- [ ] One harmless Hermes delegated task completes and its result is verified.
- [ ] Toolsets, terminal backend and any filesystem access are least-privileged and sandboxed.
- [ ] Physical Windows/Android companion pairing is separately tested.

Until these checks pass, keep Hermes `disabled_by_config` or `configured_unverified`; do not claim that local-device control is complete.
