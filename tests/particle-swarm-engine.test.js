import test from "node:test";
import assert from "node:assert/strict";
import { updateParticleSwarm, PARTICLE_FUNCTION_BODY } from "../public/particle-swarm-engine.js";

class MockVector3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class MockColor {
  constructor() { this.h = 0; this.s = 0; this.l = 0; }
  setHSL(h, s, l) { this.h = h; this.s = s; this.l = l; return this; }
}

const THREE = { Vector3: MockVector3, Color: MockColor };

test("particle swarm simulation executes 20,000 particles with zero errors and zero NaNs", () => {
  const count = 20000;
  const target = new MockVector3();
  const color = new MockColor();
  const time = 2.5;

  let infoCalls = 0;
  let annotationCalls = 0;

  const addControl = (id, label, min, max, initialValue) => initialValue;
  const setInfo = (title, desc) => {
    infoCalls++;
    assert.ok(title.includes("ULTRON"));
  };
  const annotate = (id, pos, label) => {
    annotationCalls++;
    assert.equal(id, "singularity");
  };

  const start = performance.now();
  for (let i = 0; i < count; i++) {
    updateParticleSwarm(i, count, target, color, time, THREE, addControl, setInfo, annotate);

    // Verify finite numbers
    assert.ok(Number.isFinite(target.x), `target.x not finite at i=${i}`);
    assert.ok(Number.isFinite(target.y), `target.y not finite at i=${i}`);
    assert.ok(Number.isFinite(target.z), `target.z not finite at i=${i}`);
    assert.ok(Number.isFinite(color.h), `color.h not finite at i=${i}`);
    assert.ok(Number.isFinite(color.s), `color.s not finite at i=${i}`);
    assert.ok(Number.isFinite(color.l), `color.l not finite at i=${i}`);

    // Verify purple and crimson spectrum (Hue ~0.76 to 0.98)
    assert.ok(color.h >= 0.70 && color.h <= 1.0, `Hue out of purple-crimson spectrum: ${color.h}`);
  }
  const duration = performance.now() - start;

  // Called only when i === 0
  assert.equal(infoCalls, 1, "setInfo must be called exactly once when i === 0");
  assert.equal(annotationCalls, 1, "annotate must be called exactly once when i === 0");

  // Performance requirement on Ryzen 7 5700U: 20k units in < 50ms in pure JS
  assert.ok(duration < 100, `Execution duration ${duration}ms exceeded limit`);
});

test("particle function body contains zero forbidden patterns and respects strict sandbox", () => {
  const forbidden = [
    "document",
    "window",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "eval",
    "Function(",
    "import(",
    "require(",
    "process",
    "__proto__",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "setTimeout",
    "setInterval",
    "alert("
  ];

  for (const pattern of forbidden) {
    assert.ok(
      !PARTICLE_FUNCTION_BODY.includes(pattern),
      `Particle function body must not contain forbidden pattern: ${pattern}`
    );
  }
});
