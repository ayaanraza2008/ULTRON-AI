import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activeInterfaceOrigin = "https://ultron-core-interface.onrender.com";
const retiredOrigin = "https://ultron-ai-zvd7.onrender.com";

const sourceFiles = [
  "../server.js",
  "../worker.js",
  "../features.js",
  "../agent-runtime.js",
  "../scripts/model-vision-smoke.mjs"
];

test("OpenRouter request metadata uses the active ULTRON Core interface origin", async () => {
  for (const file of sourceFiles) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes(activeInterfaceOrigin), file + " should use the current interface origin");
    assert.ok(!source.includes(retiredOrigin), file + " must not identify the retired Render service");
  }
});

test("Render blueprint maps only live Ultron core services and preserves the external World Intelligence endpoint", async () => {
  const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  const serviceNames = [...blueprint.matchAll(/^    name:\s*([^\n#]+)/gm)].map(match => match[1].trim());
  assert.deepEqual(serviceNames.slice(0, 4), [
    "ultron-ai-core",
    "ultron-core-interface",
    "ultron-browser-use-core",
    "ultron-rea-gateway"
  ]);
  assert.ok(blueprint.includes("WORLD_INTELLIGENCE_URL"));
  assert.ok(blueprint.includes("https://ultron-world-intelligence.onrender.com"));
  assert.ok(!/^    name:\s*ultron-world-intelligence(?:-globe|-live)?\s*$/m.test(blueprint),
    "Do not create a World Intelligence service that is not present in the Ultron core workspace.");
  assert.ok(blueprint.includes(activeInterfaceOrigin));
  assert.ok(!blueprint.includes(retiredOrigin));
});
