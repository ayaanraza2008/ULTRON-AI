import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createVideoStudioRouter } from "../video-studio.js";
import { createApp } from "../server.js";

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
      if (command === "ffmpeg" && args.some(arg => String(arg).includes("showinfo"))) return { stdout: "", stderr: "pts_time:2.1\npts_time:5.0\n" };
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

    const changedAsset = await request(base, "/api/studio/projects/" + project.id + "/assets/upload", {
      method: "POST", body: JSON.stringify({ filename: "second.png", fileBase64: Buffer.from("another-synthetic-image").toString("base64") })
    });
    assert.equal(changedAsset.status, 201);
    const changedProject = (await changedAsset.json()).project;
    assert.equal(changedProject.approvals.plan, true);
    assert.equal(changedProject.approvals.render, false);
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
    const url = new URL(base);
    const body = JSON.stringify({ prompt: "This should be blocked." });
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: url.hostname,
        port: Number(url.port),
        path: "/api/studio/projects",
        method: "POST",
        headers: { Host: "attacker.example", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(result.status, 403);
    assert.equal(JSON.parse(result.body).error.code, "LOCAL_STUDIO_LOOPBACK_ONLY");
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

test("local reference audio can be transcribed using a configured OpenAI-compatible STT provider", async () => {
  const upstreamCalls = [];
  await withStudio({
    env: { STT_API_BASE_URL: "https://speech.example.com/v1", STT_API_KEY: "synthetic-stt-secret" },
    commandRunner: async (command, args) => {
      if (args.includes("-version")) return { stdout: command + " version test\n", stderr: "" };
      if (command === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "10" }, streams: [{ codec_type: "video", width: 720, height: 1280 }] }), stderr: "" };
      if (command === "ffmpeg" && args.includes("-c:a")) {
        await writeFile(args.at(-1), Buffer.concat([Buffer.alloc(44), Buffer.from("mock extracted audio")]));
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "pts_time:2.0\n" };
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      assert.equal(url, "https://speech.example.com/v1/audio/transcriptions");
      assert.equal(options.headers.Authorization, "Bearer synthetic-stt-secret");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("model"), "whisper-1");
      assert.equal(options.body.get("file").type, "audio/wav");
      return new Response(JSON.stringify({ text: "The station clock loses seventeen minutes.", language: "en" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
  }, async ({ base }) => {
    const project = await createProject(base);
    const upload = await request(base, "/api/studio/projects/" + project.id + "/reference/upload", {
      method: "POST",
      body: JSON.stringify({ filename: "reference.mp4", fileBase64: Buffer.from("synthetic-video").toString("base64") })
    });
    assert.equal(upload.status, 201);
    const response = await request(base, "/api/studio/projects/" + project.id + "/reference/transcribe", {
      method: "POST", body: JSON.stringify({ language: "English" })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.transcript, "The station clock loses seventeen minutes.");
    assert.equal(data.project.reference.transcript, data.transcript);
    assert.equal(data.project.approvals.plan, false);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(JSON.stringify(data).includes("synthetic-stt-secret"), false);
  });
});

test("existing ULTRON server serves the integrated Video Studio page and local static assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ultron-studio-app-"));
  const app = createApp({
    env: { NODE_ENV: "test", ULTRON_VIDEO_STUDIO_LOCAL_MODE: "true", ULTRON_VIDEO_STUDIO_DIR: root },
    logger: { warn() {}, error() {}, info() {} }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const page = await fetch(base + "/studio");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /ULTRON Video Studio/);
    const css = await fetch(base + "/studio/static/studio.css");
    assert.equal(css.status, 200);
    assert.match(await css.text(), /--red:/);
    const js = await fetch(base + "/studio/static/studio.js");
    assert.equal(js.status, 200);
    assert.match(await js.text(), /reference\\/transcribe/);
    assert.match(page.headers.get("content-security-policy"), /media-src 'self' blob: https:/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

