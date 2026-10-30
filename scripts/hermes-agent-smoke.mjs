import {
  checkHermesAgentService,
  getHermesAgentReadiness,
  getHermesAgentRunStatus,
  startHermesAgentRun,
  stopHermesAgentRun
} from "../integrations/hermes-agent.js";

const env = process.env;
const userId = typeof env.ULTRON_INTEGRATION_OWNER_USER_ID === "string"
  ? env.ULTRON_INTEGRATION_OWNER_USER_ID.trim()
  : "";
const runRequested = process.argv.slice(2).includes("--run");

function report(label, value) {
  // The adapter returns secret-free results; never print process.env or request headers.
  process.stdout.write(label + "\n" + JSON.stringify(value, null, 2) + "\n");
}

function fail(message, code = 1) {
  process.stderr.write("Hermes smoke failed: " + message + "\n");
  process.exitCode = code;
}

function clampTimeout(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 90_000;
  return Math.max(15_000, Math.min(180_000, Math.floor(number)));
}

async function main() {
  if (!userId) {
    fail("ULTRON_INTEGRATION_OWNER_USER_ID must be set to the authenticated owner's UUID.", 2);
    return;
  }

  const readiness = getHermesAgentReadiness(env);
  report("Hermes adapter readiness:", readiness);
  if (!readiness.configured) {
    fail("The Hermes adapter is not enabled/configured. No task was submitted.", 2);
    return;
  }

  const health = await checkHermesAgentService({ env, userId });
  report("Hermes API health:", health);
  if (health.state !== "completed") {
    fail("Model/capability checks did not both complete. No task was submitted.");
    return;
  }

  if (!runRequested) {
    process.stdout.write("Read-only check passed. Use --run only when you explicitly authorize the harmless live inference smoke.\n");
    return;
  }

  const started = await startHermesAgentRun({
    env,
    userId,
    conversationId: "ultron-hermes-live-smoke",
    task: "This is a harmless ULTRON integration smoke test. Do not use terminal, browser, filesystem, messaging, or other external tools. Return exactly the text HERMES_RUN_SMOKE_OK and state that no files or external resources were changed."
  });
  report("Hermes run submission:", started);
  if (started.state !== "started" || !started.runId) {
    fail("Hermes did not return a usable run ID.");
    return;
  }

  const timeoutMs = clampTimeout(env.HERMES_AGENT_SMOKE_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    lastStatus = await getHermesAgentRunStatus({ env, userId, runId: started.runId });
    if (lastStatus.terminal) break;
    if (lastStatus.state === "failed" || lastStatus.state === "blocked") break;
  }

  if (lastStatus?.status === "completed") {
    report("Hermes run completed:", lastStatus);
    if (!String(lastStatus.output || "").includes("HERMES_RUN_SMOKE_OK")) {
      fail("The run completed but did not return the expected smoke marker.");
      return;
    }
    process.stdout.write("Live Hermes inference smoke passed.\n");
    return;
  }

  if (lastStatus?.terminal) {
    report("Hermes run reached a terminal state:", lastStatus);
    fail("The Hermes run did not complete successfully.");
    return;
  }

  report("Hermes run did not finish before timeout:", lastStatus || { state: "unknown" });
  const stopped = await stopHermesAgentRun({ env, userId, runId: started.runId });
  report("Hermes stop request:", stopped);
  fail("Timed out waiting for the smoke run. Check Hermes provider/tool configuration and inspect its run status.");
}

main().catch(error => {
  // Do not print raw error objects because upstream libraries may attach request metadata.
  fail(error?.code || error?.name || "unexpected error");
});
