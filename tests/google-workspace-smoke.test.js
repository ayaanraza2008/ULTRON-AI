import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Google Workspace live smoke check is inert unless explicitly confirmed", () => {
  const run = spawnSync(process.execPath, ["scripts/google-workspace-smoke.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ULTRON_GOOGLE_WORKSPACE_SMOKE_CONFIRM: "",
      GOOGLE_WORKSPACE_BRIDGE_URL: "https://script.google.com/macros/s/FAKE_DEPLOYMENT_ID_123456789/exec",
      GOOGLE_WORKSPACE_BRIDGE_TOKEN: "test-only-not-a-real-secret-1234567890",
      ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
    }
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /SKIPPED/);
  assert.match(run.stdout, /No network request was made/);
  assert.doesNotMatch(run.stdout + run.stderr, /test-only-not-a-real-secret/);
});
