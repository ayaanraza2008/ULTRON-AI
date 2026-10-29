# ULTRON Google Workspace read-only bridge

This adapter brings a subset of the JARVIS Experiment's Google Workspace capability into ULTRON without copying its unauthenticated write/delete behavior.

## Supported actions

- List unread Gmail message summaries.
- Search Gmail and return bounded summaries/snippets.
- Read Calendar events within a maximum 90-day range.
- List Drive metadata by a short name query and allowed MIME category.
- Read plain text from a Google Docs file ID.
- Read a bounded Google Sheets A1 range (up to 40 rows × 20 columns).

Email sending, archiving/modifying messages, creating/canceling events, creating/renaming/moving/deleting Drive files, and writing/appending Sheets are intentionally not exposed.

## Setup

1. Create an Apps Script project at https://script.google.com and paste `google-workspace-bridge/Code.gs` into `Code.gs`.
2. Open **Project Settings → Script Properties** and add `ULTRON_BRIDGE_TOKEN`. Use a fresh random secret of at least 32 characters, for example:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```
   Do not commit the secret or paste it into chat.
3. Deploy as a **Web app**, execute as the Google account whose workspace you intend ULTRON to read, and copy the HTTPS deployment URL ending in `/exec`.
4. In ULTRON's server environment set:
   - `GOOGLE_WORKSPACE_BRIDGE_URL` = the exact Apps Script `/exec` URL
   - `GOOGLE_WORKSPACE_BRIDGE_TOKEN` = the same random secret stored in Script Properties
   - `ULTRON_INTEGRATION_OWNER_USER_ID` = the exact UUID of the intended ULTRON owner account
5. If you deploy the Apps Script web app with public web-app access, the script still rejects requests without the random body token and only permits the six read-only actions. Treat the token as a credential, restrict access where your deployment model allows, and rotate it immediately if exposed.
6. Restart/redeploy the ULTRON backend only after the user has reviewed the change and configured the secret. This pull request does not change production settings or perform a deployment.

## Verification and limits

The Node unit/agent tests use a mocked Google endpoint; they do not verify the user's real account, scopes, Apps Script deployment, Google quota, or production DNS/network access. The readiness state remains `configured_unverified` until live checks are performed. The bridge deliberately returns bounded fields rather than raw provider objects and does not return the token.


## Live smoke check (read-only)

After the Apps Script web app and all three backend environment variables are configured, run this command in a trusted terminal where those variables are set:

```bash
ULTRON_GOOGLE_WORKSPACE_SMOKE_CONFIRM=READ_ONLY_GMAIL_PROBE npm run smoke:google-workspace
```

PowerShell:

```powershell
$env:ULTRON_GOOGLE_WORKSPACE_SMOKE_CONFIRM = "READ_ONLY_GMAIL_PROBE"
npm run smoke:google-workspace
```

This performs exactly one read-only Gmail list request with a limit of one. It prints only pass/fail metadata and never logs message subjects, senders, snippets, or the bridge token. Without the explicit confirmation flag, it exits as skipped and makes no network request. A passing smoke check verifies the deployed bridge, token, current Apps Script authorization and network path; it does not enable write actions or validate the other five actions.
