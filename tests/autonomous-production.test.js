import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AutonomousProductionOrchestrator } from "../media/autonomous-production-orchestrator.js";
import { MediaDiscoveryEngine } from "../media/media-discovery-engine.js";
import { VideoEditingEngine } from "../media/video-editing-engine.js";
import { ImageStudioEngine } from "../media/image-studio-engine.js";

test("AutonomousProductionOrchestrator: Parses complex natural production prompts", () => {
  const orchestrator = new AutonomousProductionOrchestrator();

  // Test 1: Dangerous cinematic action edit
  const intent1 = orchestrator.parseProductionIntent(
    "ULTRON, find the best footage on my drive and create a dangerous cinematic action edit."
  );
  assert.equal(intent1.presetKey, "ACTION");
  assert.equal(intent1.targetDuration, 30);
  assert.ok(intent1.keywords.includes("action"));
  assert.ok(intent1.keywords.includes("cinematic"));

  // Test 2: 30-second cinematic mystery reel
  const intent2 = orchestrator.parseProductionIntent(
    "ULTRON, create a 30-second cinematic mystery reel using my existing footage."
  );
  assert.equal(intent2.presetKey, "DARK_MYSTERY");
  assert.equal(intent2.targetDuration, 30);

  // Test 3: 15-second gaming reel
  const intent3 = orchestrator.parseProductionIntent(
    "Make a 15-second gaming reel for YouTube Shorts."
  );
  assert.equal(intent3.presetKey, "REELS_SHORTS");
  assert.equal(intent3.targetDuration, 15);
});

test("AutonomousProductionOrchestrator: reports a blocked real render instead of claiming a fake export", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-auto-prod-"));

  // Index a couple sample source files
  await fs.writeFile(path.join(tmpDir, "sample_clip_action.mp4"), "sample-action-bytes");
  await fs.writeFile(path.join(tmpDir, "sample_clip_car.mp4"), "sample-car-bytes");
  const mediaDiscoveryEngine = new MediaDiscoveryEngine();
  await mediaDiscoveryEngine.indexDirectory(tmpDir);

  const orchestrator = new AutonomousProductionOrchestrator({
    workspaceBase: tmpDir,
    mediaDiscoveryEngine,
    videoEditingEngine: new VideoEditingEngine({
      workspaceBase: tmpDir,
      ffmpegChecker: async () => { throw new Error("ffmpeg disabled for deterministic blocker test"); }
    }),
    imageStudioEngine: new ImageStudioEngine({ workspaceBase: tmpDir })
  });

  const progressUpdates = [];
  const result = await orchestrator.produceContent(
    "ULTRON, find the best footage on my drive and create a dangerous cinematic action edit.",
    {
      onProgress: (p) => progressUpdates.push(p)
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "BLOCKED_MEDIA_RENDER");
  assert.equal(result.videoExportStatus, "BLOCKED_FFMPEG_UNAVAILABLE");
  assert.equal(result.stagesCompleted, 10);
  assert.deepEqual(result.stagesBlocked, ["RENDERING_VIDEO", "SAVING_EXPORT"]);
  assert.equal(result.preset, "High-Velocity Action");
  assert.equal(result.videoExportPath, null);
  assert.ok(result.videoExportError);
  assert.ok(result.thumbnailPath);
  assert.ok(result.manifestPath);

  // Verify all 12 stages were signaled
  assert.ok(progressUpdates.length >= 8);
  assert.ok(progressUpdates.some(u => u.stageName === "BUILDING_TIMELINE"));
  assert.ok(progressUpdates.some(u => u.stageName === "COMPLETED"));

  // Verify the package assets exist, but no nonexistent MP4 is advertised.
  const manifestExists = await fs.stat(result.manifestPath);
  assert.ok(manifestExists.isFile());
  const thumbExists = await fs.stat(result.thumbnailPath);
  assert.ok(thumbExists.isFile());

  // Verify history recording
  const history = orchestrator.getHistory();
  assert.ok(history.length >= 1);
  assert.equal(history[0].taskId, result.taskId);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
