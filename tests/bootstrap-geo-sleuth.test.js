import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureGeoSleuthRuntime } from "../scripts/bootstrap-geo-sleuth.mjs";

test("Geo-Sleuth bootstrap is a no-op when integration is disabled", async () => {
  let invoked = false;
  const result = await ensureGeoSleuthRuntime({ env: {}, runCommand: async () => { invoked = true; } });
  assert.deepEqual(result, { state: "disabled" });
  assert.equal(invoked, false);
});

test("Geo-Sleuth bootstrap reuses a complete pinned runtime without network calls", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-bootstrap-"));
  const root = path.join(base, "skills", "geo-sleuth");
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "scripts", "intake.py"), "# fixture");
  await writeFile(path.join(root, "scripts", "board.py"), "# fixture");
  let invoked = false;
  try {
    const result = await ensureGeoSleuthRuntime({
      env: { GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root },
      runCommand: async () => { invoked = true; }
    });
    assert.equal(result.state, "source_present");
    assert.equal(result.root, root);
    assert.equal(invoked, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
