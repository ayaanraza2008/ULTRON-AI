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

test("Singularity Routes: Robotics HAL endpoints register robot and execute safe motion", async () => {
  await withRouter({}, async base => {
    // 1. Register robot
    const regRes = await fetch(base + "/api/jarvis/robotics/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        robotId: "ros2-quadruped-01",
        name: "Quadruped Rover",
        sensors: ["lidar", "depth_camera", "battery_monitor"],
        actuators: ["mecanum_drive"]
      })
    });
    const regBody = await regRes.json();
    assert.equal(regRes.status, 200);
    assert.equal(regBody.success, true);
    assert.equal(regBody.robotId, "ros2-quadruped-01");

    // 2. Dispatch valid motion
    const motionRes = await fetch(base + "/api/jarvis/robotics/motion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        robotId: "ros2-quadruped-01",
        command: {
          linearVelocity: 0.5,
          angularVelocity: 0.2,
          targetPosition: { x: 5, y: 5, z: 0.5 }
        }
      })
    });
    const motionBody = await motionRes.json();
    assert.equal(motionRes.status, 200);
    assert.equal(motionBody.permitted, true);

    // 3. Dispatch out-of-bounds geofence motion (should be rejected with 403)
    const badMotionRes = await fetch(base + "/api/jarvis/robotics/motion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        robotId: "ros2-quadruped-01",
        command: {
          linearVelocity: 0.5,
          targetPosition: { x: 100, y: 100, z: 10 }
        }
      })
    });
    assert.equal(badMotionRes.status, 403);

    // 4. Brain export package
    const exportRes = await fetch(base + "/api/jarvis/robotics/export-brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIdentity: "ULTRON-SINGULARITY-MASTER" })
    });
    const exportBody = await exportRes.json();
    assert.equal(exportRes.status, 200);
    assert.equal(exportBody.success, true);
    assert.ok(exportBody.package.signature);
  });
});

test("Singularity Routes: Offline/Online Connection Controller status and mode routing", async () => {
  await withRouter({}, async base => {
    // 1. Get status
    const statusRes = await fetch(base + "/api/jarvis/connection/status");
    const statusBody = await statusRes.json();
    assert.equal(statusRes.status, 200);
    assert.ok(statusBody.mode);

    // 2. Evaluate task route for local TTS
    const evalRes = await fetch(base + "/api/jarvis/connection/evaluate-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskType: "kokoro_tts" })
    });
    const evalBody = await evalRes.json();
    assert.equal(evalRes.status, 200);
    assert.equal(evalBody.canExecute, true);
  });
});

test("Singularity Routes: Multi-Domain Knowledge Vault index, query and stats", async () => {
  await withRouter({}, async base => {
    // 1. Index knowledge entry
    const indexRes = await fetch(base + "/api/jarvis/knowledge/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "computer_science",
        topic: "Dijkstra Shortest Path",
        content: "Dijkstra's algorithm finds single-source shortest paths on graphs with non-negative edge weights.",
        quality: "FACT"
      })
    });
    const indexBody = await indexRes.json();
    assert.equal(indexRes.status, 200);
    assert.equal(indexBody.success, true);

    // 2. Query knowledge
    const queryRes = await fetch(base + "/api/jarvis/knowledge/query?q=Dijkstra+shortest+path");
    const queryBody = await queryRes.json();
    assert.equal(queryRes.status, 200);
    assert.ok(queryBody.resultsCount >= 1);

    // 3. Stats
    const statsRes = await fetch(base + "/api/jarvis/knowledge/stats");
    const statsBody = await statsRes.json();
    assert.equal(statsRes.status, 200);
    assert.ok(statsBody.totalEntries >= 4);
  });
});

test("Singularity Routes: Cybersecurity defensive audit and scope authorization", async () => {
  await withRouter({}, async base => {
    // 1. Audit on authorized localhost
    const auditRes = await fetch(base + "/api/jarvis/security/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "localhost",
        headers: { "Content-Security-Policy": "default-src 'self'" }
      })
    });
    const auditBody = await auditRes.json();
    assert.equal(auditRes.status, 200);
    assert.equal(auditBody.success, true);
    assert.ok(auditBody.report.assessmentId);

    // 2. Audit on prohibited target returns 403
    const badAuditRes = await fetch(base + "/api/jarvis/security/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "unauthorized-external-server.com"
      })
    });
    assert.equal(badAuditRes.status, 403);
  });
});

test("Singularity Routes: Geographic distance calculation and privacy consent gating", async () => {
  await withRouter({}, async base => {
    // 1. Calculate distance
    const distRes = await fetch(base + "/api/jarvis/geo/distance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat1: 40.7128, lon1: -74.0060,
        lat2: 51.5074, lon2: -0.1278
      })
    });
    const distBody = await distRes.json();
    assert.equal(distRes.status, 200);
    assert.ok(distBody.distanceKm > 5500);

    // 2. Issue consent token
    const consentRes = await fetch(base + "/api/jarvis/geo/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "pilot-drone-01",
        consentDurationMinutes: 15
      })
    });
    const consentBody = await consentRes.json();
    assert.equal(consentRes.status, 200);
    assert.ok(consentBody.token);

    // 3. Verify location sharing
    const verifyRes = await fetch(base + "/api/jarvis/geo/verify-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: consentBody.token,
        coords: { lat: 37.7749, lon: -122.4194 }
      })
    });
    const verifyBody = await verifyRes.json();
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyBody.permitted, true);

    // 4. Revoke consent
    const revokeRes = await fetch(base + "/api/jarvis/geo/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: consentBody.token })
    });
    const revokeBody = await revokeRes.json();
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeBody.revoked, true);
  });
});
