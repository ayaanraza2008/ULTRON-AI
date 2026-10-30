# Windows Desktop Companion Protocol (v1 + fixed local actions)

## Scope and safety boundary

The Windows companion initiates every HTTPS request. ULTRON never opens a network connection to the PC, and no inbound PC port, LAN listener, tunnel, or reverse shell is created.

The cloud relay supports pairing, heartbeat presence, revocation, and a very small fixed-action request queue. It is **not** a general remote desktop or remote shell. The only cloud-requestable actions are:
- Launch Notepad, File Explorer, or Calculator.
- Open the standard Desktop, Documents, or Downloads folder.

Every action is only a request. The foreground Windows terminal displays the exact action and requires the local user to type `ALLOW` before the shortcut runs. A non-interactive client denies the request. Requests expire after two minutes, and only one action may be pending or claimed for a device at once.

The relay never accepts or executes arbitrary PowerShell/shell text, executable paths, user-supplied filesystem paths, file contents, screenshots, clipboard reads, keyboard/mouse events, process inspection/termination, software installation, or shutdown/restart instructions. The local shortcut implementation uses the fixed executable/folder allowlists, `shell=False`, and a bounded local audit log. A successful result means Windows accepted a process-start request; it does not prove that the application finished loading.

## Pairing flow

1. Sign in to the ULTRON web app with the Supabase account that should own the device.
2. Open **PC and mobile devices** and generate a one-time pairing code. The code is returned once, expires after five minutes, and is consumed atomically.
3. On the Windows PC, run:

   ```powershell
   ultron-local companion pair --server-url https://YOUR-ULTRON-HOST
   ```

   The CLI prompts for the code using hidden terminal input. It sends the code and a stable local device UUID to the HTTPS endpoint. It validates public DNS answers, pins the selected IP to the TLS connection, checks the hostname certificate, rejects redirects, and accepts only bounded JSON responses.
4. Start the foreground companion:

   ```powershell
   ultron-local companion connect
   ```

   To send one heartbeat and check for one pending local-action request, use `ultron-local companion connect --once`. Leave the normal command running in an interactive terminal to keep the PC online and receive requests. It sends an outbound heartbeat and checks for one pending action about every 30 seconds.

When ULTRON requests an action, the console shows the exact fixed operation. Type the exact word `ALLOW` to run it locally or anything else to deny it. If the terminal is not interactive, the action is denied. If the request expires while the user is considering it, the action is discarded and never executed. A successful local shortcut is recorded in the local `desktop-actions.jsonl` audit file.

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

The service-role RPC matches both the token hash and device UUID, requires `revoked_at is null`, and updates `last_seen_at`. Heartbeats are expected every 30 seconds. The UI reports a device online for at most 90 seconds after its last heartbeat.

### Queue one fixed local action (authenticated owner)

```http
POST /api/desktop-companion/devices/<device-record-id>/actions
Cookie: <Supabase-authenticated ULTRON session>
Content-Type: application/json

{ "action": "launch_application", "target": "notepad" }
```

Only the exact action/target pairs in the allowlist above are accepted. The server verifies that the record belongs to the signed-in user, is a non-revoked Windows device, and has a heartbeat no older than 90 seconds. The row stores an enum-like action name and target, not a command string or path. Database constraints and RLS enforce the same allowlist and owner/device relationship. Only one pending or claimed action can exist per device, and the expiry is fixed to two minutes by the server.

### Claim the next action (device-authenticated)

```http
POST /api/desktop-companion/actions/next
Authorization: Bearer <device-token>
Content-Type: application/json

{ "deviceId": "<stable-device-uuid>" }
```

A narrowly allowlisted service-role RPC verifies the token hash and device UUID, rejects revoked devices, expires stale requests, and atomically claims at most one pending action using row locking. It returns only the action UUID, fixed action name, fixed target and expiry. The client validates the response against its own local allowlist before displaying it.

### Complete or deny a claimed action (device-authenticated)

```http
POST /api/desktop-companion/actions/<action-id>/complete
Authorization: Bearer <device-token>
Content-Type: application/json

{
  "deviceId": "<stable-device-uuid>",
  "status": "completed",
  "resultCode": "ACTION_COMPLETED"
}
```

The device may report only `completed`, `denied`, `failed`, or `expired` with a matching fixed result code. The database checks the token hash, device UUID, claimed action ID, current expiry, and one-time status transition. No free-form output or local process details are uploaded.

### Inventory and revocation (authenticated owner)

- `GET /api/desktop-companion/devices` returns only the signed-in user's own device metadata. The token hash is not selectable by authenticated users.
- `POST /api/desktop-companion/devices/:id/revoke` calls an owner-checked database function using `auth.uid()`. New heartbeats, claims and action completions from a revoked device are rejected.

RLS is enabled on pairing, device and action tables. Anonymous/public table access is revoked. Authenticated users may insert only their own valid action rows and read only their own action/device metadata; the service-role functions are limited to named pairing, heartbeat, claim and completion operations. Function definitions use an empty `search_path` and schema-qualified object names.

## Network and credential protections

- The CLI accepts only an HTTPS origin on port 443; credentials, URL paths, queries, fragments, local hostnames and literal IP server URLs are rejected.
- DNS lookup must return only public/global IP addresses. If any result is private, loopback, link-local, multicast, reserved or otherwise non-global, the request is blocked.
- The CLI connects to a previously validated IP while retaining the original hostname for TLS SNI and certificate validation. It does not follow redirects.
- Request/response timeouts and a 64 KiB response limit bound the client. The service-side API uses the existing API rate limiter.
- Pairing codes and device tokens are high-entropy random values. Supabase stores only SHA-256 hashes; server responses and diagnostics do not return stored tokens or provider output.
- A server-side action request is still only a request. The local terminal requires fresh human approval, rechecks expiry after the prompt, and invokes only fixed functions with no shell.

## Revoke or remove a device

Use **REVOKE** beside the device in the web UI. Revocation is owner-scoped and immediately prevents subsequent heartbeat, action-claim and action-completion requests. To remove the local token file too, stop `ultron-local companion connect` and run:

```powershell
Remove-Item "$env:LOCALAPPDATA\ULTRON\local-assistant\companion\device-credentials.json"
```

Pair the PC again with a fresh code to restore connectivity.

## Optional legacy loopback status server

The separate `ultron-local companion token` and `ultron-local companion serve` commands start a local-only status endpoint for local development. It binds only to `127.0.0.1`, checks the loopback peer and exact Host header, requires a high-entropy bearer token, denies unlisted browser Origins, rate-limits requests, caps concurrent handlers at 16, applies a five-second socket timeout, closes responses, and exposes only `GET /v1/ultron/status`.

This loopback server is not used by the cloud pairing/heartbeat/action relay. Do not expose its port to the LAN or internet.

## Verification boundary

Automated tests cover pairing, token hashing, heartbeat identity, device inventory, revocation, fixed action allowlists, owner/online checks, atomic claiming, result-code validation, local terminal approval, expiry and credential-file security. They are not a substitute for applying the migrations to a dedicated Supabase test project, pairing a physical Windows PC, and confirming live heartbeat/action/denial/revocation in the deployed environment.

The new local-action migration is a source change only; it has not been applied to production. This branch is not deployed. Live Windows action execution is not claimed.
