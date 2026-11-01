import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { VideoEditingEngine, EDITING_PRESETS } from "../media/video-editing-engine.js";

const execFileAsync = promisify(execFile);
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("VideoEditingEngine: Editing presets configure aspect ratios, color filters and FPS", () => {
  assert.ok(EDITING_PRESETS.CINEMATIC);
  assert.equal(EDITING_PRESETS.CINEMATIC.aspectRatio, "16:9");
  assert.equal(EDITING_PRESETS.CINEMATIC.fps, 24);
  assert.ok(EDITING_PRESETS.CINEMATIC.colorFilter.includes("contrast"));

  assert.ok(EDITING_PRESETS.REELS_SHORTS);
  assert.equal(EDITING_PRESETS.REELS_SHORTS.aspectRatio, "9:16");
  assert.equal(EDITING_PRESETS.REELS_SHORTS.width, 1080);
  assert.equal(EDITING_PRESETS.REELS_SHORTS.height, 1920);

  assert.ok(EDITING_PRESETS.ACTION);
  assert.equal(EDITING_PRESETS.ACTION.fps, 60);
  assert.equal(EDITING_PRESETS.ACTION.bpm, 140);
});

test("VideoEditingEngine: Generates rhythmic beat grid from BPM for cut synchronization", () => {
  const engine = new VideoEditingEngine();
  const grid = engine.generateBeatGrid(120, 10); // 120 BPM = 0.5s per beat, 10s duration

  assert.equal(grid.bpm, 120);
  assert.equal(grid.beatInterval, 0.5);
  assert.ok(grid.beats.length >= 20);
  assert.equal(grid.beats[0], 0);
  assert.equal(grid.beats[1], 0.5);
  assert.equal(grid.beats[2], 1.0);
});

test("VideoEditingEngine: Generates compliant SRT and WebVTT subtitles with precise timestamps", () => {
  const engine = new VideoEditingEngine();
  const transcript = [
    { startSeconds: 1.0, endSeconds: 4.5, text: "ULTRON system online." },
    { startSeconds: 5.0, endSeconds: 8.25, text: "Commencing autonomous video production." }
  ];

  const subtitles = engine.generateSubtitles(transcript);

  // Check SRT structure
  assert.ok(subtitles.srt.includes("1\n00:00:01,000 --> 00:00:04,500\nULTRON system online."));
  assert.ok(subtitles.srt.includes("2\n00:00:05,000 --> 00:00:08,250\nCommencing autonomous video production."));

  // Check WebVTT structure
  assert.ok(subtitles.vtt.startsWith("WEBVTT"));
  assert.ok(subtitles.vtt.includes("00:00:01.000 --> 00:00:04.500"));
});

test("VideoEditingEngine: Builds structured Edit Decision List (EDL) timeline", () => {
  const engine = new VideoEditingEngine();
  const timeline = engine.buildTimeline({
    presetKey: "ACTION",
    title: "Action Montage Test",
    sourceClips: [
      { name: "intro.mp4", path: "fixtures/intro.mp4", duration: 10 },
      { name: "action.mp4", path: "fixtures/action.mp4", duration: 15 },
      { name: "climax.mp4", path: "fixtures/climax.mp4", duration: 12 },
      { name: "outro.mp4", path: "fixtures/outro.mp4", duration: 8 }
    ],
    targetDuration: 15,
    voiceoverText: "Full power engaged."
  });

  assert.equal(timeline.title, "Action Montage Test");
  assert.equal(timeline.presetId, "action");
  assert.equal(timeline.targetDuration, 15);
  assert.equal(timeline.dimensions.fps, 60);
  assert.ok(timeline.videoClips.length >= 4);
  assert.equal(timeline.audioTracks.voiceover.text, "Full power engaged.");
  assert.ok(timeline.audioTracks.soundEffects.length >= 2);
});

test("VideoEditingEngine: Compiles single-pass FFmpeg command bounded for AMD Ryzen 7 5700U", () => {
  const engine = new VideoEditingEngine();
  const timeline = engine.buildTimeline({ presetKey: "CINEMATIC", sourceClips: [{ name: "source.mp4", path: "C:\\UltronWorkspace\\source.mp4", duration: 30 }], targetDuration: 30 });
  const compiled = engine.compileFFmpegCommand(timeline, "C:\\UltronWorkspace\\exports\\output.mp4");

  assert.equal(compiled.threads, 4, "Must limit FFmpeg threads to 4 to preserve CPU responsiveness");
  assert.ok(compiled.command.includes("-threads 4"));
  assert.ok(compiled.command.includes("-preset fast"));
  assert.ok(compiled.command.includes("-crf 22"));
  assert.ok(compiled.command.includes("-c:v libx264"));
});

test("VideoEditingEngine: renders real source media to a valid MP4 when FFmpeg is available", { skip: !HAS_FFMPEG }, async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-video-render-"));
  const sourcePath = path.join(tmpDir, "source.mp4");
  const engine = new VideoEditingEngine({ workspaceBase: tmpDir });
  await engine.initialize();
  await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24",
    "-t", "2", "-pix_fmt", "yuv420p", sourcePath], { timeout: 30000 });

  const timeline = engine.buildTimeline({
    presetKey: "CINEMATIC", title: "Mini Test Render",
    sourceClips: [{ name: "source.mp4", path: sourcePath, duration: 2 }], targetDuration: 2
  });
  const progressTrack = [];
  const result = await engine.renderVideo(timeline, { onProgress: p => progressTrack.push(p.progress) });
  assert.equal(result.success, true);
  assert.equal(result.renderedWithFFmpeg, true);
  assert.equal(result.audioIncluded, false);
  assert.ok(progressTrack.includes(100));
  const output = await fs.readFile(result.outputPath);
  assert.ok(output.length > 1024);
  assert.equal(output.toString("ascii", 4, 8), "ftyp");
  assert.ok((await fs.stat(result.manifestPath)).isFile());
  assert.equal(engine.getRenderStatus(result.renderId).status, "COMPLETED");
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("VideoEditingEngine: fails closed when FFmpeg is unavailable and never creates a fake MP4", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-no-ffmpeg-"));
  const sourcePath = path.join(tmpDir, "source.mp4");
  await fs.writeFile(sourcePath, "test fixture");
  const engine = new VideoEditingEngine({
    workspaceBase: tmpDir,
    ffmpegChecker: async () => { throw new Error("ffmpeg: command not found"); }
  });
  await engine.initialize();
  const timeline = engine.buildTimeline({
    presetKey: "CINEMATIC", title: "No FFmpeg Test",
    sourceClips: [{ name: "source.mp4", path: sourcePath, duration: 2 }], targetDuration: 2
  });
  const result = await engine.renderVideo(timeline);
  assert.equal(result.success, false);
  assert.equal(result.status, "BLOCKED_FFMPEG_UNAVAILABLE");
  assert.equal(result.renderedWithFFmpeg, false);
  assert.equal(result.outputPath, null);
  assert.ok((await fs.stat(result.manifestPath)).isFile());
  assert.equal(engine.getRenderStatus(result.renderId).status, "BLOCKED_FFMPEG_UNAVAILABLE");
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("VideoEditingEngine: refuses to invent source footage when no source clips were supplied", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-no-source-"));
  const engine = new VideoEditingEngine({ workspaceBase: tmpDir });
  await engine.initialize();
  const timeline = engine.buildTimeline({ presetKey: "CINEMATIC", title: "No Source", targetDuration: 2 });
  assert.equal(timeline.videoClips.length, 0);
  const result = await engine.renderVideo(timeline);
  assert.equal(result.success, false);
  assert.equal(result.status, "BLOCKED_SOURCE_MEDIA_UNAVAILABLE");
  assert.equal(result.outputPath, null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});
