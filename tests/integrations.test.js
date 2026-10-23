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

test("ComfyUI status reports device and queue counts", async () => {
  const urls = [];
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example" }, async url => {
    urls.push(url);
    if (url.endsWith("/system_stats")) return new Response(JSON.stringify({ devices: [{ name: "GPU 0", type: "cuda", vram_total: 8000, vram_free: 4000 }] }), { status: 200 });
    if (url.endsWith("/queue")) return new Response(JSON.stringify({ queue_running: [[1, "running_1"]], queue_pending: [[2, "pending_1"], [3, "pending_2"]] }), { status: 200 });
    throw new Error("Unexpected URL " + url);
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/status");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reachable, true);
    assert.equal(body.system.devices[0].name, "GPU 0");
    assert.deepEqual(body.queue, { running: 1, pending: 2 });
  });
  assert.deepEqual(urls.sort(), ["https://comfy.example/queue", "https://comfy.example/system_stats"].sort());
});

test("ComfyUI queue inspection summarizes jobs without returning workflow payloads", async () => {
  let requestedUrl;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example" }, async url => {
    requestedUrl = url;
    return new Response(JSON.stringify({
      queue_running: [[1, "active_123", { secret: "large workflow" }, { extra_pnginfo: { workflow: { name: "Test workflow" } } }]],
      queue_pending: [[2, "waiting_456", { prompt: "omitted" }, {}]]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.running[0].promptId, "active_123");
    assert.equal(body.running[0].workflowName, "Test workflow");
    assert.equal(body.pending[0].promptId, "waiting_456");
    assert.equal(JSON.stringify(body).includes("large workflow"), false);
    assert.equal(requestedUrl, "https://comfy.example/queue");
  });
});

test("ComfyUI queued-job cancellation sends only the requested prompt id", async () => {
  let request;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example", COMFYUI_API_KEY: "token" }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/jobs/queued_123", { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://comfy.example/queue");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), { delete: ["queued_123"] });
    assert.equal(request.options.headers.Authorization, "Bearer token");
  });
});

test("ComfyUI cancellation rejects unsafe prompt ids", async () => {
  let called = false;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example" }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/jobs/%2Fetc%2Fpasswd", { method: "DELETE" });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});


test("integration catalog reports readiness without exposing credentials or claiming connectivity", async () => {
  await withServer({
    ULTRON_EMPLOYEES_ENABLED: "true",
    COMFYUI_BASE_URL: "https://comfy.example",
    COMFYUI_API_KEY: "secret-comfy-test",
    OMNIVOICE_API_BASE_URL: "https://voice.example",
    OMNIVOICE_API_KEY: "secret-voice-test",
    OMNIVOICE_SYNTHESIS_PATH: "/synthesize"
  }, async () => { throw new Error("catalog must not call upstream services"); }, async base => {
    const response = await fetch(base + "/api/integrations/catalog");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.verification, "configuration_only");
    const comfy = body.integrations.find(item => item.id === "comfyui");
    const voice = body.integrations.find(item => item.id === "omnivoice");
    const employees = body.integrations.find(item => item.id === "ai-employees");
    assert.equal(comfy.state, "configured_unverified");
    assert.equal(voice.configured, true);
    assert.equal(employees.state, "enabled_guarded_templates");
    assert.equal(JSON.stringify(body).includes("secret-comfy-test"), false);
    assert.equal(JSON.stringify(body).includes("secret-voice-test"), false);
  });
});


test("VoiceStudio speech sends an OpenAI-compatible request and returns audio", async () => {
  let request;
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "test-token" }, async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/speech", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello ULTRON", voice: "alloy", model: "tts-1", response_format: "mp3" })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.provider, "voicestudio");
    assert.equal(result.contentType, "audio/mpeg");
    assert.equal(result.audioBase64, Buffer.from([1, 2, 3, 4]).toString("base64"));
    assert.equal(request.url, "https://voice.example/v1/audio/speech");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(request.options.body), { model: "tts-1", input: "Hello ULTRON", voice: "alloy", response_format: "mp3" });
  });
});

test("VoiceStudio speech refuses missing service config and empty text", async () => {
  let called = false;
  await withServer({}, async () => { called = true; throw new Error("unexpected network call"); }, async base => {
    const missing = await fetch(base + "/api/integrations/voicestudio/speech", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello" })
    });
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error.code, "VOICESTUDIO_NOT_CONFIGURED");
    assert.equal(called, false);
  });
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example" }, async () => { called = true; }, async base => {
    const empty = await fetch(base + "/api/integrations/voicestudio/speech", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: " " })
    });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, "VOICESTUDIO_TEXT_REQUIRED");
    assert.equal(called, false);
  });
});
