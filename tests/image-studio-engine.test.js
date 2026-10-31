import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ImageStudioEngine, ASPECT_RATIOS, COLOR_LUT_PRESETS } from "../media/image-studio-engine.js";

test("ImageStudioEngine: Aspect ratios and color LUT presets are properly configured", () => {
  assert.equal(ASPECT_RATIOS.YOUTUBE_THUMBNAIL.width, 1280);
  assert.equal(ASPECT_RATIOS.YOUTUBE_THUMBNAIL.height, 720);
  assert.equal(ASPECT_RATIOS.INSTAGRAM_STORY.width, 1080);
  assert.equal(ASPECT_RATIOS.INSTAGRAM_STORY.height, 1920);

  assert.ok(COLOR_LUT_PRESETS.CYBERPUNK);
  assert.ok(COLOR_LUT_PRESETS.CYBERPUNK.primaryGlow);
  assert.ok(COLOR_LUT_PRESETS.CINEMATIC_TEAL_ORANGE);
  assert.ok(COLOR_LUT_PRESETS.DARK_MYSTERY);
  assert.ok(COLOR_LUT_PRESETS.NOIR_MONOCHROME);
});

test("ImageStudioEngine: Enriches image generation prompts with cinematic photography attributes", () => {
  const engine = new ImageStudioEngine();
  const rawPrompt = "futuristic autonomous AI android core in a laboratory";

  const enhanced = engine.enhancePrompt(rawPrompt, "cinematic");
  assert.ok(enhanced.includes("35mm anamorphic lens"));
  assert.ok(enhanced.includes("volumetric lighting"));
  assert.ok(enhanced.includes("8k resolution"));
  assert.ok(enhanced.startsWith(rawPrompt));

  const cyberpunk = engine.enhancePrompt("sports car at night", "cyberpunk");
  assert.ok(cyberpunk.includes("neon glow"));
});

test("ImageStudioEngine: Generates high-impact thumbnail SVG composition", () => {
  const engine = new ImageStudioEngine();
  const comp = engine.createThumbnailComposition({
    title: "ULTRON SINGULARITY",
    subtitle: "AUTONOMOUS SYSTEM CONTROL",
    preset: "CYBERPUNK",
    badgeText: "VERIFIED 100%"
  });

  assert.ok(comp.svg.startsWith("<svg"));
  assert.ok(comp.svg.includes("ULTRON SINGULARITY"));
  assert.ok(comp.svg.includes("AUTONOMOUS SYSTEM CONTROL"));
  assert.ok(comp.svg.includes("VERIFIED 100%"));
  assert.equal(comp.width, 1280);
  assert.equal(comp.height, 720);
});

test("ImageStudioEngine: Exports thumbnail composition to file and generates background removal mask", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-image-studio-"));
  const engine = new ImageStudioEngine({ workspaceBase: tmpDir });
  await engine.initialize();

  // 1. Export thumbnail to disk
  const exported = await engine.exportThumbnail({
    title: "MISSION COMPLETE",
    subtitle: "AI CREATION STUDIO"
  });

  assert.equal(exported.success, true);
  assert.ok(exported.outputPath);

  const fileExists = await fs.stat(exported.outputPath);
  assert.ok(fileExists.isFile());

  // 2. Background removal mask
  const mask = engine.generateBackgroundRemovalMask({ width: 1920, height: 1080 });
  assert.equal(mask.success, true);
  assert.equal(mask.transparencyChannel, "RGBA");
  assert.ok(mask.foregroundSubjectConfidence > 0.9);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
