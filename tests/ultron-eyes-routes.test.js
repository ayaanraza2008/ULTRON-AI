import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

const TEST_FRAME_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function withEyesRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
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

test("ULTRON EYES Routes: Device enumeration & default selection", async () => {
  await withEyesRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/eyes/devices");
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.devices));
    assert.ok(body.devices.length >= 4);
    assert.ok(body.defaultCamera);

    // Switch default camera
    const switchRes = await fetch(base + "/api/jarvis/eyes/devices/default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "cam-usb-1" })
    });
    const switchBody = await switchRes.json();

    assert.equal(switchRes.status, 200);
    assert.equal(switchBody.success, true);
    assert.equal(switchBody.defaultCamera.id, "cam-usb-1");
  });
});

test("ULTRON EYES Routes: Session lifecycle with explicit consent enforcement", async () => {
  await withEyesRouter({}, async base => {
    // 1. Check initial status
    const statRes = await fetch(base + "/api/jarvis/eyes/session/status");
    const statBody = await statRes.json();
    assert.equal(statRes.status, 200);
    assert.equal(statBody.success, true);

    // 2. Start WITHOUT consent -> expect 403 Forbidden
    const deniedRes = await fetch(base + "/api/jarvis/eyes/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: false })
    });
    const deniedBody = await deniedRes.json();
    assert.equal(deniedRes.status, 403);
    assert.ok(deniedBody.error.message.includes("PERMISSION_DENIED"));

    // 3. Start WITH explicit consent -> 200 OK
    const startRes = await fetch(base + "/api/jarvis/eyes/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true, fps: 2, resolution: "720p" })
    });
    const startBody = await startRes.json();
    assert.equal(startRes.status, 200);
    assert.equal(startBody.success, true);
    assert.equal(startBody.state, "ACTIVE_STREAMING");

    // 4. Pause session
    const pauseRes = await fetch(base + "/api/jarvis/eyes/session/pause", { method: "POST" });
    const pauseBody = await pauseRes.json();
    assert.equal(pauseRes.status, 200);
    assert.equal(pauseBody.state, "PAUSED");

    // 5. Resume session
    const resumeRes = await fetch(base + "/api/jarvis/eyes/session/resume", { method: "POST" });
    const resumeBody = await resumeRes.json();
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeBody.state, "ACTIVE_STREAMING");

    // 6. Stop session
    const stopRes = await fetch(base + "/api/jarvis/eyes/session/stop", { method: "POST" });
    const stopBody = await stopRes.json();
    assert.equal(stopRes.status, 200);
    assert.equal(stopBody.state, "STOPPED");
  });
});

test("ULTRON EYES Routes: Real-time frame processing, OCR, Visual Q&A and Memory", async () => {
  await withEyesRouter({}, async base => {
    // Start session
    await fetch(base + "/api/jarvis/eyes/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true, fps: 2 })
    });

    // Ingest frame
    const frameRes = await fetch(base + "/api/jarvis/eyes/frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameData: TEST_FRAME_DATA_URL })
    });
    const frameBody = await frameRes.json();

    assert.equal(frameRes.status, 200);
    assert.equal(frameBody.success, true);
    assert.ok(frameBody.observation.observationId.startsWith("obs-"));
    assert.ok(frameBody.observation.objects.length >= 3);
    assert.equal(frameBody.observation.textAndOcr.hasText, true);

    // Visual Q&A Query
    const queryRes = await fetch(base + "/api/jarvis/eyes/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "ULTRON, mere saamne kya hai?" })
    });
    const queryBody = await queryRes.json();

    assert.equal(queryRes.status, 200);
    assert.equal(queryBody.success, true);
    assert.ok(queryBody.answer.includes("workstation"));
    assert.ok(queryBody.directlyObserved.length > 0);
    assert.equal(typeof queryBody.uncertaintyScore, "number");

    // Snapshot Capture
    const snapRes = await fetch(base + "/api/jarvis/eyes/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Integration test snapshot", consent: true })
    });
    const snapBody = await snapRes.json();

    assert.equal(snapRes.status, 200);
    assert.equal(snapBody.success, true);
    assert.ok(snapBody.snapshot.snapshotId.startsWith("snap-"));

    // Check Visual Memory
    const memRes = await fetch(base + "/api/jarvis/eyes/memory");
    const memBody = await memRes.json();

    assert.equal(memRes.status, 200);
    assert.equal(memBody.success, true);
    assert.ok(memBody.memory.memoryCount >= 1);

    // Clear Visual Memory
    const clearRes = await fetch(base + "/api/jarvis/eyes/memory/clear", { method: "POST" });
    const clearBody = await clearRes.json();

    assert.equal(clearRes.status, 200);
    assert.equal(clearBody.success, true);

    // Verify Memory is 0
    const memRes2 = await fetch(base + "/api/jarvis/eyes/memory");
    const memBody2 = await memRes2.json();
    assert.equal(memBody2.memory.memoryCount, 0);

    // Stop session
    await fetch(base + "/api/jarvis/eyes/session/stop", { method: "POST" });
  });
});
