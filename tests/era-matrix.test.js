import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const matrixPath = fileURLToPath(new URL("../docs/ERA_84_CAPABILITY_MATRIX.md", import.meta.url));
const allowedStatuses = new Set(["VERIFIED", "IMPLEMENTED", "PARTIAL", "BLOCKED", "NOT IMPLEMENTED", "NOT APPLICABLE"]);

test("ERA capability matrix contains exactly 84 unique, consecutively numbered features with explicit status", async () => {
  const markdown = await readFile(matrixPath, "utf8");
  const rows = [...markdown.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|/gm)]
    .map(match => ({ id: Number(match[1]), name: match[2].trim(), status: match[3].trim() }));

  assert.equal(rows.length, 84, "matrix should have one row for every requested capability");
  assert.deepEqual(rows.map(row => row.id), Array.from({ length: 84 }, (_, index) => index + 1));
  assert.ok(rows.every(row => row.name.length > 0), "every row should have a capability name");
  assert.ok(rows.every(row => allowedStatuses.has(row.status)), "every row should use the documented status vocabulary");
});
