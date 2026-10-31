import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activeInterfaceOrigin = "https://ultron-core-interface.onrender.com";
const retiredOrigin = "https://ultron-ai-zvd7.onrender.com";

const sourceFiles = [
  "../server.js",
  "../worker.js",
  "../features.js",
  "../agent-runtime.js"
];

test("OpenRouter request metadata uses the active ULTRON Core interface origin", async () => {
  for (const file of sourceFiles) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes(activeInterfaceOrigin), file + " should use the current interface origin");
    assert.ok(!source.includes(retiredOrigin), file + " must not identify the retired Render service");
  }
});

test("Render blueprint embeds World Intelligence under the active ULTRON Core interface origin", async () => {
  const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  assert.ok(blueprint.includes("      - key: GEV_EMBED_FRAME_ANCESTORS\\n        value: " + activeInterfaceOrigin));
  assert.ok(!blueprint.includes(retiredOrigin));
});
