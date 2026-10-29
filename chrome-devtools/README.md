# ULTRON Chrome DevTools Bridge

A local-first TypeScript/Node.js service that connects an AI coding agent to a real Chromium/Chrome tab through the Chrome DevTools Protocol (CDP). It provides browser navigation, safe element clicking/filling, page snapshots, screenshots, console errors, network request status, and a bounded performance trace.

## What is included

- **TypeScript + Node.js 20+** service under `chrome-devtools/`, separate from ULTRON's existing backend dependencies.
- **MCP stdio server** for local coding agents (Claude Code, Gemini-compatible MCP clients, Cursor, VS Code, and other MCP hosts).
- **Authenticated HTTP bridge** at `POST /action` so ULTRON's existing agent tools can dispatch the same allowlisted actions.
- **Performance diagnostics** from a short Chrome trace, including long trace events, duration/heap/layout metric deltas, and suggested next debugging steps.
- **Bounded data**: request bodies capped at 16 KB; console/network history capped at 200 entries; trace collection capped at 30,000 events; screenshot payload capped at 1.2 MB.
- **Privacy defaults**: no response/request bodies, cookies, auth headers, or URL query strings in network logs; screenshot/image is returned only when explicitly requested.

## Build

From the repository root:

```bash
cd chrome-devtools
npm install
npm run build
npm test
```

The project uses `playwright-core`; it does not silently download a browser. Use an installed Chromium/Chrome binary and launch it with a dedicated automation profile. For example on Windows, close that dedicated profile first, then start Chrome with flags equivalent to:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\ULTRON\ChromeDevToolsProfile"
```

Adjust the Chrome executable path for your machine. Do not point the bridge at your everyday Chrome profile; CDP can act with the authority of the profile it attaches to. Keep the debug port bound to loopback and never port-forward it.

## MCP client setup

Build the project, then configure the local coding agent to launch:

- **Command:** `node`
- **Arguments:** `C:\path\to\ULTRON-AI\chrome-devtools\dist\mcp.js`
- **Working directory:** `C:\path\to\ULTRON-AI\chrome-devtools`

The MCP server talks over stdio and does not need the HTTP bridge token. Start Chrome with remote debugging before invoking its tools.

## Connect ULTRON's backend agent

The HTTP bridge must have a random secret of at least 32 characters. Keep this token out of source control and browser code.

PowerShell example:

```powershell
$env:CHROME_BRIDGE_TOKEN = "<generate-a-random-32+-character-secret>"
$env:CHROME_CDP_URL = "http://127.0.0.1:9222"
$env:CHROME_BRIDGE_PORT = "4783"
npm start
```

The service binds to `127.0.0.1` by default and exposes only `GET /healthz` and token-protected `POST /action`. ULTRON's backend adapter uses these server-side settings:

- `ULTRON_CHROME_DEVTOOLS_URL`
- `ULTRON_CHROME_DEVTOOLS_TOKEN`
- `ULTRON_INTEGRATION_OWNER_USER_ID`

For a local ULTRON backend on the same computer, set the URL to `http://127.0.0.1:4783` and configure the same token in both processes. A hosted backend such as Render cannot reach the developer PC's `localhost`. Remote access requires a deliberate authenticated HTTPS gateway/tunnel; if enabling a remote bind, set `CHROME_BRIDGE_ALLOW_REMOTE=true`, configure `CHROME_BRIDGE_ALLOWED_HOSTS` to exact gateway hostnames and still keep the underlying service private. Never expose port 9222 or an unauthenticated bridge directly to the Internet.

## Tools

| MCP tool | Purpose |
| --- | --- |
| `chrome_status` | Connection and open tabs |
| `chrome_navigate` | Navigate to an HTTPS public site or loopback development site |
| `chrome_click` | Click one uniquely matching element |
| `chrome_fill` | Fill a non-secret field |
| `chrome_page_snapshot` | Title, URL, bounded visible body text |
| `chrome_screenshot` | Screenshot returned as an MCP image |
| `chrome_console_logs` | Recent console messages and page errors |
| `chrome_network_requests` | Recent request metadata and status codes |
| `chrome_performance_trace` | Short trace, long events, metric deltas, actionable insights |

## Safety boundaries

- Only HTTP(S) navigation is accepted. Localhost is allowed for development; remote destinations must use HTTPS. Direct IP literals, metadata hostnames, internal suffixes, and single-label hostnames are blocked.
- Routed browser requests use a bounded DNS lookup and are rejected if any resolved address is non-public. This is defense in depth, not DNS pinning: use an operating-system firewall or pinned egress proxy for hostile DNS/rebinding environments.
- Clicking high-impact controls or external form submissions requires both the per-call `confirmExternalAction: true` flag and the explicit server-side `CHROME_ALLOW_EXTERNAL_ACTIONS=true` setting. Local loopback development apps may be tested normally.
- Password, token, one-time-code, and payment fields cannot be filled. The service never returns field values.
- The service does not execute JavaScript supplied by the model, read local files, launch shell commands, upload files, bypass sign-in controls, solve CAPTCHAs, or perform stealth automation.
- Keep the browser profile separate and disposable. An attached browser can access the web sessions and development resources available to that profile.

## Limitations

The HTTP bridge is a local companion, not a hosted browser. Configuration readiness alone does not prove Chrome is reachable. Performance traces are short diagnostic samples; use Chrome DevTools manually for full timeline inspection and repeat the trace under representative load. Remote live-browser access remains unverified until the bridge, gateway, and exact ULTRON owner account are configured and tested end to end.
