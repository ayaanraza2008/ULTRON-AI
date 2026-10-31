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

test("Media & System Routes: System control endpoints return drives and telemetry", async () => {
  await withRouter({}, async base => {
    // 1. List drives
    const drivesRes = await fetch(base + "/api/jarvis/system/drives");
    const drivesBody = await drivesRes.json();
    assert.equal(drivesRes.status, 200);
    assert.equal(drivesBody.success, true);
    assert.ok(Array.isArray(drivesBody.drives));

    // 2. Hardware performance vitals
    const perfRes = await fetch(base + "/api/jarvis/system/performance");
    const perfBody = await perfRes.json();
    assert.equal(perfRes.status, 200);
    assert.equal(perfBody.success, true);
    assert.ok(perfBody.performance.cpu);
    assert.ok(perfBody.performance.memory);
  });
});

test("Media & System Routes: Video timeline builder and prompt enhancement endpoints", async () => {
  await withRouter({}, async base => {
    // 1. Build timeline
    const timelineRes = await fetch(base + "/api/jarvis/media/video/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presetKey: "ACTION",
        title: "REST Timeline",
        targetDuration: 15
      })
    });
    const timelineBody = await timelineRes.json();
    assert.equal(timelineRes.status, 200);
    assert.equal(timelineBody.success, true);
    assert.equal(timelineBody.timeline.presetId, "action");

    // 2. Enhance image prompt
    const promptRes = await fetch(base + "/api/jarvis/media/image/enhance-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "cybernetic reactor core",
        style: "cyberpunk"
      })
    });
    const promptBody = await promptRes.json();
    assert.equal(promptRes.status, 200);
    assert.equal(promptBody.success, true);
    assert.ok(promptBody.enhanced.includes("neon glow"));
  });
});

test("Media & System Routes: Autonomous production endpoint executes 12-step pipeline", async () => {
  await withRouter({}, async base => {
    const prodRes = await fetch(base + "/api/jarvis/media/production/autonomous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "ULTRON, create a 10-second cinematic mystery reel using my existing footage."
      })
    });
    const prodBody = await prodRes.json();
    assert.equal(prodRes.status, 200);
    assert.equal(prodBody.success, true);
    assert.equal(prodBody.status, "COMPLETED");
    assert.equal(prodBody.stagesCompleted, 12);
    assert.ok(prodBody.videoExportPath);

    // Verify history endpoint
    const historyRes = await fetch(base + "/api/jarvis/media/production/history");
    const historyBody = await historyRes.json();
    assert.equal(historyRes.status, 200);
    assert.equal(historyBody.success, true);
    assert.ok(historyBody.history.length >= 1);
  });
});

test("Media & System Routes: Non-owner requests are rejected with 403 Forbidden", async () => {
  await withRouter({ userId: "intruder-user" }, async base => {
    const drivesRes = await fetch(base + "/api/jarvis/system/drives");
    assert.equal(drivesRes.status, 403);
    const drivesBody = await drivesRes.json();
    assert.equal(drivesBody.error.code, "ULTRON_OWNER_ONLY");

    const prodRes = await fetch(base + "/api/jarvis/media/production/autonomous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "unauthorized" })
    });
    assert.equal(prodRes.status, 403);
  });
});
