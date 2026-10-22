import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIntegrationRouter } from "../integrations/router.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createIntegrationRouter({ env, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("ComfyUI queue forwards workflow to the configured API and returns prompt id", async () => {
  let request;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example", COMFYUI_API_KEY: "test-token" }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ prompt_id: "prompt_123", node_errors: {} }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: { "1": { class_type: "CheckpointLoaderSimple", inputs: {} } } })
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).promptId, "prompt_123");
    assert.equal(request.url, "https://comfy.example/prompt");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.equal(JSON.parse(request.options.body).prompt["1"].class_type, "CheckpointLoaderSimple");
  });
});

test("ComfyUI queue rejects malformed workflow before network call", async () => {
  let called = false;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example" }, async () => {
    called = true;
    throw new Error("unexpected network call");
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: [] })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_COMFYUI_WORKFLOW");
    assert.equal(called, false);
  });
});

test("OmniVoice requires an explicit configured API path and text", async () => {
  let called = false;
  await withServer({ OMNIVOICE_API_BASE_URL: "https://voice.example", OMNIVOICE_API_KEY: "token" }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/omnivoice/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { text: "hello" } })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "OMNIVOICE_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});

test("OmniVoice sends payload to the configured provider path", async () => {
  let request;
  await withServer({
    OMNIVOICE_API_BASE_URL: "https://voice.example",
    OMNIVOICE_API_KEY: "token",
    OMNIVOICE_SYNTHESIS_PATH: "/v1/synthesize"
  }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ audioBase64: "YXVkaW8=" }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/omnivoice/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { text: "hello", language: "en" } })
    });
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://voice.example/v1/synthesize");
    assert.equal(request.options.headers.Authorization, "Bearer token");
    assert.equal((await response.json()).result.audioBase64, "YXVkaW8=");
  });
});

test("Handy rejects non-base64 audio without calling the local bridge", async () => {
  let called = false;
  await withServer({
    ULTRON_HANDY_BRIDGE_URL: "https://handy.example",
    ULTRON_HANDY_BRIDGE_TOKEN: "token",
    ULTRON_HANDY_TRANSCRIBE_PATH: "/transcribe"
  }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/handy/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { audioBase64: "not audio!" } })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "HANDY_AUDIO_REQUIRED");
    assert.equal(called, false);
  });
});
