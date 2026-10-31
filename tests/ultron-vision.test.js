import test from "node:test";
import assert from "node:assert/strict";
import { UltronVision } from "../vision/ultron-vision.js";

const VALID_PNG_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("UltronVision: validates image data URLs and rejects invalid inputs", () => {
  const vision = new UltronVision();

  // Valid PNG inspection
  const meta = vision.inspectImageMetadata(VALID_PNG_BASE64);
  assert.equal(meta.mimeType, "image/png");
  assert.ok(meta.byteLength > 0);

  // Rejects plain string without data:image scheme
  assert.throws(() => {
    vision.inspectImageMetadata("https://example.com/photo.jpg");
  }, /Expected base64 data URL/);

  // Rejects non-image scheme
  assert.throws(() => {
    vision.inspectImageMetadata("data:application/pdf;base64,12345");
  }, /Expected base64 data URL/);

  // Rejects unsupported image MIME type
  assert.throws(() => {
    vision.inspectImageMetadata("data:image/bmp;base64,12345");
  }, /Unsupported image MIME type/);
});

test("UltronVision: visual reasoning and image understanding output", async () => {
  const vision = new UltronVision();
  const result = await vision.understandImage(VALID_PNG_BASE64, "Inspect the user interface layout.");

  assert.ok(result.id.startsWith("vis-"));
  assert.equal(result.mimeType, "image/png");
  assert.ok(result.description.includes("Visual reasoning"));
  assert.ok(result.confidence > 0.9);
});

test("UltronVision: object detection returns labeled bounding boxes", () => {
  const vision = new UltronVision();
  const detection = vision.detectObjects(VALID_PNG_BASE64);

  assert.equal(detection.objectCount, 2);
  const screenObj = detection.objects.find(o => o.label === "workstation_screen");
  assert.ok(screenObj);
  assert.ok(screenObj.box.xMax > screenObj.box.xMin);
  assert.ok(screenObj.box.yMax > screenObj.box.yMin);
});

test("UltronVision: video stream temporal keyframe analysis", () => {
  const vision = new UltronVision();
  const analysis = vision.analyzeVideo({ durationSec: 12.0, fps: 30 });

  assert.equal(analysis.durationSec, 12.0);
  assert.equal(analysis.totalFrames, 360);
  assert.ok(analysis.keyframeCount >= 4);
  assert.equal(analysis.keyframes[0].frameNumber, 0);
});

test("UltronVision: 3D asset processing parses OBJ vertices and calculates bounding volume", () => {
  const vision = new UltronVision();

  // Simple 3D cube OBJ representation
  const sampleObj = `
v 0.0 0.0 0.0
v 1.0 0.0 0.0
v 1.0 1.0 0.0
v 0.0 1.0 0.0
v 0.0 0.0 1.0
v 1.0 0.0 1.0
v 1.0 1.0 1.0
v 0.0 1.0 1.0
f 1 2 3 4
f 5 6 7 8
`;

  const processed = vision.process3DAsset(sampleObj, "obj");
  assert.equal(processed.format, "obj");
  assert.equal(processed.vertexCount, 8);
  assert.equal(processed.faceCount, 2);
  assert.equal(processed.dimensions.dx, 1.0);
  assert.equal(processed.dimensions.dy, 1.0);
  assert.equal(processed.dimensions.dz, 1.0);
  assert.equal(processed.boundingVolume, 1.0);
  assert.deepEqual(processed.centerOfMass, { x: 0.5, y: 0.5, z: 0.5 });
  assert.equal(processed.integrity, "manifold_valid");
});
