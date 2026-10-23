import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGeoSleuthRouter } from "../integrations/geo-sleuth.js";

async function withServer(env, runCommand, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (_req, _res, next) => next();
  app.use("/api", createGeoSleuthRouter({ env, requireSupabaseUser, runCommand }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XioAAAAASUVORK5CYII=";

test("Geo-Sleuth is disabled unless explicitly enabled", async () => {
  let called = false;
  await withServer({}, async () => { called = true; }, async base => {
    const response = await fetch(base + "/api/integrations/geo-sleuth/intake", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: png })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "GEO_SLEUTH_DISABLED");
    assert.equal(called, false);
  });
});

test("Geo-Sleuth rejects invalid image bytes before starting a process", async () => {
  let called = false;
  await withServer({ GEO_SLEUTH_ENABLED: "true" }, async () => { called = true; }, async base => {
    const response = await fetch(base + "/api/integrations/geo-sleuth/intake", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: Buffer.from("not an image").toString("base64") })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "GEO_SLEUTH_IMAGE_INVALID");
    assert.equal(called, false);
  });
});

test("Geo-Sleuth intake invokes the pinned local CLI and keeps reverse search opt-in", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-sleuth-test-"));
  let command;
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "intake.py"), "# mocked runtime script\n");
    await withServer({ GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root }, async (bin, args, options) => {
      command = { bin, args, options };
      const outIndex = args.indexOf("--out-dir");
      await mkdir(args[outIndex + 1], { recursive: true });
      await writeFile(path.join(args[outIndex + 1], "intake.md"), "# Intake\nEvidence prepared; location not yet verified.\n");
      return { stdout: "ok", stderr: "" };
    }, async base => {
      const response = await fetch(base + "/api/integrations/geo-sleuth/intake", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: "data:image/png;base64," + png })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.stage, "intake");
      assert.match(body.report, /location not yet verified/);
      assert.equal(body.reverseImageSearchEnabled, false);
      assert.equal(command.bin, "uv");
      assert.deepEqual(command.args.slice(0, 2), ["run", "scripts/intake.py"]);
      assert.ok(command.args.includes("--no-rev"));
      assert.equal(command.options.cwd, root);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Geo-Sleuth reports a missing runtime instead of claiming readiness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-sleuth-missing-"));
  try {
    await withServer({ GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root }, async () => {
      assert.fail("must not launch a process when the runtime is missing");
    }, async base => {
      const status = await fetch(base + "/api/integrations/geo-sleuth/status");
      const state = await status.json();
      assert.equal(state.enabled, true);
      assert.equal(state.sourceInstalled, false);
      assert.equal(state.ready, false);

      const response = await fetch(base + "/api/integrations/geo-sleuth/intake", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: png })
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "GEO_SLEUTH_RUNTIME_MISSING");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
