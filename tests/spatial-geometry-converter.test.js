import test from "node:test";
import assert from "node:assert/strict";
import { SpatialSceneGraph } from "../spatial/scene-graph.js";
import { sceneToObj, sceneToGltf, parseAndValidateObj } from "../spatial/geometry-converter.js";

test("sceneToObj exports valid Wavefront OBJ with floor and 3D object boxes", () => {
  const scene = new SpatialSceneGraph({
    objects: [
      { id: "obj-table", label: "table", pose3d: { position: { x: 0, y: 0.5, z: 2 }, dimensions: { dx: 1.0, dy: 0.7, dz: 0.8 } } }
    ]
  });

  const objContent = sceneToObj(scene);
  assert.ok(objContent.includes("o Architecture_Floor"));
  assert.ok(objContent.includes("o table_obj-table"));
  assert.ok(objContent.includes("v "));
  assert.ok(objContent.includes("f "));

  // Validate the generated OBJ using parseAndValidateObj
  const parsed = parseAndValidateObj(objContent);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.vertexCount, 12); // 4 floor + 8 table vertices
  assert.equal(parsed.faceCount, 7);    // 1 floor quad + 6 table quads
  assert.ok(parsed.boundingVolume > 0);
});

test("sceneToGltf generates standard GLTF 2.0 JSON structure", () => {
  const scene = new SpatialSceneGraph({
    objects: [
      { id: "obj-chair", label: "chair", pose3d: { position: { x: 0.5, y: 0.4, z: 1.5 }, dimensions: { dx: 0.5, dy: 0.8, dz: 0.5 } } }
    ]
  });

  const gltf = sceneToGltf(scene);
  assert.equal(gltf.asset.version, "2.0");
  assert.equal(gltf.nodes.length, 2); // Floor + Chair
  assert.equal(gltf.nodes[1].name, "chair_obj-chair");
  assert.deepEqual(gltf.nodes[1].translation, [0.5, 0.4, 1.5]);
});
