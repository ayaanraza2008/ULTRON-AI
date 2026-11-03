import test from "node:test";
import assert from "node:assert/strict";
import { SpatialSceneGraph, OBJECT_CATEGORIES } from "../spatial/scene-graph.js";

test("SpatialSceneGraph populates objects, calculates nearest neighbors, and physical support", () => {
  const scene = new SpatialSceneGraph({
    objects: [
      {
        id: "obj-desk",
        label: "desk",
        pose3d: { position: { x: 0.0, y: 0.35, z: 2.0 }, dimensions: { dx: 1.2, dy: 0.7, dz: 0.8 } }
      },
      {
        id: "obj-monitor",
        label: "monitor",
        pose3d: { position: { x: 0.0, y: 0.85, z: 2.0 }, dimensions: { dx: 0.5, dy: 0.35, dz: 0.1 } }
      },
      {
        id: "obj-chair",
        label: "chair",
        pose3d: { position: { x: 0.0, y: 0.45, z: 1.2 }, dimensions: { dx: 0.5, dy: 0.9, dz: 0.5 } }
      }
    ]
  });

  const desk = scene.getObject("obj-desk");
  const monitor = scene.getObject("obj-monitor");
  const chair = scene.getObject("obj-chair");

  assert.equal(desk.category, OBJECT_CATEGORIES.FURNITURE);
  assert.equal(monitor.category, OBJECT_CATEGORIES.ELECTRONICS);
  assert.equal(desk.confidence, null);
  assert.equal(desk.provenance, "UNAVAILABLE");
  assert.equal(desk.cadRetrieval.source, "UNVERIFIED");
  assert.equal(desk.cadRetrieval.retrievalScore, null);

  // Support hierarchy
  assert.equal(monitor.spatialRelations.supportedBy, "obj-desk");
  assert.ok(desk.spatialRelations.supports.includes("obj-monitor"));

  // Nearest neighbors
  assert.ok(chair.spatialRelations.nearestObjects.length > 0);
  assert.equal(chair.spatialRelations.nearestObjects[0].id, "obj-desk");
});

test("SpatialSceneGraph answers natural language spatial queries correctly", () => {
  const scene = new SpatialSceneGraph({
    objects: [
      { id: "desk-1", label: "desk", pose3d: { position: { x: 0, y: 0.4, z: 2 }, dimensions: { dx: 1.2, dy: 0.8, dz: 0.6 } } },
      { id: "chair-1", label: "chair", pose3d: { position: { x: 0, y: 0.4, z: 1.2 }, dimensions: { dx: 0.5, dy: 0.8, dz: 0.5 } } },
      { id: "chair-2", label: "chair", pose3d: { position: { x: 0.8, y: 0.4, z: 1.2 }, dimensions: { dx: 0.5, dy: 0.8, dz: 0.5 } } }
    ]
  });

  // Count query
  const countRes = scene.querySpatial("How many chairs are visible in this room?");
  assert.equal(countRes.count, 2);
  assert.match(countRes.answer, /2 chairs/);

  // Position query
  const posRes = scene.querySpatial("Where is the desk located?");
  assert.equal(posRes.found, true);
  assert.match(posRes.answer, /X: 0m/);

  // Nearest neighbor query
  const nearestRes = scene.querySpatial("What is the nearest object to the desk?");
  assert.equal(nearestRes.found, true);
  assert.match(nearestRes.answer, /chair/);

  // Room dimensions
  const roomRes = scene.querySpatial("What are the room dimensions?");
  assert.equal(roomRes.found, true);
  assert.ok(roomRes.dimensions.widthMeters > 0);
});

test("SpatialSceneGraph rejects objects without validated 3D geometry", () => {
  assert.throws(
    () => new SpatialSceneGraph({ objects: [{ id: "missing-geometry", label: "desk" }] }),
    /require validated finite 3D positions and positive dimensions/
  );
});
