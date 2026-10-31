import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

async function withRouter({ env = {}, userId = "owner-user" } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("JARVIS router refuses to construct without real Supabase authentication middleware", () => {
  assert.throws(
    () => createJarvisRouter({ env: {} }),
    /requires the authenticated Supabase user middleware/
  );
});

test("JARVIS routes fail closed when the owner account is not configured", async () => {
  await withRouter({ env: {} }, async base => {
    const response = await fetch(base + "/api/jarvis/telemetry");
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "ULTRON_OWNER_NOT_CONFIGURED");
  });
});

test("JARVIS routes reject authenticated users other than the configured owner", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" },
    userId: "different-user"
  }, async base => {
    const response = await fetch(base + "/api/jarvis/agents");
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "ULTRON_OWNER_ONLY");
  });
});

test("configured owner can read JARVIS status without misreporting the hosted OS as Windows", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/telemetry");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.telemetry.platform, process.platform);
    assert.equal(body.telemetry.architecture, process.arch);
    assert.equal(body.telemetry.executionEnvironment, "hosted_or_local_runtime");
  });
});

test("JARVIS does not expose normal Node child-process execution as a sandbox", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/sandbox/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "throw new Error('must_not_execute')" })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "CODE_SANDBOX_NOT_AVAILABLE");
  });
});

test("JARVIS refuses fake task completion until a real tool executor is connected", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const response = await fetch(base + "/api/jarvis/agents/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Do not pretend to execute",
        targetAgentId: "ultron-core",
        steps: [{ id: "step-1", action: "unsafe_placeholder" }]
      })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "JARVIS_TASK_EXECUTOR_UNAVAILABLE");
  });
});

test("JARVIS keeps unbacked device and smart-home prototypes unavailable", async () => {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }
  }, async base => {
    const pair = await fetch(base + "/api/jarvis/devices/pair/request", { method: "POST" });
    assert.equal(pair.status, 503);
    assert.equal((await pair.json()).error.code, "DEVICE_PAIRING_NOT_CONFIGURED");

    const devices = await fetch(base + "/api/jarvis/devices");
    assert.equal(devices.status, 200);
    assert.deepEqual(await devices.json(), { devices: [], connected: false, status: "NOT_CONFIGURED" });

    const actuate = await fetch(base + "/api/jarvis/smarthome/actuate", { method: "POST" });
    assert.equal(actuate.status, 503);
    assert.equal((await actuate.json()).error.code, "SMART_HOME_NOT_CONFIGURED");
  });
});
