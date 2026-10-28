# ULTRON Windows approved-action bridge

This bridge provides a small, explicit-consent path from the ULTRON backend to the Windows wake companion. It is deliberately **not** a general remote shell or unrestricted PC-control agent.

## Allowed actions

The initial protocol accepts only:

- **launch_app** — launch exactly one of Notepad, Calculator, or Explorer with no command-line arguments.
- **system_info** — return OS version, architecture, and processor count only.

Shell commands, arbitrary executables/arguments, file reads/writes, screenshots, uploads, deletion, external messaging, and purchases are not part of this protocol.

## Approval and state flow

1. An authenticated user whose UUID matches **ULTRON_INTEGRATION_OWNER_USER_ID** requests an action using **POST /api/desktop/actions**.
2. The action is stored as **PENDING_APPROVAL**. Request fields cannot set status or skip approval.
3. The same owner approves using **POST /api/desktop/actions/:id/approve**. The database transition guard rejects illegal state transitions; audit events are written by a database trigger in the same transaction.
4. The signed-in owner can review the latest 20 actions with **GET /api/desktop/actions**, or cancel a **PENDING_APPROVAL**/**QUEUED** action using **POST /api/desktop/actions/:id/cancel**.
5. The Windows companion polls **POST /api/desktop/bridge/next** using a dedicated server/local bearer token. A database RPC claims one action atomically and leases it for 90 seconds. Expired leases may be retried at most three times.
6. The companion executes only its own allow-list and reports a small result to **POST /api/desktop/bridge/ack**. The acknowledgement includes the claim-attempt number; the server requires the attempt to match and the lease to still be live, so stale acknowledgements cannot overwrite a newer claim. Results must match the originally approved action; full URLs, arbitrary command output, environment variables, and file paths are not accepted as result data.

The lease provides bounded at-least-once recovery, not exactly-once execution: if Windows performs an action and then crashes before the server stores the acknowledgement, a later lease recovery may repeat an allowed action. The initial allow-list is limited to opening a URL, launching one of three basic apps, and returning system information; do not use it for actions that must never be repeated.

Terminal and state transitions are written to the server-authored **audit_events** table. The **desktop_actions** table has RLS enabled and all direct **anon**/**authenticated** table privileges revoked; only the authenticated owner APIs and the token-authenticated bridge can act through the server's restricted service-role helper.

## Configuration

Generate a high-entropy secret (at least 32 characters) out of band. Set the **same secret value** in:

- Server secret **ULTRON_DESKTOP_BRIDGE_TOKEN** (Render environment or local backend .env).
- The Windows user's environment variable **ULTRON_DESKTOP_BRIDGE_TOKEN**.

Never put the secret in source control, a browser bundle, a task payload, or chat. The Windows app does not save this secret. The server must also have **ULTRON_INTEGRATION_OWNER_USER_ID** set to the UUID of the account allowed to request/approve actions. The Windows user's optional **ULTRON_API_BASE_URL** must be an HTTPS base URL for ULTRON; if omitted, the companion uses the current hosted API base. The API returns a non-secret **bridgeConfigured** boolean that only reports whether a sufficiently long server token is present; it does not claim that the Windows PC is currently online or paired.

In Windows, launch the companion, tick **Enable approved PC actions**, and accept its separate consent prompt. The checkbox is off by default and does not inherit the wake-word auto-start setting. Untick it to stop polling.

## Agent usage

The authenticated agent router exposes the same narrow queue as tools:

- - Launch Notepad, Calculator, or Explorer on the Windows PC by asking ULTRON for the specific launch. This also only creates a pending action record.
- Ask ULTRON to list desktop actions to inspect IDs and states.
- To approve, send a new standalone prompt in this exact form: **approve action <full-action-UUID>**. The approval tool verifies that the current prompt itself contains this exact action ID and verb. An earlier message, model-generated string, or a generic "yes" does not grant approval.
- To cancel, send a new standalone prompt in this exact form: **cancel action <full-action-UUID>**. Only pending or queued actions can be cancelled.

Even after approval, an action is only queued; the Windows companion must be opted in, authenticated, online, and claim it before execution. ULTRON must not claim the PC action ran until the companion acknowledgement records a result.

## API shapes

Create a pending action:

~~~http
POST /api/desktop/actions
Content-Type: application/json

{"actionType":"launch_app","payload":{"app":"calculator"}}
~~~

External URL opening is disabled in this version. Validating DNS before launching a separate browser does not pin the browser's eventual destination, so the action queue cannot yet guarantee DNS-rebinding protection for browser navigation.

Read limited system information:

~~~json
{"actionType":"system_info","payload":{}}
~~~

By default, approval is a separate request to **POST /api/desktop/actions/<action-id>/approve**. For an owner who has deliberately opted into hands-free use on a paired test PC, set `ULTRON_DESKTOP_AUTONOMY_MODE=allowlisted` on the backend. In that mode, the API queues only the actions already accepted by `validateDesktopAction`: launching Notepad, Calculator, or Explorer with fixed paths, or returning the bounded system-info fields. No URL navigation, shell, arbitrary process arguments, file read/write, screenshot, upload/delete, or network navigation is enabled. The default is manual approval; the environment mode must be an explicit owner decision and never comes from model output. The bridge token never replaces owner authentication.

## Windows companion outbound API security

The companion's API client uses a custom `SocketsHttpHandler.ConnectCallback` rather than allowing a second system DNS lookup to choose the socket destination. Before connecting, it resolves all A/AAAA addresses for the configured ULTRON API host and rejects empty, mixed, private, loopback, link-local, or reserved answer sets. It then opens a TCP socket to one of the exact validated addresses. The HTTP request still uses the original URL hostname, so the handler's normal TLS certificate validation and SNI continue to use that hostname.

Automatic redirects are disabled, the client does not use a system proxy that could bypass its pinning policy, TCP connection timeouts are bounded, and HTTP is permitted only for explicit local loopback development. Corporate environments that require an outbound proxy may therefore fail closed rather than silently fall back to a less controlled route.

The Windows CI workflow runs `--verify-network-policy` after compiling the app. This self-test covers public/reserved IPv4 and IPv6 classification, mixed DNS answer rejection, and an actual bounded HTTP request through the same pinned handler to a temporary loopback listener. The request never leaves the local machine. It proves the transport callback and deterministic policy checks run on Windows CI; it does **not** prove that this companion has been paired or executed on the user's own Windows device.

## Important deployment boundary

This branch only adds source code and a Supabase migration file. The migration has **not** been applied to the live Supabase project and the backend has **not** been deployed from this branch. The endpoints will not work on the currently deployed API until the migration and application revision are deployed together. Do not enable the companion bridge before that rollout and a test on a non-sensitive Windows session.
