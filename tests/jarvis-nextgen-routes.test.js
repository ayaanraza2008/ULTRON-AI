import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

async function withRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
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

test("JARVIS Next-Gen Routes: GET /api/jarvis/nextgen/status reports 9 active subsystems", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/nextgen/status");
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(Object.keys(body.subsystems).length, 9);
    assert.equal(body.subsystems.ultronCore.status, "ACTIVE");
    assert.equal(body.subsystems.ultronAutonomy.status, "ACTIVE");
    assert.equal(body.subsystems.ultronGenesis.status, "ACTIVE");
    assert.equal(body.subsystems.ultronForge.status, "ACTIVE");
    assert.equal(body.subsystems.ultronRobotics.status, "ACTIVE");
    assert.equal(body.subsystems.ultronVision.status, "ACTIVE");
    assert.equal(body.subsystems.ultronNexus.status, "ACTIVE");
    assert.equal(body.subsystems.ultronGuardian.status, "ACTIVE");
    assert.equal(body.subsystems.humanInterface.status, "ACTIVE");
  });
});

test("JARVIS Next-Gen Routes: POST /api/jarvis/nextgen/autonomy/plan decomposes goal", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/nextgen/autonomy/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Build and test telemetry module", autoRun: false })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.plan.id.startsWith("plan-"));
    assert.ok(body.plan.subTasks.length >= 2);
  });
});

test("JARVIS Next-Gen Routes: POST /api/jarvis/nextgen/forge/security-scan flags secrets", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/nextgen/forge/security-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: `const apiKey = "${fakeOpenAiKey}";` })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.secure, false);
    assert.ok(body.findings.some(f => f.id === "HARDCODED_SECRET"));
  });
});
