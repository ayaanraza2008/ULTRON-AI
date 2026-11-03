/**
 * ULTRON AI — Spatial Intelligence 3D Scene Graph
 * Module: spatial/scene-graph.js
 *
 * Implements the holistic 3D indoor scene representation matching
 * Diorama's zero-shot pipeline (Perception, Room Geometry, CAD Retrieval,
 * 9-DoF Object Poses, and Semantic Layout Relations).
 */

export const PROVENANCE_TYPES = Object.freeze({
  DIRECT_OBSERVATION: "DIRECT_OBSERVATION",
  MODEL_PREDICTION: "MODEL_PREDICTION",
  ESTIMATED_MEASUREMENT: "ESTIMATED_MEASUREMENT",
  UNAVAILABLE: "UNAVAILABLE"
});

export const OBJECT_CATEGORIES = Object.freeze({
  FURNITURE: "furniture",
  ELECTRONICS: "electronics",
  ARCHITECTURE: "architecture",
  DECOR: "decor",
  HOUSEHOLD: "household",
  OPEN_WORLD: "open_world"
});

export class SpatialSceneGraph {
  constructor(options = {}) {
    this.sceneId = options.sceneId || ("scene-" + Date.now());
    this.timestamp = options.timestamp || new Date().toISOString();
    this.pipeline = options.pipeline || "unverified-scene-graph";
    this.executionMode = options.executionMode || "UNKNOWN";
    this.metadataOnly = options.metadataOnly === true || options.inferenceStatus === "CPU_METADATA_ONLY";
    this.cudaAccelerated = Boolean(options.cudaAccelerated);
    this.remoteWorkerUsed = Boolean(options.remoteWorkerUsed);
    this.remoteGpuReported = Boolean(options.remoteGpuReported);
    this.remoteInferenceStatusReported = typeof options.remoteInferenceStatusReported === "string"
      ? options.remoteInferenceStatusReported.slice(0, 120)
      : null;
    this.inferenceStatus = options.inferenceStatus || "UNVERIFIED_SCENE_GRAPH";

    // Metadata-only results must never inherit fabricated room dimensions.
    this.architecture = this.metadataOnly ? {
      roomType: "unknown",
      dimensions: { widthMeters: null, lengthMeters: null, heightMeters: null },
      floor: null,
      ceiling: null,
      walls: []
    } : {
      roomType: options.architecture?.roomType || "indoor_room",
      dimensions: {
        widthMeters: Number(options.architecture?.dimensions?.widthMeters) || 4.2,
        lengthMeters: Number(options.architecture?.dimensions?.lengthMeters) || 5.0,
        heightMeters: Number(options.architecture?.dimensions?.heightMeters) || 2.8
      },
      floor: {
        normal: [0, 1, 0],
        elevation: 0.0,
        bounds: options.architecture?.floor?.bounds || { xMin: -2.1, xMax: 2.1, zMin: 0.0, zMax: 5.0 }
      },
      ceiling: {
        normal: [0, -1, 0],
        elevation: Number(options.architecture?.ceiling?.elevation) || 2.8
      },
      walls: Array.isArray(options.architecture?.walls) ? options.architecture.walls : [
        { id: "wall-back", normal: [0, 0, -1], distanceMeters: 5.0 },
        { id: "wall-left", normal: [1, 0, 0], distanceMeters: 2.1 },
        { id: "wall-right", normal: [-1, 0, 0], distanceMeters: 2.1 }
      ]
    };

    // 3D Objects indexed by id
    this.objects = new Map();

    if (Array.isArray(options.objects)) {
      for (const obj of options.objects) {
        this.addObject(obj);
      }
    }

    this.computeSpatialRelations();
  }

  addObject(data) {
    if (!data || typeof data !== "object") return null;
    const id = String(data.id || ("obj-" + (this.objects.size + 1)));
    const label = String(data.label || "unknown_object").toLowerCase().trim();
    const category = String(data.category || this._inferCategory(label));

    const box2d = {
      xMin: Math.max(0, Math.min(1, Number(data.box2d?.xMin) || 0)),
      yMin: Math.max(0, Math.min(1, Number(data.box2d?.yMin) || 0)),
      xMax: Math.max(0, Math.min(1, Number(data.box2d?.xMax) || 1)),
      yMax: Math.max(0, Math.min(1, Number(data.box2d?.yMax) || 1))
    };

    const pose3d = {
      position: {
        x: Number.isFinite(data.pose3d?.position?.x) ? Number(data.pose3d.position.x) : 0.0,
        y: Number.isFinite(data.pose3d?.position?.y) ? Number(data.pose3d.position.y) : 0.5,
        z: Number.isFinite(data.pose3d?.position?.z) ? Number(data.pose3d.position.z) : 2.5
      },
      rotation: {
        roll: Number(data.pose3d?.rotation?.roll) || 0,
        pitch: Number(data.pose3d?.rotation?.pitch) || 0,
        yaw: Number(data.pose3d?.rotation?.yaw) || 0
      },
      dimensions: {
        dx: Math.max(0.05, Number(data.pose3d?.dimensions?.dx) || 0.6), // width
        dy: Math.max(0.05, Number(data.pose3d?.dimensions?.dy) || 0.6), // height
        dz: Math.max(0.05, Number(data.pose3d?.dimensions?.dz) || 0.6)  // depth
      }
    };

    const cadRetrieval = {
      cadId: data.cadRetrieval?.cadId || `cad-${label}-01`,
      source: data.cadRetrieval?.source || "Objaverse-LVIS-Diorama",
      retrievalScore: Number.isFinite(data.cadRetrieval?.retrievalScore) ? data.cadRetrieval.retrievalScore : 0.85,
      meshFormat: data.cadRetrieval?.meshFormat || "primitive"
    };

    const record = {
      id,
      label,
      category,
      box2d,
      pose3d,
      cadRetrieval,
      confidence: Number.isFinite(data.confidence) ? data.confidence : 0.9,
      provenance: data.provenance || PROVENANCE_TYPES.ESTIMATED_MEASUREMENT,
      spatialRelations: {
        supportedBy: data.spatialRelations?.supportedBy || "floor",
        supports: Array.isArray(data.spatialRelations?.supports) ? data.spatialRelations.supports : [],
        nearestObjects: []
      }
    };

    this.objects.set(id, record);
    return record;
  }

  getObject(id) {
    return this.objects.get(id) || null;
  }

  getObjectsByCategory(category) {
    return Array.from(this.objects.values()).filter(o => o.category === category);
  }

  getObjectsByLabel(label) {
    const target = String(label || "").toLowerCase().trim();
    return Array.from(this.objects.values()).filter(o => o.label.includes(target));
  }

  /**
   * Calculates pairwise euclidean 3D distance between all objects and derives
   * nearest neighbors and support hierarchies.
   */
  computeSpatialRelations() {
    const list = Array.from(this.objects.values());

    for (const objA of list) {
      const distances = [];
      const posA = objA.pose3d.position;

      for (const objB of list) {
        if (objA.id === objB.id) continue;
        const posB = objB.pose3d.position;
        const dist = Math.sqrt(
          Math.pow(posA.x - posB.x, 2) +
          Math.pow(posA.y - posB.y, 2) +
          Math.pow(posA.z - posB.z, 2)
        );
        distances.push({ id: objB.id, label: objB.label, distanceMeters: Number(dist.toFixed(2)) });

        // Physical support heuristic: if objB is above objA and within horizontal bounds
        const isHorizontallyOverlapping = Math.abs(posA.x - posB.x) < (objA.pose3d.dimensions.dx / 2) &&
                                          Math.abs(posA.z - posB.z) < (objA.pose3d.dimensions.dz / 2);
        const isRestingAbove = (posB.y > posA.y) && Math.abs(posB.y - (posA.y + objA.pose3d.dimensions.dy / 2)) < 0.25;

        if (isHorizontallyOverlapping && isRestingAbove) {
          objB.spatialRelations.supportedBy = objA.id;
          if (!objA.spatialRelations.supports.includes(objB.id)) {
            objA.spatialRelations.supports.push(objB.id);
          }
        }
      }

      distances.sort((a, b) => a.distanceMeters - b.distanceMeters);
      objA.spatialRelations.nearestObjects = distances.slice(0, 3);
    }
  }

  /**
   * Find nearest objects to a specific target object.
   */
  findNearest(targetId, limit = 3) {
    const obj = this.getObject(targetId);
    if (!obj) return [];
    return obj.spatialRelations.nearestObjects.slice(0, limit);
  }

  /**
   * Answers natural-language spatial queries against the verified scene graph.
   */
  querySpatial(prompt) {
    const text = String(prompt || "").toLowerCase().trim();
    if (!text) {
      return { found: false, answer: "Provide a spatial question to query the 3D scene." };
    }

    if (this.metadataOnly) {
      return {
        found: false,
        queryType: "UNAVAILABLE",
        answer: "No 3D geometry was reconstructed. The CPU fallback only validated the image payload; configure a verified Diorama model worker for spatial queries."
      };
    }

    const allObjects = Array.from(this.objects.values());

    // "How many [label]s"
    if (text.includes("how many")) {
      for (const obj of allObjects) {
        if (text.includes(obj.label) || text.includes(obj.label + "s")) {
          const matching = this.getObjectsByLabel(obj.label);
          return {
            found: true,
            queryType: "COUNT",
            category: obj.label,
            count: matching.length,
            objects: matching.map(o => ({ id: o.id, label: o.label, position: o.pose3d.position })),
            answer: `There ${matching.length === 1 ? "is" : "are"} ${matching.length} ${obj.label}${matching.length > 1 ? "s" : ""} visible in the 3D scene.`
          };
        }
      }
    }

    // "Where is the [label]" / "position of [label]"
    if (text.includes("where is") || text.includes("position of") || text.includes("location of")) {
      for (const obj of allObjects) {
        if (text.includes(obj.label)) {
          const pos = obj.pose3d.position;
          const dims = obj.pose3d.dimensions;
          const nearest = obj.spatialRelations.nearestObjects[0];
          const nearestText = nearest ? ` Nearest object is ${nearest.label} (${nearest.distanceMeters}m away).` : "";
          const supportText = obj.spatialRelations.supportedBy !== "floor" ? ` Supported by ${obj.spatialRelations.supportedBy}.` : " Resting on the floor.";

          return {
            found: true,
            queryType: "POSITION",
            object: {
              id: obj.id,
              label: obj.label,
              position: pos,
              dimensions: dims,
              supportedBy: obj.spatialRelations.supportedBy
            },
            answer: `The ${obj.label} is located at X: ${pos.x}m, Y: ${pos.y}m (height), Z: ${pos.z}m (depth). Dimensions: ${dims.dx}m wide × ${dims.dy}m high × ${dims.dz}m deep.${supportText}${nearestText}`
          };
        }
      }
    }

    // "Nearest object to [label]"
    if (text.includes("nearest") || text.includes("closest")) {
      for (const obj of allObjects) {
        if (text.includes(obj.label)) {
          const nearest = obj.spatialRelations.nearestObjects[0];
          if (!nearest) {
            return { found: true, answer: `The ${obj.label} is the only detected object in this cluster.` };
          }
          return {
            found: true,
            queryType: "NEAREST_NEIGHBOR",
            targetObject: obj.id,
            nearestObject: nearest,
            answer: `The nearest object to the ${obj.label} is the ${nearest.label} at a distance of ${nearest.distanceMeters} meters.`
          };
        }
      }
    }

    // "Room dimensions" / "room size"
    if (text.includes("room") || text.includes("environment") || text.includes("space")) {
      const dims = this.architecture.dimensions;
      return {
        found: true,
        queryType: "ROOM_DIMENSIONS",
        dimensions: dims,
        objectCount: allObjects.length,
        answer: `The reconstructed room measures approximately ${dims.widthMeters}m wide × ${dims.lengthMeters}m long × ${dims.heightMeters}m high (volume ~${(dims.widthMeters * dims.lengthMeters * dims.heightMeters).toFixed(1)} m³), containing ${allObjects.length} identified objects.`
      };
    }

    // General summary
    return {
      found: true,
      queryType: "GENERAL_SUMMARY",
      answer: this.toSummaryText()
    };
  }

  /**
   * Human-readable text summary for injection into LLM Brain context.
   */
  toSummaryText() {
    if (this.metadataOnly) {
      return "No 3D scene was reconstructed. CPU fallback validated the image payload only; no object positions or room dimensions are available.";
    }
    const dims = this.architecture.dimensions;
    const objs = Array.from(this.objects.values());
    if (!objs.length) {
      return `Reconstructed empty room of ${dims.widthMeters}m × ${dims.lengthMeters}m × ${dims.heightMeters}m. No foreground objects detected.`;
    }

    const items = objs.map(o => {
      const p = o.pose3d.position;
      const d = o.pose3d.dimensions;
      const supp = o.spatialRelations.supportedBy !== "floor" ? ` (on ${o.spatialRelations.supportedBy})` : "";
      return `• ${o.label} [id: ${o.id}] at [x:${p.x}m, y:${p.y}m, z:${p.z}m], size [${d.dx}×${d.dy}×${d.dz}m]${supp}`;
    }).join("\n");

    return `3D Spatial Scene Graph (${this.inferenceStatus}):\n` +
      `Room Dimensions: ${dims.widthMeters}m (W) × ${dims.lengthMeters}m (L) × ${dims.heightMeters}m (H)\n` +
      `Detected Objects (${objs.length}):\n${items}`;
  }

  toJSON() {
    return {
      sceneId: this.sceneId,
      timestamp: this.timestamp,
      pipeline: this.pipeline,
      executionMode: this.executionMode,
      metadataOnly: this.metadataOnly,
      cudaAccelerated: this.cudaAccelerated,
      remoteWorkerUsed: this.remoteWorkerUsed,
      remoteGpuReported: this.remoteGpuReported,
      remoteInferenceStatusReported: this.remoteInferenceStatusReported,
      inferenceStatus: this.inferenceStatus,
      architecture: this.architecture,
      objects: Array.from(this.objects.values())
    };
  }

  static fromJSON(data = {}) {
    return new SpatialSceneGraph(data);
  }

  _inferCategory(label) {
    if (["table", "chair", "desk", "sofa", "bed", "cabinet", "shelf", "couch", "stool", "wardrobe"].includes(label)) {
      return OBJECT_CATEGORIES.FURNITURE;
    }
    if (["monitor", "computer", "laptop", "screen", "tv", "keyboard", "mouse", "speaker", "phone"].includes(label)) {
      return OBJECT_CATEGORIES.ELECTRONICS;
    }
    if (["door", "window", "wall", "column", "floor", "ceiling"].includes(label)) {
      return OBJECT_CATEGORIES.ARCHITECTURE;
    }
    if (["lamp", "vase", "plant", "painting", "clock", "curtain"].includes(label)) {
      return OBJECT_CATEGORIES.DECOR;
    }
    return OBJECT_CATEGORIES.HOUSEHOLD;
  }
}
