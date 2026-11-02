import test from "node:test";
import assert from "node:assert/strict";
import { SpatialIntelligenceEngine, JOB_STATUS } from "../spatial/spatial-engine.js";

const sampleImageBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("SpatialIntelligenceEngine creates and completes 3D reconstruction job", async () => {
  const engine = new SpatialIntelligenceEngine();
  const created = await engine.createJob("user-alice", sampleImageBase64);

  assert.ok(created.jobId.startsWith("spat-job-"));
  assert.ok([JOB_STATUS.QUEUED, JOB_STATUS.PROCESSING].includes(created.status));

  // Wait briefly for the async pipeline to complete
  await new Promise(r => setTimeout(r, 200));

  const job = engine.getJob(created.jobId, "user-alice");
  assert.equal(job.status, JOB_STATUS.COMPLETED);
  assert.equal(job.progress, 100);
  assert.ok(job.sceneGraph);
  assert.ok(job.sceneGraph.objects.length > 0);
});

test("SpatialIntelligenceEngine enforces strict user isolation", async () => {
  const engine = new SpatialIntelligenceEngine();
  const created = await engine.createJob("user-alice", sampleImageBase64);

  // Bob attempts to read Alice's job
  assert.throws(
    () => engine.getJob(created.jobId, "user-bob"),
    /Access to this spatial job is restricted/
  );

  // Bob attempts to cancel Alice's job
  assert.throws(
    () => engine.cancelJob(created.jobId, "user-bob"),
    /Access to this spatial job is restricted/
  );

  // Bob attempts to delete Alice's job
  assert.throws(
    () => engine.deleteJob(created.jobId, "user-bob"),
    /Access to this spatial job is restricted/
  );
});

test("SpatialIntelligenceEngine exports 3D scene assets and answers spatial queries", async () => {
  const engine = new SpatialIntelligenceEngine();
  const created = await engine.createJob("user-alice", sampleImageBase64);
  await new Promise(r => setTimeout(r, 200));

  // Export OBJ
  const objExport = engine.exportSceneAsset(created.jobId, "user-alice", "obj");
  assert.equal(objExport.format, "obj");
  assert.ok(objExport.content.includes("o Architecture_Floor"));

  // Export GLTF
  const gltfExport = engine.exportSceneAsset(created.jobId, "user-alice", "gltf");
  assert.equal(gltfExport.format, "gltf");
  assert.ok(gltfExport.content.includes("Room_Floor"));

  // Query scene
  const queryRes = engine.queryScene(created.jobId, "user-alice", "Where is the desk?");
  assert.equal(queryRes.found, true);
  assert.match(queryRes.answer, /desk/i);

  // Spatial context for AI Brain
  const brainCtx = engine.getSpatialBrainContext("user-alice", "Where is the desk located in my room?");
  assert.ok(brainCtx);
  assert.ok(brainCtx.summary.includes("3D Spatial Scene Graph"));
});

test("SpatialIntelligenceEngine deletes job and scrubs resources", async () => {
  const engine = new SpatialIntelligenceEngine();
  const created = await engine.createJob("user-alice", sampleImageBase64);
  await new Promise(r => setTimeout(r, 200));

  const deleted = engine.deleteJob(created.jobId, "user-alice");
  assert.equal(deleted, true);

  const missing = engine.getJob(created.jobId, "user-alice");
  assert.equal(missing, null);
});
