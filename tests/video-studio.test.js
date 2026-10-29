import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSrt, createProjectStore, makeFallbackConcepts, makeFallbackScenes, normalizeScenes, newProject, safeAssetFilename, safeProjectId, validateProjectInput, validateReferenceUrl } from "../video-studio/core.mjs";
import { createVideoStudioServer } from "../video-studio/server.mjs";

test("video studio validates briefs, format and reference URLs", () => {
  assert.equal(validateProjectInput({ brief: "tiny" }).ok, false);
  assert.equal(validateProjectInput({ brief: "A cinematic video about rain.", format: "portrait", durationSeconds: 30 }).value.format, "portrait");
  assert.equal(validateReferenceUrl("https://youtu.be/abc123").ok, true);
  assert.equal(validateReferenceUrl("http://youtube.com/watch?v=abc").ok, false);
  assert.equal(validateReferenceUrl("https://user:pass@youtube.com/watch?v=abc").ok, false);
  assert.equal(validateReferenceUrl("https://youtube.com.evil.test/watch?v=abc").ok, false);
  assert.equal(validateReferenceUrl("https://127.0.0.1/video.mp4").ok, false);
});

test("fallback plans are timed and create three distinct concept options", () => {
  const project = newProject({ brief: "A short cinematic film about a midnight train.", durationSeconds: 45, format: "portrait", sourceMode: "images" });
  const concepts = makeFallbackConcepts(project);
  assert.equal(concepts.length, 3);
  assert.equal(new Set(concepts.map(c => c.id)).size, 3);
  const scenes = makeFallbackScenes(project, concepts[2]);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0), 45);
  assert.ok(scenes.every(scene => scene.mediaType === "image"));
  assert.ok(normalizeScenes(scenes, project));
  assert.equal(normalizeScenes([{ durationSeconds: 10 }, { durationSeconds: 10 }], project), null);
});

test("SRT output uses monotonically increasing scene-time ranges", () => {
  const srt = buildSrt([
    { durationSeconds: 4, narration: "First line. Second line." },
    { durationSeconds: 3, narration: "Final thought." }
  ]);
  assert.match(srt, /00:00:00,000 --> 00:00:02,000/);
  assert.match(srt, /Second line\./);
  assert.match(srt, /00:00:04,000 --> 00:00:07,000/);
});

test("file-backed project store persists data and rejects unsafe asset paths", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-video-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createProjectStore(dir);
  const project = await store.create({ brief: "An atmospheric short about a storm.", durationSeconds: 30 });
  assert.equal((await store.get(project.id)).id, project.id);
  await store.update(project.id, p => { p.status = "needs_review"; return p; });
  assert.equal((await store.get(project.id)).status, "needs_review");
  assert.equal((await store.list()).length, 1);
  assert.equal(safeProjectId(project.id), project.id);
  assert.equal(safeProjectId("../secret"), null);
  assert.equal(safeAssetFilename("../" + project.id + ".mp4"), null);
  await assert.rejects(() => store.assetPath(project.id, "../../secret.txt"));
});

test("local HTTP API creates projects and cannot bypass render approval", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-video-http-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = createVideoStudioServer({ env: { VIDEO_STUDIO_HOST: "127.0.0.1" }, dataDir: dir, logger: { warn() {} } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const base = "http://127.0.0.1:" + address.port;
  const bad = await fetch(base + "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: "tiny" }) });
  assert.equal(bad.status, 400);
  const created = await fetch(base + "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: "An original short about a storm over the sea.", durationSeconds: 30, sourceMode: "images" }) });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.ok(body.project.id);
  const render = await fetch(base + "/api/projects/" + body.project.id + "/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  assert.equal(render.status, 409);
  const approval = await fetch(base + "/api/projects/" + body.project.id + "/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) });
  assert.equal(approval.status, 409);
  const hostileHost = await fetch(base + "/api/projects", { headers: { Host: "not-local.example" } });
  assert.equal(hostileHost.status, 403);
});
