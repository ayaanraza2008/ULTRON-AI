import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxVisualInspector } from '../vision/byox-visual-inspector.js';

test('ByoxVisualInspector: compute Sobel edges and detect edge density', () => {
  const inspector = new ByoxVisualInspector({ edgeThreshold: 30 });
  const width = 16;
  const height = 16;

  // Create an image with a sharp vertical white/black border
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const color = x < 8 ? 0 : 255;
      buffer[offset] = color;
      buffer[offset + 1] = color;
      buffer[offset + 2] = color;
      buffer[offset + 3] = 255;
    }
  }

  const inspection = inspector.inspectImage(buffer, width, height, 4);
  assert.ok(inspection.edgeDensity > 0.05, 'Expected clear vertical edge detection');
  assert.ok(inspection.avgGradient > 10);
});

test('ByoxVisualInspector: Laplacian blur estimation and sharp vs blurred detection', () => {
  const inspector = new ByoxVisualInspector({ blurThreshold: 50 });
  const width = 16;
  const height = 16;

  // Sharp alternating checkerboard
  const sharpBuffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const color = ((x + y) % 2 === 0) ? 255 : 0;
      sharpBuffer[offset] = color;
      sharpBuffer[offset + 1] = color;
      sharpBuffer[offset + 2] = color;
      sharpBuffer[offset + 3] = 255;
    }
  }

  // Smooth flat image
  const flatBuffer = Buffer.alloc(width * height * 4).fill(128);

  const sharpRes = inspector.inspectImage(sharpBuffer, width, height, 4);
  const flatRes = inspector.inspectImage(flatBuffer, width, height, 4);

  assert.equal(sharpRes.isBlurry, false);
  assert.equal(flatRes.isBlurry, true);
  assert.ok(sharpRes.blurScore > flatRes.blurScore);
});

test('ByoxVisualInspector: perceptual hash (pHash) and Hamming distance for deduplication', () => {
  const inspector = new ByoxVisualInspector();
  const width = 16;
  const height = 16;

  const bufA = Buffer.alloc(width * height * 4).fill(200);
  const bufB = Buffer.alloc(width * height * 4).fill(200);

  const hashA = inspector.inspectImage(bufA, width, height, 4).perceptualHash;
  const hashB = inspector.inspectImage(bufB, width, height, 4).perceptualHash;

  assert.equal(inspector.hammingDistance(hashA, hashB), 0); // Identical

  // Alter quadrant in bufC
  const bufC = Buffer.alloc(width * height * 4).fill(200);
  for (let i = 0; i < (width * height * 2); i++) bufC[i] = 10;
  const hashC = inspector.inspectImage(bufC, width, height, 4).perceptualHash;

  const dist = inspector.hammingDistance(hashA, hashC);
  assert.ok(dist > 0, 'Altered image should have non-zero Hamming distance');
});
