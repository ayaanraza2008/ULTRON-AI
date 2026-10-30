import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scannerSource = fileURLToPath(new URL("../scripts/check-source.mjs", import.meta.url));

test("repository syntax scanner checks nested source and ignores dependency directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ultron-source-check-"));
  try {
    await cp(scannerSource, path.join(root, "check-source.mjs"));
    await mkdir(path.join(root, "nested"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await writeFile(path.join(root, "nested", "valid.js"), "export const valid = true;\n");
    await writeFile(path.join(root, "node_modules", "ignored.js"), "this is intentionally invalid !!!\n");

    const result = spawnSync(process.execPath, ["check-source.mjs"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Syntax-checked 2 JavaScript source files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository syntax scanner reports the path of malformed source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ultron-source-check-"));
  try {
    await cp(scannerSource, path.join(root, "check-source.mjs"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "broken.mjs"), "export const broken = ;\n");

    const result = spawnSync(process.execPath, ["check-source.mjs"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src[\\/]broken\.mjs/);
    assert.match(result.stderr, /SyntaxError/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
