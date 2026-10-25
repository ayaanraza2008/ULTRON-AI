# Windows Desktop Companion Protocol (v1)

## Scope

This document defines the first ULTRON backend contract for checking whether a Windows companion is paired and reachable. The current ULTRON adapter is **status-only**. It does not execute PowerShell or shell commands, read local files, click/press keys, move the mouse, capture screenshots, install software, or shut down/restart the PC.

A Windows companion runtime and its pairing flow must be installed and independently verified before ULTRON can report a device as paired.

## Configuration

Configure these variables on the ULTRON server, not in a public client:

- `ULTRON_DESKTOP_AGENT_URL`: the companion HTTPS origin, without a path, query, or fragment.
- `ULTRON_DESKTOP_AGENT_TOKEN`: a high-entropy server-to-companion bearer token.
- `ULTRON_INTEGRATION_OWNER_USER_ID`: exact Supabase Auth UUID of the one account allowed to use this shared companion credential.

Do not commit or return the bearer token. Public remote endpoints must use HTTPS. The adapter rejects local/private/link-local/metadata/reserved network targets using the shared upstream host policy; production also needs outbound network controls and DNS-rebinding protections. A cloud-hosted Render process cannot connect to a PC's private LAN or its `localhost` without a separately reachable, authenticated gateway.

## Request

The owner-scoped `check_desktop_companion` agent tool makes one request:

```http
GET /v1/ultron/status
Accept: application/json
Authorization: Bearer <server-side-token>
X-ULTRON-Protocol-Version: 1
```

The request must not be redirected. The request timeout is 8 seconds. A response over 64 KiB or a non-streamable/unbounded body is rejected.

## Successful response

Return HTTP 200 with JSON matching the following shape:

```json
{
  "protocolVersion": 1,
  "device": {
    "id": "stable-device-id",
    "name": "Ayaan-PC",
    "platform": "windows",
    "paired": true,
    "online": true,
    "lastSeenAt": "2026-10-25T15:00:00.000Z"
  },
  "capabilities": ["status", "system_info"]
}
```

`protocolVersion` must be the integer `1`. `device.id` and `device.name` must be non-empty strings. `platform` must equal `windows`. `paired` and `online` must be booleans. `lastSeenAt` is optional. `capabilities` must be an array; the ULTRON adapter only reports the currently allowlisted read-only capabilities `status` and `system_info`. Unknown capability names are ignored.

The adapter returns one of these states:

- `completed`: valid protocol response, paired device, and device reports online.
- `needs_pairing`: the endpoint is reachable, but the device reports not paired.
- `offline`: the endpoint responds but the device reports offline.
- `blocked` or `failed`: missing configuration, owner denial, authentication failure, timeout, unsafe/unreadable response, or protocol mismatch.

A reachable endpoint is not sufficient proof of secure device pairing. The companion must authenticate the server token, bind the pairing to the expected owner/device, use a protected local IPC boundary, and provide clear user consent before any future action.

## Security boundary for future actions

Do not add generic `run_command`, arbitrary PowerShell, unrestricted filesystem access, stealth/background control, or “execute anything” endpoints to this protocol. Any future PC actions need a separate allowlisted command schema, per-action permission and approval checks, device identity/pairing, audit events, an emergency stop, and time/size limits. Sensitive or destructive actions must require task-specific confirmation. The current adapter never calls those actions and never treats a model-generated response as permission.

## Verification status

The ULTRON backend now has a bounded, owner-scoped status client and automated tests for authorization, response validation, and oversized-body cancellation. This does **not** mean a Windows companion is installed or live-verified; deployment must wait until a compatible companion and its pairing/token workflow are implemented and tested.
