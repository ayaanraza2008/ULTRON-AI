import { runGoogleWorkspaceReadAction } from "../integrations/google-workspace.js";

const CONFIRM_VALUE = "READ_ONLY_GMAIL_PROBE";
const env = process.env;

if (env.ULTRON_GOOGLE_WORKSPACE_SMOKE_CONFIRM !== CONFIRM_VALUE) {
  console.log("SKIPPED: Set ULTRON_GOOGLE_WORKSPACE_SMOKE_CONFIRM=READ_ONLY_GMAIL_PROBE to authorize one read-only Gmail list request.");
  console.log("No network request was made. Never paste bridge credentials into chat or commit them.");
} else {
  const ownerId = String(env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim();
  if (!ownerId) {
    console.error("FAILED: ULTRON_INTEGRATION_OWNER_USER_ID is not configured.");
    process.exitCode = 2;
  } else {
    const result = await runGoogleWorkspaceReadAction({
      env,
      userId: ownerId,
      action: "gmail_list_unread",
      params: { limit: 1 }
    });

    // Emit only status metadata; never print message subjects, sender names,
    // snippets, tokens, or raw upstream payloads into CI/terminal logs.
    if (result.state === "completed") {
      console.log(JSON.stringify({
        state: "passed",
        provider: "google-workspace",
        action: "gmail_list_unread",
        sampledRecords: Math.min(1, Number(result.data?.emails?.length) || 0),
        bridgeResponse: "authenticated"
      }));
    } else {
      console.error(JSON.stringify({
        state: "failed",
        provider: "google-workspace",
        action: "gmail_list_unread",
        errorCode: result.error?.code || "GOOGLE_WORKSPACE_SMOKE_FAILED",
        message: result.error?.message || "Read-only bridge smoke test failed."
      }));
      process.exitCode = 1;
    }
  }
}
