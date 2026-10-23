import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createVoiceStudioRouter } from "../integrations/voicestudio.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (_req, _res, next) => next();
  app.use("/api", createVoiceStudioRouter({ env, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const configured = { VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "test-token" };

test("status verifies discovery and model endpoint without exposing API key", async () => {
  const calls = [];
  await withServer(configured, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith("/v1/models") ? { data: [{ id: "omnivoice" }] } : { name: "VoiceStudio", version: "1.2" }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/status");
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.reachable, true);
    assert.equal(data.modelCount, 1);
    assert.equal(JSON.stringify(data).includes("test-token"), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  });
});

test("remote VoiceStudio requires HTTPS and an API key", async () => {
  await withServer({ VOICESTUDIO_BASE_URL: "http://voice.example" }, async () => { throw new Error("must not call network"); }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/voices");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_NOT_CONFIGURED");
  });
});

test("voice catalog normalizes provider voice records", async () => {
  await withServer(configured, async () => new Response(JSON.stringify({ data: [{ id: "voice_1", name: "Warm Voice", language: "hi" }] }), { status: 200 }), async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/voices");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).voices[0], { id: "voice_1", name: "Warm Voice", language: "hi" });
  });
});

test("speech synthesis forwards bounded request and returns audio base64", async () => {
  let request;
  await withServer(configured, async (url, options) => {
    request = { url, options };
    return new Response(Buffer.from("fake-wav-audio"), { status: 200, headers: { "content-type": "audio/wav" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Namaste ULTRON", voice: "voice_1", format: "wav", speed: 1.1 })
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.audioBase64, Buffer.from("fake-wav-audio").toString("base64"));
    assert.equal(request.url, "https://voice.example/v1/audio/speech");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.equal(JSON.parse(request.options.body).input, "Namaste ULTRON");
  });
});

test("speech synthesis rejects empty text before network call", async () => {
  let called = false;
  await withServer(configured, async () => { called = true; throw new Error("unexpected network"); }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: " " })
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test("transcription forwards valid audio multipart and returns transcript", async () => {
  let request;
  await withServer(configured, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ text: "नमस्ते ULTRON", language: "hi" }), { status: 200 });
  }, async base => {
    const audio = Buffer.from("mock-audio").toString("base64");
    const response = await fetch(base + "/api/integrations/voicestudio/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: audio, mimeType: "audio/wav", language: "hi" })
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.text, "नमस्ते ULTRON");
    assert.equal(data.language, "hi");
    assert.equal(request.url, "https://voice.example/v1/audio/transcriptions");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.equal(request.options.body instanceof FormData, true);
  });
});

test("transcription rejects invalid audio MIME type before network call", async () => {
  let called = false;
  await withServer(configured, async () => { called = true; throw new Error("unexpected network"); }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("x").toString("base64"), mimeType: "text/plain" })
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});
