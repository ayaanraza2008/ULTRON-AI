# ULTRON Windows Companion (early, permission-bounded)

## What it does

This local Node.js companion opens **no inbound listener**. It polls ULTRON over HTTPS for a single owner/device's queued actions, then reports a small bounded result.

The first version supports only:
- **system_info**: a read-only summary of OS release, architecture, Node version, uptime, memory totals, and logical CPU count. It intentionally omits hostname, IP addresses, serial numbers, environment variables, files, and process lists.
- **launch_app**: opens only one allowlisted built-in executable (notepad, calculator, or file_explorer). This action always waits for explicit owner approval. It uses a fixed System32 executable path, no arguments, and shell disabled.

It does **not** support arbitrary shell/PowerShell, scripts, file reads/writes, screenshots, keyboard/mouse control, browser clicks, software installation, shutdown, stealth, or self-installation. The model cannot add capabilities or bypass the approval gate.

## Configuration

The backend and local companion must share the following private configuration:
- **ULTRON_DESKTOP_POLL_TOKEN**: a high-entropy bearer token, stored as a secret on the server and a private environment variable on the PC. Rotate it on both sides if exposed.
- **ULTRON_DESKTOP_DEVICE_ID**: a stable, non-secret ID for the one paired device. It must match on server and PC.
- **ULTRON_INTEGRATION_OWNER_USER_ID**: the exact Supabase Auth UUID allowed to queue and approve desktop actions on the server.
- **ULTRON_DESKTOP_SERVER_URL**: on the PC only, the public HTTPS origin of ULTRON (your deployed ULTRON origin, with no path/query).
- **ULTRON_DESKTOP_AGENT_ENABLED=true**: an explicit local opt-in. Without it the companion refuses to start.

The server also needs its existing **SUPABASE_URL** and server-side **SUPABASE_SERVICE_ROLE_KEY**. Never put the service-role key on the Windows PC. Never commit the polling token to GitHub or send it in chat. Do not reuse the read-only status adapter token unless you intentionally choose and manage the same secret for both purposes.

## Start manually on Windows

After the backend code has been reviewed, merged, the SQL migration has been applied, and the matching backend revision is deployed, clone/update the ULTRON repository on the PC, set the environment variables in a private terminal session, and run:

~~~powershell
$env:ULTRON_DESKTOP_SERVER_URL = "https://YOUR-ULTRON-HTTPS-ORIGIN"
$env:ULTRON_DESKTOP_DEVICE_ID = "your-stable-device-id"
$env:ULTRON_DESKTOP_POLL_TOKEN = "<set privately; do not paste into source>"
$env:ULTRON_DESKTOP_AGENT_ENABLED = "true"
node .\scripts\windows-companion.mjs
~~~

Keep the terminal running for the companion to poll. This early version does not install a Windows service or register itself at startup.

## Backend API flow (no frontend required yet)

The owner can use the authenticated backend API:
1. POST **/api/desktop-companion/actions** with JSON **{"actionType":"system_info"}** queues the read-only action.
2. POST **/api/desktop-companion/actions** with JSON **{"actionType":"launch_app","payload":{"app":"notepad"}}** creates a task in **WAITING_FOR_PERMISSION**.
3. Review the returned action ID, then explicitly approve it with POST **/api/desktop-companion/actions/{id}/approve** and JSON **{"confirm":true}**.
4. Poll GET **/api/desktop-companion/actions/{id}** for the bounded result. POST **/api/desktop-companion/actions/{id}/cancel** cancels queued or not-yet-approved actions.

The companion's poll and complete endpoints require the private token, matching device ID, and protocol v1. The database claim is atomic (FOR UPDATE SKIP LOCKED), scoped by owner/device, and refuses approval-required rows without an approval timestamp.

## Verification and rollout status

The backend, action policy, local runner, SQL migration, and automated regression tests are being prepared on a development branch/draft PR. No Supabase migration is applied by this implementation step, no Render deployment has been triggered, and no real Windows device has been paired or live-tested yet. Do not treat the feature as production-ready until CI passes, the SQL migration has been reviewed/applied, the environment is configured on both sides, and an actual Windows smoke test succeeds.
