import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

function serviceBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = blueprint.match(new RegExp(`(?ms)^  - type: web\\n(?:(?!^  - type: web).)*?^    name: ${escaped}\\n(?:(?!^  - type: web).)*`));
  assert.ok(match, `Render Blueprint must define service ${name}`);
  return match[0];
}

test("God's Eye blueprint removes stale build cache before cloning pinned source", () => {
  const service = serviceBlock("ultron-world-intelligence");
  assert.match(service, /buildCommand: rm -rf \.build-gods-eye-view && git clone/);
  assert.match(service, /git checkout 7be5937fc3e3b10cdfa8d3f833536167268768ad/);
  assert.match(service, /npm ci --include=dev && npm run build/);
});

test("ULTRON backend blueprint targets the known-live God’s Eye service", () => {
  const service = serviceBlock("ultron-ai");
  assert.match(service, /WORLD_INTELLIGENCE_URL/);
  assert.match(service, /value: https:\/\/ultron-world-intelligence-live\.onrender\.com/);
});
