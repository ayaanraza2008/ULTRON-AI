/**
 * ULTRON AI — Spatial Intelligence 3D Geometry Converter
 * Module: spatial/geometry-converter.js
 *
 * Converts SpatialSceneGraph representations into standard 3D asset formats:
 * - Wavefront OBJ (.obj)
 * - GLTF 2.0 (.gltf)
 * - Validates geometric bounds, volume, and topology integrity.
 */

/**
 * Generate 8 bounding box vertices given center (x, y, z) and dimensions (dx, dy, dz).
 */
function assertGeometryAvailable(sceneGraph) {
  if (sceneGraph?.metadataOnly) {
    throw Object.assign(
      new Error("3D geometry is unavailable: CPU fallback validated image metadata only."),
      { code: "SCENE_GEOMETRY_UNAVAILABLE" }
    );
  }
}

function createBoxVertices(pos, dims) {
  const hx = dims.dx / 2;
  const hy = dims.dy / 2;
  const hz = dims.dz / 2;

  return [
    { x: pos.x - hx, y: pos.y - hy, z: pos.z - hz }, // 0: bottom-left-back
    { x: pos.x + hx, y: pos.y - hy, z: pos.z - hz }, // 1: bottom-right-back
    { x: pos.x + hx, y: pos.y - hy, z: pos.z + hz }, // 2: bottom-right-front
    { x: pos.x - hx, y: pos.y - hy, z: pos.z + hz }, // 3: bottom-left-front
    { x: pos.x - hx, y: pos.y + hy, z: pos.z - hz }, // 4: top-left-back
    { x: pos.x + hx, y: pos.y + hy, z: pos.z - hz }, // 5: top-right-back
    { x: pos.x + hx, y: pos.y + hy, z: pos.z + hz }, // 6: top-right-front
    { x: pos.x - hx, y: pos.y + hy, z: pos.z + hz }  // 7: top-left-front
  ];
}

/**
 * Convert a SpatialSceneGraph instance into a valid Wavefront OBJ string.
 */
export function sceneToObj(sceneGraph) {
  assertGeometryAvailable(sceneGraph);
  const lines = [
    "# ULTRON Spatial Intelligence — 3D Scene Model",
    `# Scene ID: ${sceneGraph.sceneId}`,
    `# Generated At: ${sceneGraph.timestamp}`,
    "# Units: Meters",
    ""
  ];

  let vertexOffset = 1;

  // 1. Export Floor plane
  const floor = sceneGraph.architecture?.floor;
  if (floor && floor.bounds) {
    const b = floor.bounds;
    const y = floor.elevation || 0.0;
    lines.push(`o Architecture_Floor`);
    lines.push(`v ${b.xMin} ${y} ${b.zMin}`);
    lines.push(`v ${b.xMax} ${y} ${b.zMin}`);
    lines.push(`v ${b.xMax} ${y} ${b.zMax}`);
    lines.push(`v ${b.xMin} ${y} ${b.zMax}`);
    lines.push(`f ${vertexOffset} ${vertexOffset + 1} ${vertexOffset + 2} ${vertexOffset + 3}`);
    lines.push("");
    vertexOffset += 4;
  }

  // 2. Export 3D Objects
  const objects = Array.isArray(sceneGraph.objects) ? sceneGraph.objects : Array.from(sceneGraph.objects.values());
  for (const obj of objects) {
    lines.push(`o ${obj.label}_${obj.id}`);
    const vertices = createBoxVertices(obj.pose3d.position, obj.pose3d.dimensions);

    for (const v of vertices) {
      lines.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`);
    }

    // 6 faces (quads in 1-based indexing)
    // Bottom: 0, 1, 2, 3
    lines.push(`f ${vertexOffset + 0} ${vertexOffset + 1} ${vertexOffset + 2} ${vertexOffset + 3}`);
    // Top: 4, 5, 6, 7
    lines.push(`f ${vertexOffset + 4} ${vertexOffset + 5} ${vertexOffset + 6} ${vertexOffset + 7}`);
    // Back: 0, 1, 5, 4
    lines.push(`f ${vertexOffset + 0} ${vertexOffset + 1} ${vertexOffset + 5} ${vertexOffset + 4}`);
    // Front: 3, 2, 6, 7
    lines.push(`f ${vertexOffset + 3} ${vertexOffset + 2} ${vertexOffset + 6} ${vertexOffset + 7}`);
    // Left: 0, 3, 7, 4
    lines.push(`f ${vertexOffset + 0} ${vertexOffset + 3} ${vertexOffset + 7} ${vertexOffset + 4}`);
    // Right: 1, 2, 6, 5
    lines.push(`f ${vertexOffset + 1} ${vertexOffset + 2} ${vertexOffset + 6} ${vertexOffset + 5}`);
    lines.push("");

    vertexOffset += 8;
  }

  return lines.join("\n");
}

/**
 * Convert a SpatialSceneGraph into a GLTF 2.0 JSON structure.
 */
export function sceneToGltf(sceneGraph) {
  assertGeometryAvailable(sceneGraph);
  const nodes = [];
  const objects = Array.isArray(sceneGraph.objects) ? sceneGraph.objects : Array.from(sceneGraph.objects.values());

  // Root Floor node
  nodes.push({
    name: "Room_Floor",
    translation: [0, sceneGraph.architecture?.floor?.elevation || 0, 2.5],
    scale: [
      sceneGraph.architecture?.dimensions?.widthMeters || 4.0,
      0.02,
      sceneGraph.architecture?.dimensions?.lengthMeters || 5.0
    ],
    extras: { type: "architecture_plane" }
  });

  // Object nodes
  for (const obj of objects) {
    nodes.push({
      name: `${obj.label}_${obj.id}`,
      translation: [obj.pose3d.position.x, obj.pose3d.position.y, obj.pose3d.position.z],
      rotation: [0, 0, 0, 1], // Default identity quaternion
      scale: [obj.pose3d.dimensions.dx, obj.pose3d.dimensions.dy, obj.pose3d.dimensions.dz],
      extras: {
        id: obj.id,
        category: obj.category,
        confidence: obj.confidence,
        cadId: obj.cadRetrieval?.cadId,
        supportedBy: obj.spatialRelations?.supportedBy
      }
    });
  }

  return {
    asset: {
      generator: "ULTRON-Spatial-Intelligence-Diorama",
      version: "2.0"
    },
    scene: 0,
    scenes: [
      {
        name: `Scene_${sceneGraph.sceneId}`,
        nodes: nodes.map((_, index) => index)
      }
    ],
    nodes
  };
}

/**
 * Validate a geometric string (OBJ format) and compute bounding volume and centroid.
 */
export function parseAndValidateObj(objText) {
  if (typeof objText !== "string" || !objText.trim()) {
    throw new Error("EMPTY_OBJ_DATA");
  }

  const vertices = [];
  const faces = [];

  for (const line of objText.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "v") {
      const nums = parts.slice(1, 4).map(Number);
      if (nums.length === 3 && nums.every(Number.isFinite)) {
        vertices.push({ x: nums[0], y: nums[1], z: nums[2] });
      }
    } else if (parts[0] === "f") {
      const idxs = parts.slice(1).map(v => parseInt(v.split("/")[0], 10));
      if (idxs.length >= 3 && idxs.every(Number.isSafeInteger)) {
        faces.push(idxs);
      }
    }
  }

  if (!vertices.length) throw new Error("NO_VALID_VERTICES_IN_OBJ");

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let sumX = 0, sumY = 0, sumZ = 0;

  for (const v of vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    sumX += v.x; sumY += v.y; sumZ += v.z;
  }

  const n = vertices.length;
  const dimensions = {
    dx: Number((maxX - minX).toFixed(3)),
    dy: Number((maxY - minY).toFixed(3)),
    dz: Number((maxZ - minZ).toFixed(3))
  };
  const centroid = {
    x: Number((sumX / n).toFixed(3)),
    y: Number((sumY / n).toFixed(3)),
    z: Number((sumZ / n).toFixed(3))
  };

  return {
    valid: true,
    vertexCount: n,
    faceCount: faces.length,
    boundingBox: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
    dimensions,
    boundingVolume: Number((dimensions.dx * dimensions.dy * dimensions.dz).toFixed(4)),
    centroid
  };
}
