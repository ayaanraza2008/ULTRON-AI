import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MediaDiscoveryEngine, MEDIA_TYPES } from "../media/media-discovery-engine.js";

test("MediaDiscoveryEngine: Recognizes media formats accurately across all required types", () => {
  const engine = new MediaDiscoveryEngine();

  // Images
  assert.equal(engine.getMediaType("sample.jpg"), MEDIA_TYPES.IMAGE);
  assert.equal(engine.getMediaType("graphic.png"), MEDIA_TYPES.IMAGE);
  assert.equal(engine.getMediaType("banner.webp"), MEDIA_TYPES.IMAGE);
  assert.equal(engine.getMediaType("anim.gif"), MEDIA_TYPES.IMAGE);
  assert.equal(engine.getMediaType("vector.svg"), MEDIA_TYPES.IMAGE);
  assert.equal(engine.getMediaType("photo.tiff"), MEDIA_TYPES.IMAGE);

  // Videos
  assert.equal(engine.getMediaType("clip.mp4"), MEDIA_TYPES.VIDEO);
  assert.equal(engine.getMediaType("movie.mkv"), MEDIA_TYPES.VIDEO);
  assert.equal(engine.getMediaType("recording.mov"), MEDIA_TYPES.VIDEO);
  assert.equal(engine.getMediaType("raw.avi"), MEDIA_TYPES.VIDEO);
  assert.equal(engine.getMediaType("stream.webm"), MEDIA_TYPES.VIDEO);

  // Audio
  assert.equal(engine.getMediaType("song.mp3"), MEDIA_TYPES.AUDIO);
  assert.equal(engine.getMediaType("track.wav"), MEDIA_TYPES.AUDIO);
  assert.equal(engine.getMediaType("podcast.m4a"), MEDIA_TYPES.AUDIO);
  assert.equal(engine.getMediaType("lossless.flac"), MEDIA_TYPES.AUDIO);

  // Documents
  assert.equal(engine.getMediaType("document.pdf"), MEDIA_TYPES.DOCUMENT);
  assert.equal(engine.getMediaType("report.docx"), MEDIA_TYPES.DOCUMENT);
  assert.equal(engine.getMediaType("notes.txt"), MEDIA_TYPES.DOCUMENT);
  assert.equal(engine.getMediaType("slides.pptx"), MEDIA_TYPES.DOCUMENT);
  assert.equal(engine.getMediaType("sheet.xlsx"), MEDIA_TYPES.DOCUMENT);
});

test("MediaDiscoveryEngine: Indexes target directory, computes hashes, and detects duplicates", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-media-index-"));
  const vid1 = path.join(tmpDir, "car_chase_action.mp4");
  const vid2 = path.join(tmpDir, "sunset_golden_hour.mp4");
  const vidDuplicate = path.join(tmpDir, "car_chase_copy.mp4");
  const img1 = path.join(tmpDir, "sunset_beach.jpg");

  const sampleVideoData = Buffer.from("VIDEO_DATA_STREAM_HEADER_FOR_HASHING_SAMPLE_123");
  await fs.writeFile(vid1, sampleVideoData);
  await fs.writeFile(vidDuplicate, sampleVideoData); // Identical hash
  await fs.writeFile(vid2, Buffer.from("DIFFERENT_VIDEO_STREAM_DATA_SUNSET"));
  await fs.writeFile(img1, Buffer.from("IMAGE_BINARY_DATA"));

  const engine = new MediaDiscoveryEngine();
  const summary = await engine.indexDirectory(tmpDir);

  assert.equal(summary.totalIndexed, 4);
  assert.equal(summary.librarySize, 4);

  // Check duplicate detection
  const duplicates = engine.findDuplicates();
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].count, 2);
  assert.ok(duplicates[0].files.some(f => f.name === "car_chase_action.mp4"));
  assert.ok(duplicates[0].files.some(f => f.name === "car_chase_copy.mp4"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("MediaDiscoveryEngine: Natural language search returns relevance-scored media", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-media-search-"));
  await fs.writeFile(path.join(tmpDir, "action_supercar_drift.mp4"), "data1");
  await fs.writeFile(path.join(tmpDir, "calm_ocean_sunset.mp4"), "data2");
  await fs.writeFile(path.join(tmpDir, "portrait_photo.png"), "data3");

  const engine = new MediaDiscoveryEngine();
  await engine.indexDirectory(tmpDir);

  // 1. Search for car videos
  const carResults = engine.searchMedia("find every video containing a car");
  assert.ok(carResults.length >= 1);
  assert.equal(carResults[0].name, "action_supercar_drift.mp4");

  // 2. Search for sunsets
  const sunsetResults = engine.searchMedia("find all images or videos of sunsets");
  assert.ok(sunsetResults.length >= 1);
  assert.equal(sunsetResults[0].name, "calm_ocean_sunset.mp4");

  // 3. Search for photos
  const photoResults = engine.searchMedia("find my portrait photos");
  assert.ok(photoResults.length >= 1);
  assert.equal(photoResults[0].name, "portrait_photo.png");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("MediaDiscoveryEngine: Google Drive and Cloud Storage adapter status reporting", () => {
  const engine = new MediaDiscoveryEngine();
  const status = engine.getCloudStorageStatus();

  assert.ok(status.googleDrive);
  assert.ok(["AUTHENTICATED", "READY_FOR_OAUTH"].includes(status.googleDrive.status));
  assert.ok(Array.isArray(status.supportedCloudProviders));
  assert.ok(status.supportedCloudProviders.includes("google-drive"));
});
