import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createSpatialRouter } from "../spatial/spatial-router.js";
import { SpatialIntelligenceEngine } from "../spatial/spatial-engine.js";
import { SpatialSceneGraph } from "../spatial/scene-graph.js";

const sampleImageBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function withSpatialServer({ userId = "user-alice", engine = new SpatialIntelligenceEngine() } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use("/api", createSpatialRouter({ requireSupabaseUser, engine }));

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port, engine);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("spatial router refuses to construct without requireSupabaseUser middleware", () => {
  assert.throws(
    () => createSpatialRouter({}),
    /requires the authenticated Supabase user middleware/
  );
});

test("spatial router exposes hardware status and engine health", async () => {
  await withSpatialServer({}, async base => {
    const res = await fetch(base + "/api/spatial/status");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.engine, "ULTRON SPATIAL INTELLIGENCE");
    assert.equal(body.status, "DEGRADED_METADATA_ONLY");
    assert.equal(body.hardware.capabilities.canReconstruct3D, false);
    assert.ok(body.hardware.host.cpuCores >= 1);
  });
});

test("spatial router executes complete reconstruction lifecycle, export, and query", async () => {
  const fixtureAdapter = {
    async reconstructScene() {
      return new SpatialSceneGraph({
        sceneId: "router-spatial-test-fixture",
        pipeline: "unit-test-fixture",
        inferenceStatus: "TEST_FIXTURE",
        objects: [
          { id: "desk-fixture", label: "desk", pose3d: { position: { x: 0, y: 0.4, z: 2 }, dimensions: { dx: 1.2, dy: 0.8, dz: 0.6 } } }
        ]
      });
    }
  };
  const sharedEngine = new SpatialIntelligenceEngine({ adapter: fixtureAdapter });

  await withSpatialServer({ userId: "user-alice", engine: sharedEngine }, async base => {
    // 1. Submit job
    const createRes = await fetch(base + "/api/spatial/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: sampleImageBase64 })
    });
    assert.equal(createRes.status, 202);
    const createBody = await createRes.json();
    const jobId = createBody.job.jobId;
    assert.ok(jobId.startsWith("spat-job-"));

    // Wait for reconstruction
    await new Promise(r => setTimeout(r, 220));

    // 2. Poll job status
    const pollRes = await fetch(base + `/api/spatial/jobs/${jobId}`);
    assert.equal(pollRes.status, 200);
    const pollBody = await pollRes.json();
    assert.equal(pollBody.job.status, "COMPLETED");
    assert.equal(pollBody.job.progress, 100);
    assert.equal(pollBody.job.sceneGraph.inferenceStatus, "TEST_FIXTURE");
    assert.equal(pollBody.job.sceneGraph.metadataOnly, false);

    // 3. Export OBJ
    const exportRes = await fetch(base + `/api/spatial/jobs/${jobId}/export/obj`);
    assert.equal(exportRes.status, 200);
    const objText = await exportRes.text();
    assert.ok(objText.includes("o Architecture_Floor"));

    // 4. Query spatial relationships
    const queryRes = await fetch(base + `/api/spatial/jobs/${jobId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Where is the desk?" })
    });
    assert.equal(queryRes.status, 200);
    const queryBody = await queryRes.json();
    assert.equal(queryBody.result.found, true);
  });
});

test("spatial router refuses geometry export from metadata-only CPU fallback", async () => {
  await withSpatialServer({}, async base => {
    const createRes = await fetch(base + "/api/spatial/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: sampleImageBase64 })
    });
    assert.equal(createRes.status, 202);
    const jobId = (await createRes.json()).job.jobId;
    await new Promise(r => setTimeout(r, 100));

    const exportRes = await fetch(base + `/api/spatial/jobs/${jobId}/export/obj`);
    assert.equal(exportRes.status, 409);
    const body = await exportRes.json();
    assert.equal(body.error.code, "SCENE_GEOMETRY_UNAVAILABLE");
  });
});

test("spatial router rejects unauthorized cross-user access with 403", async () => {
  const sharedEngine = new SpatialIntelligenceEngine();
  const aliceJob = await sharedEngine.createJob("user-alice", sampleImageBase64);
  await new Promise(r => setTimeout(r, 200));

  // Access Alice's job as Bob
  await withSpatialServer({ userId: "user-bob", engine: sharedEngine }, async base => {
    const res = await fetch(base + `/api/spatial/jobs/${aliceJob.jobId}`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "FORBIDDEN");
  });
});
