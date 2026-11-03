import test from "node:test";
import assert from "node:assert/strict";
import { DioramaSpatialAdapter } from "../spatial/diorama-adapter.js";
import { EXECUTION_MODES } from "../spatial/hardware-detector.js";

const sampleImageBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("DioramaSpatialAdapter runs CPU geometric fallback cleanly", async () => {
  const adapter = new DioramaSpatialAdapter({ env: {} });
  const scene = await adapter.reconstructScene(sampleImageBase64, {
    forceMode: EXECUTION_MODES.CPU_METADATA_FALLBACK
  });

  assert.ok(scene.sceneId);
  assert.equal(scene.cudaAccelerated, false);
  assert.equal(scene.executionMode, EXECUTION_MODES.CPU_METADATA_FALLBACK);
  assert.equal(scene.remoteWorkerUsed, false);
  assert.equal(scene.remoteGpuReported, false);
  assert.equal(scene.inferenceStatus, "CPU_GEOMETRIC_FALLBACK");
  assert.ok(scene.architecture.floor.bounds);
  assert.ok(scene.objects.size >= 2);

  // Check object properties
  const desk = scene.getObject("obj-desk-primary");
  assert.ok(desk);
  assert.equal(desk.label, "desk");
  assert.ok(desk.pose3d.position.z > 0);
});

test("DioramaSpatialAdapter rejects empty and oversized inputs", async () => {
  const adapter = new DioramaSpatialAdapter({ env: {} });

  await assert.rejects(
    () => adapter.reconstructScene("not-an-image"),
    e => e.code === "INVALID_IMAGE_PAYLOAD"
  );

  const oversized = Buffer.alloc(6 * 1024 * 1024);
  await assert.rejects(
    () => adapter.reconstructScene(oversized),
    e => e.code === "IMAGE_TOO_LARGE"
  );
});

test("DioramaSpatialAdapter dispatches to remote GPU worker when configured", async () => {
  let captured;
  const mockFetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      sceneId: "spat-remote-001",
      pipeline: "diorama-remote-gpu",
      cudaAccelerated: true,
      inferenceStatus: "DIORAMA_MODEL_INFERENCE",
      architecture: {
        dimensions: { widthMeters: 4.5, lengthMeters: 5.5, heightMeters: 3.0 },
        floor: { bounds: { xMin: -2.25, xMax: 2.25, zMin: 0, zMax: 5.5 } }
      },
      objects: [
        { id: "obj-remote-1", label: "sofa", pose3d: { position: { x: 0, y: 0.5, z: 3.0 }, dimensions: { dx: 2.0, dy: 0.9, dz: 0.9 } } }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const adapter = new DioramaSpatialAdapter({
    env: {
      DIORAMA_REMOTE_ENDPOINT: "https://diorama-worker.internal.service",
      DIORAMA_REMOTE_TOKEN: "secret-worker-token"
    },
    fetchImpl: mockFetch
  });

  const scene = await adapter.reconstructScene(sampleImageBase64);
  assert.equal(scene.sceneId, "spat-remote-001");
  assert.equal(scene.cudaAccelerated, false);
  assert.equal(scene.executionMode, EXECUTION_MODES.REMOTE_GPU);
  assert.equal(scene.remoteWorkerUsed, true);
  assert.equal(scene.remoteGpuReported, true);
  assert.equal(scene.remoteInferenceStatusReported, "DIORAMA_MODEL_INFERENCE");
  assert.equal(scene.inferenceStatus, "REMOTE_RESULT_UNVERIFIED");
  assert.ok(captured.url.includes("/api/v1/diorama/reconstruct"));
  assert.equal(captured.init.headers["Authorization"], "Bearer secret-worker-token");
});

test("DioramaSpatialAdapter rejects invalid remote geometry instead of filling fake defaults", async () => {
  const adapter = new DioramaSpatialAdapter({
    env: { DIORAMA_REMOTE_ENDPOINT: "https://diorama-worker.example.com" },
    fetchImpl: async () => new Response(JSON.stringify({
      objects: [{
        id: "bad-object",
        label: "desk",
        pose3d: {
          position: { x: null, y: 0.5, z: 2 },
          dimensions: { dx: 1, dy: 1, dz: 1 }
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });

  await assert.rejects(
    () => adapter.reconstructScene(sampleImageBase64),
    error => error.code === "INVALID_SCENE_GRAPH"
  );
});

test("DioramaSpatialAdapter falls back to CPU when remote mode is forced without an endpoint", async () => {
  const adapter = new DioramaSpatialAdapter({ env: {} });
  const scene = await adapter.reconstructScene(sampleImageBase64, {
    forceMode: EXECUTION_MODES.REMOTE_GPU
  });

  assert.equal(scene.executionMode, EXECUTION_MODES.CPU_METADATA_FALLBACK);
  assert.equal(scene.cudaAccelerated, false);
  assert.equal(scene.remoteWorkerUsed, false);
  assert.equal(scene.inferenceStatus, "CPU_GEOMETRIC_FALLBACK");
});
