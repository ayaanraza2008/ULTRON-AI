# Windows Desktop Companion Protocol (v1)

## Scope and safety boundary

The cloud companion relay records only Windows device pairing and recent heartbeat presence. The Windows client initiates outbound HTTPS requests; the ULTRON server never opens a network connection to the PC and never sends commands to it.

The relay does **not** execute PowerShell or shell commands, read or write local files, click/press keys, move the mouse, capture screenshots, inspect processes, install software, or shut down/restart the PC. The UI must continue to show remote control as unavailable.

## Pairing flow

1. Sign in to the ULTRON web app with the Supabase account that should own the device.
2. Open **PC and mobile devices** and generate a one-time pairing code. The code is returned once, expires after five minutes, and is consumed atomically.
3. On the Windows PC, run:

   ```powershell
   ultron-local companion pair --server-url https://YOUR-ULTRON-HOST
   ```

   The CLI prompts for the code using hidden terminal input. It sends the code and a stable local device UUID to the HTTPS endpoint. It validates public DNS answers, pins the selected IP to the TLS connection, checks the hostname certificate, rejects redirects, and accepts only bounded JSON responses.
4. Start the foreground heartbeat client:

   ```powershell
   ultron-local companion connect
   ```

   To send one test heartbeat and exit, use `ultron-local companion connect --once`.

The CLI saves the device token to the user's ULTRON app-data folder, outside the repository. The token is shown once by the server, never printed by the CLI, and only its SHA-256 hash is stored in Supabase. Protect the Windows user account and its local app-data directory. The token file is not a Windows Credential Manager integration; local account compromise can expose it.

## Cloud API

All routes are mounted beneath `/api`.

### Create a pairing code (authenticated)

```http
POST /api/desktop-companion/pairings
Cookie: <Supabase-authenticated ULTRON session>
Content-Type: application/json

{}
```

The server creates 24 cryptographically random bytes, stores only the SHA-256 hash with the authenticated owner UUID and a database-enforced maximum five-minute expiry, and returns the raw code once with `Cache-Control: no-store`.

### Redeem a pairing code (one-time device exchange)

```http
POST /api/desktop-companion/pair
Content-Type: application/json

{
  "pairingCode": "<32-character-base64url-code>",
  "deviceId": "<stable-device-uuid>",
  "deviceName": "Ayaan-PC"
}
```

The server generates a 256-bit random device token. A narrow service-role RPC consumes the unexpired pairing code exactly once and creates/rotates the device record with only the token hash. The raw token is returned once with no-store headers. The RPC is allowlisted in server code; no generic caller-selected database function is exposed.

### Heartbeat (device-authenticated)

```http
POST /api/desktop-companion/heartbeat
Authorization: Bearer <device-token>
Content-Type: application/json

{ "deviceId": "<stable-device-uuid>" }
```

The service-role RPC matches both the token hash and device UUID, requires `revoked_at is null`, and updates `last_seen_at`. Heartbeats are expected every 30 seconds. The UI reports a device online for at most 90 seconds after its last heartbeat. This endpoint does not accept task text, command names, file paths, or action payloads.

### Inventory and revocation (authenticated owner)

- `GET /api/desktop-companion/devices` returns only the signed-in user's own device metadata. The token hash is not selectable by authenticated users.
- `POST /api/desktop-companion/devices/:id/revoke` calls an owner-checked database function using `auth.uid()`. The next heartbeat from a revoked device is rejected.

RLS is enabled on both tables. Anonymous/public table access is revoked. Authenticated users may insert their own pairing records and read only their own device inventory; service-role access is limited to the server-side pairing/heartbeat paths. Function definitions use an empty `search_path` and schema-qualified object names.

## Network and credential protections

- The CLI accepts only an HTTPS origin on port 443; credentials, URL paths, queries, fragments, local hostnames and literal IP server URLs are rejected.
- DNS lookup must return only public/global IP addresses. If any result is private, loopback, link-local, multicast, reserved or otherwise non-global, the request is blocked.
- The CLI connects to a previously validated IP while retaining the original hostname for TLS SNI and certificate validation. It does not follow redirects.
- Request/response timeouts and a 64 KiB response limit bound the client. The service-side API uses the existing API rate limiter.
- Pairing codes and device tokens are high-entropy random values. Supabase stores only SHA-256 hashes; server responses and diagnostics do not return stored tokens or provider output.
- The local client initiates every heartbeat. No inbound PC port, LAN listener, tunnel, reverse shell, command queue or remote-control channel is created.

## Revoke or remove a device

Use **REVOKE** beside the device in the web UI. Revocation is owner-scoped and immediately prevents the next token-authenticated heartbeat from updating presence. To remove the local token file too, stop `ultron-local companion connect` and run:

```powershell
Remove-Item "$env:LOCALAPPDATA\ULTRON\local-assistant\companion\device-credentials.json"
```

Pair the PC again with a fresh code to restore status reporting.

## Optional legacy loopback status server

The separate `ultron-local companion token` and `ultron-local companion serve` commands start a local-only status endpoint for local development. It binds only to `127.0.0.1`, checks the loopback peer and exact Host header, requires a high-entropy bearer token, denies unlisted browser Origins, rate-limits requests, caps concurrent handlers at 16, applies a five-second socket timeout, closes responses, and exposes only `GET /v1/ultron/status`.

This loopback server is not used by the cloud pairing/heartbeat relay. Do not expose its port to the LAN or internet.

## Verification boundary

Automated tests cover API route behavior, hashing, one-time code handling, heartbeat identity checks, inventory online-window logic, revocation paths, local DNS validation, secure credential-file handling, and SQL policy/function source properties. These are not a substitute for running the migration against a dedicated Supabase test project, pairing a physical Windows PC, and confirming live heartbeat/revocation in the deployed environment.

The migration is not applied to the production Supabase project, and this PR is not deployed. No remote PC-control feature is claimed.
