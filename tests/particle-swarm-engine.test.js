import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createParticleEngine,
  generateParticleData,
  particleCountForViewport
} from "../public/particle-swarm-engine.js";

const rendererSource = await readFile(new URL("../public/particle-swarm-engine.js", import.meta.url), "utf8");

test("particle count scales down for mobile and tablet viewports", () => {
  assert.equal(particleCountForViewport(390), 12000);
  assert.equal(particleCountForViewport(700), 16000);
  assert.equal(particleCountForViewport(1280), 20000);
});

test("20,000 particle coordinates and seeds are finite and deterministic", () => {
  const first = generateParticleData(20000, 12345);
  const second = generateParticleData(20000, 12345);
  assert.equal(first.length, 80000);
  assert.deepEqual(first, second);
  for (const value of first) assert.ok(Number.isFinite(value));
});

test("renderer uses one GPU point draw and pauses for reduced motion and hidden tabs", () => {
  assert.match(rendererSource, /new Float32Array\(safeCount \* 4\)/);
  assert.match(rendererSource, /gl\.drawArrays\(gl\.POINTS, 0, count\)/);
  assert.match(rendererSource, /prefers-reduced-motion/);
  assert.match(rendererSource, /visibilitychange/);
  assert.match(rendererSource, /cancelAnimationFrame/);
  assert.match(rendererSource, /powerPreference:\s*"low-power"/);
});

test("unsupported WebGL uses a clean static CSS fallback", () => {
  const classes = new Set();
  const canvas = {
    getContext() { return null; },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    }
  };
  const renderer = createParticleEngine(canvas, { count: 20 });
  assert.equal(renderer.mode, "css-fallback");
  assert.ok(classes.has("energy-core--fallback"));
  renderer.destroy();
  assert.equal(classes.has("energy-core--fallback"), false);
});
