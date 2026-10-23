import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGeoSleuthInvestigation } from "../integrations/geo-sleuth-agent.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XioAAAAASUVORK5CYII=";

test("autonomous Geo-Sleuth runner is disabled unless explicitly enabled", async () => {
  let called = false;
  const result = await runGeoSleuthInvestigation({
    imageBase64: png,
    env: {},
    runCommand: async () => { called = true; }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "GEO_SLEUTH_DISABLED");
  assert.equal(called, false);
});

test("autonomous Geo-Sleuth runner rejects invalid image before starting subprocess", async () => {
  let called = false;
  const result = await runGeoSleuthInvestigation({
    imageBase64: Buffer.from("not an image").toString("base64"),
    env: { GEO_SLEUTH_ENABLED: "true" },
    runCommand: async () => { called = true; }
  });
  assert.equal(result.state, "needs_input");
  assert.equal(result.code, "GEO_SLEUTH_IMAGE_INVALID");
  assert.equal(called, false);
});

test("autonomous Geo-Sleuth runs intake and isolated candidate-board stages without reverse search by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-agent-test-"));
  const commands = [];
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    const result = await runGeoSleuthInvestigation({
      imageBase64: png,
      env: { GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root },
      runCommand: async (bin, args, options) => {
        commands.push({ bin, args, options });
        const intakeIndex = args.indexOf("scripts/intake.py");
        if (intakeIndex >= 0) {
          const outIndex = args.indexOf("--out-dir");
          await mkdir(args[outIndex + 1], { recursive: true });
          await writeFile(path.join(args[outIndex + 1], "intake.md"), "# Intake\\nEvidence prepared; location not yet verified.\\n");
        }
        const mergeIndex = args.indexOf("--merge");
        if (mergeIndex >= 0) await writeFile(args[mergeIndex + 1], JSON.stringify({ candidate_levels: {}, main: null }));
        return { stdout: "ok", stderr: "" };
      }
    });
    assert.equal(result.state, "completed_initial_investigation");
    assert.equal(result.execution, "autonomous_bounded_investigation");
    assert.match(result.intake, /location not yet verified/);
    assert.equal(result.reverseImageSearchEnabled, false);
    assert.equal(commands.length, 5);
    assert.ok(commands[0].args.includes("--no-rev"));
    assert.ok(commands.some(c => c.args.includes("candidate_board_init") === false && c.args.includes("scripts/board.py")));
    assert.ok(commands.every(c => c.bin === "uv"));
    assert.ok(commands.every(c => c.options.cwd === root));
    assert.ok(result.stages.every(s => s.state === "completed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
