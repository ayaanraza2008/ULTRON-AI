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
  assert.equal(scene.cudaAccelerated, true);
  assert.ok(captured.url.includes("/api/v1/diorama/reconstruct"));
  assert.equal(captured.init.headers["Authorization"], "Bearer secret-worker-token");
});
