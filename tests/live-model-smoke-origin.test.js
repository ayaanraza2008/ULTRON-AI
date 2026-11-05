import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("vision smoke metadata identifies the active ULTRON Core interface", async () => {
  const source = await readFile(new URL("../scripts/model-vision-smoke.mjs", import.meta.url), "utf8");
  assert.ok(source.includes('"HTTP-Referer": "https://ultron-core-interface.onrender.com"'));
  assert.ok(!source.includes("https://ultron-ai-zvd7.onrender.com"));
});
