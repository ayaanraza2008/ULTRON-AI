import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

function serviceBlock(name) {
  const lines = blueprint.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === "- type: web");
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === "- type: web") starts.push(i);
  }
  const serviceStart = starts.findIndex(index => lines.slice(index, starts[starts.indexOf(index) + 1] ?? lines.length)
    .some(line => line.trim() === `name: ${name}`));
  assert.ok(serviceStart >= 0, `Render Blueprint must define service ${name}`);
  const from = starts[serviceStart];
  const to = starts[serviceStart + 1] ?? lines.length;
  return lines.slice(from, to).join("\n");
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
