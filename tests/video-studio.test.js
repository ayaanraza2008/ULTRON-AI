import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createVideoStudioRouter } from "../video-studio.js";

async function withStudio({ env: overrides = {}, commandRunner, fetchImpl, authenticated = false } = {}, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ultron-video-studio-"));
  const env = { ULTRON_VIDEO_STUDIO_LOCAL_MODE: "true", ULTRON_VIDEO_STUDIO_DIR: root, ...overrides };
  const app = express();
  app.use(express.json({ limit: "12mb", strict: true }));
  const requireSupabaseUser = authenticated
    ? (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com" }; next(); }
    : (_req, res) => res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in required." } });
  app.use("/api", createVideoStudioRouter({
    env,
    requireSupabaseUser,
    commandRunner: commandRunner || (async (command, args) => {
      if (args.includes("-version")) return { stdout: command + " version test\n", stderr: "" };
      if (command === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "10.0" }, streams: [
        { codec_type: "video", width: 720, height: 1280, avg_frame_rate: "30/1" }, { codec_type: "audio" }
      ] }), stderr: "" };
      if (command === "ffmpeg" && args.includes("showinfo")) return { stdout: "", stderr: "pts_time:2.1\npts_time:5.0\n" };
      return { stdout: "", stderr: "" };
    }),
    fetchImpl: fetchImpl || (async () => { throw new Error("Unexpected network call in test"); }),
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  try { await run({ base, env }); }
  finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
async function request(base, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(base + route, { ...options, headers });
}
async function createProject(base, extra = {}) {
  const response = await request(base, "/api/studio/projects", {
    method: "POST",
    body: JSON.stringify({ prompt: "A cinematic mystery at an empty railway station.", durationSeconds: 30, ...extra })
  });
  assert.equal(response.status, 201);
  return (await response.json()).project;
}

test("local status describes optional tools without returning provider credentials", async () => {
  await withStudio({
    env: { OPENROUTER_API_KEY: "synthetic-secret", PEXELS_API_KEY: "synthetic-pexels-secret" }
  }, async ({ base }) => {
    const response = await request(base, "/api/studio/status");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mode, "local-loopback");
    assert.equal(data.tools.research, false);
    assert.equal(data.tools.pexels, true);
    assert.equal(JSON.stringify(data).includes("synthetic-secret"), false);
  });
});

test("project creation, local plan fallback, and per-project persistence work", async () => {
  await withStudio({}, async ({ base }) => {
    const project = await createProject(base, { aspectRatio: "16:9" });
    assert.match(project.id, /^[0-9a-f-]{36}$/i);
    assert.equal(project.stage, "idea");
    const planResponse = await request(base, "/api/studio/projects/" + project.id + "/plan", { method: "POST", body: "{}" });
    assert.equal(planResponse.status, 200);
    const planned = (await planResponse.json()).project;
    assert.equal(planned.concepts.length, 3);
    assert.ok(planned.scenes.length >= 3);
    assert.equal(planned.stage, "planned");
    assert.equal(planned.approvals.plan, false);
    const list = await request(base, "/api/studio/projects");
    assert.equal(list.status, 200);
    assert.equal((await list.json()).projects[0].id, project.id);
  });
});

test("reference clips use bounded upload and expose real ffprobe/scene-cut analysis", async () => {
  await withStudio({}, async ({ base }) => {
    const project = await createProject(base);
    const upload = await request(base, "/api/studio/projects/" + project.id + "/reference/upload", {
      method: "POST", body: JSON.stringify({ filename: "reference.mp4", fileBase64: Buffer.from("synthetic-video").toString("base64") })
    });
    assert.equal(upload.status, 201);
    const analysis = await request(base, "/api/studio/projects/" + project.id + "/reference/analyze", {
      method: "POST", body: JSON.stringify({ transcript: "A sample transcript for style analysis." })
    });
    assert.equal(analysis.status, 200);
    const result = await analysis.json();
    assert.equal(result.analysis.analysisDepth, "local-media-metadata+scene-cuts");
    assert.equal(result.analysis.durationSeconds, 10);
    assert.deepEqual(result.analysis.sceneCutsSeconds, [2.1, 5]);
    assert.equal(result.analysis.transcript, "A sample transcript for style analysis.");
  });
});

test("approval gates block rendering until both the plan and visual assets are approved", async () => {
  await withStudio({}, async ({ base }) => {
    const project = await createProject(base);
    const premature = await request(base, "/api/studio/projects/" + project.id + "/approve", {
      method: "POST", body: JSON.stringify({ stage: "plan" })
    });
    assert.equal(premature.status, 409);
    assert.equal((await premature.json()).error.code, "PLAN_NOT_READY");

    await request(base, "/api/studio/projects/" + project.id + "/plan", { method: "POST", body: "{}" });
    const noVisuals = await request(base, "/api/studio/projects/" + project.id + "/approve", {
      method: "POST", body: JSON.stringify({ stage: "render" })
    });
    assert.equal(noVisuals.status, 409);
    assert.equal((await noVisuals.json()).error.code, "PLAN_APPROVAL_REQUIRED");

    await request(base, "/api/studio/projects/" + project.id + "/approve", {
      method: "POST", body: JSON.stringify({ stage: "plan" })
    });
    const noAssetsStill = await request(base, "/api/studio/projects/" + project.id + "/approve", {
      method: "POST", body: JSON.stringify({ stage: "render" })
    });
    assert.equal(noAssetsStill.status, 409);
    assert.equal((await noAssetsStill.json()).error.code, "VISUAL_ASSETS_REQUIRED");

    const upload = await request(base, "/api/studio/projects/" + project.id + "/assets/upload", {
      method: "POST", body: JSON.stringify({ filename: "still.png", fileBase64: Buffer.from("synthetic-image").toString("base64") })
    });
    assert.equal(upload.status, 201);
    const approved = await request(base, "/api/studio/projects/" + project.id + "/approve", {
      method: "POST", body: JSON.stringify({ stage: "render" })
    });
    assert.equal(approved.status, 200);
    const result = (await approved.json()).project;
    assert.equal(result.approvals.plan, true);
    assert.equal(result.approvals.render, true);
    assert.equal(result.stage, "ready_to_render");
  });
});

test("script edits invalidate prior plan and final-render approvals; captions can be downloaded", async () => {
  await withStudio({}, async ({ base }) => {
    const project = await createProject(base);
    await request(base, "/api/studio/projects/" + project.id + "/plan", { method: "POST", body: "{}" });
    const update = await request(base, "/api/studio/projects/" + project.id + "/script", {
      method: "PATCH", body: JSON.stringify({ script: "A new opening line. A final reveal." })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).project.approvals.plan, false);
    const captions = await request(base, "/api/studio/projects/" + project.id + "/captions", { method: "POST", body: "{}" });
    assert.equal(captions.status, 200);
    const downloaded = await request(base, "/api/studio/projects/" + project.id + "/captions");
    assert.equal(downloaded.status, 200);
    assert.match(await downloaded.text(), /00:00:00,000 -->/);
  });
});

test("non-local mode enforces authenticated account access", async () => {
  await withStudio({ env: { ULTRON_VIDEO_STUDIO_LOCAL_MODE: "false" } }, async ({ base }) => {
    const response = await request(base, "/api/studio/projects");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
  });
});

test("local mode rejects requests that use a non-loopback Host header", async () => {
  await withStudio({}, async ({ base }) => {
    const response = await request(base, "/api/studio/projects", {
      method: "POST",
      headers: { host: "attacker.example" },
      body: JSON.stringify({ prompt: "This should be blocked." })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "LOCAL_STUDIO_LOOPBACK_ONLY");
  });
});

test("unsupported reference URL schemes and unknown project IDs are rejected", async () => {
  await withStudio({}, async ({ base }) => {
    const unsafe = await request(base, "/api/studio/projects", {
      method: "POST", body: JSON.stringify({ prompt: "A video brief", referenceUrl: "http://127.0.0.1/private" })
    });
    assert.equal(unsafe.status, 400);
    assert.equal((await unsafe.json()).error.code, "REFERENCE_URL_UNSUPPORTED");
    const missing = await request(base, "/api/studio/projects/00000000-0000-4000-8000-000000000001");
    assert.equal(missing.status, 404);
  });
});
