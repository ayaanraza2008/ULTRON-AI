import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const blueprint = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");

function serviceBlock(name) {
  const start = blueprint.indexOf("name: " + name);
  assert.notEqual(start, -1, "Missing Render service: " + name);
  const nextService = blueprint.indexOf("  - type: web", start + 1);
  return blueprint.slice(start, nextService < 0 ? undefined : nextService);
}

// Keep the UI service pinned to its deployed branch and its dedicated /healthz endpoint.
test("Render Blueprint preserves the existing separately deployed ULTRON interface branch", () => {
  const ui = serviceBlock("ultron-core-interface");
  assert.match(ui, /branch:\s*feature\/ultron-live-core-interface-20261029/);
  assert.doesNotMatch(ui, /branch:\s*main\b/);
  assert.match(ui, /healthCheckPath:\s*\/healthz/);
});

test("Render Blueprint keeps the backend on main while preserving the UI branch", () => {
  const backend = serviceBlock("ultron-ai-core");
  assert.match(backend, /branch:\s*main\b/);
});
