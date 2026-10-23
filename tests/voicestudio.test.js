import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIntegrationRouter } from "../integrations/router.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (_req, _res, next) => next();
  app.use("/api", createIntegrationRouter({ env, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("VoiceStudio voice list returns only bounded public voice fields", async () => {
  let request;
  await withServer({
    VOICESTUDIO_API_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "secret-test"
  }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ voices: [
      { voice_id: "voice_1", name: "Narrator", addressable_by_name: true, internal_path: "/private" }
    ] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/voices");
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://voice.example/v1/audio/voices");
    assert.equal(request.options.headers.Authorization, "Bearer secret-test");
    assert.deepEqual((await response.json()).voices, [
      { id: "voice_1", name: "Narrator", addressableByName: true }
    ]);
  });
});

test("VoiceStudio speech uses a fixed upstream route and returns audio base64", async () => {
  let request;
  await withServer({
    VOICESTUDIO_API_BASE_URL: "https://voice.example/v1",
    VOICESTUDIO_API_KEY: "secret-test"
  }, async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200, headers: { "Content-Type": "audio/wav" }
    });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/speech", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { text: "Hello ULTRON", voice: "voice_1", response_format: "wav", speed: 1.1 } })
    });
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://voice.example/v1/audio/speech");
    assert.equal(request.options.headers.Authorization, "Bearer secret-test");
    const sent = JSON.parse(request.options.body);
    assert.equal(sent.input, "Hello ULTRON");
    assert.equal(sent.voice, "voice_1");
    assert.equal(sent.response_format, "wav");
    assert.equal((await response.json()).audioBase64, "AQIDBA==");
  });
});

test("VoiceStudio speech rejects empty text before network call", async () => {
  let called = false;
  await withServer({
    VOICESTUDIO_API_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "secret-test"
  }, async () => {
    called = true;
    return new Response("unexpected", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/speech", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { text: "  " } })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_TEXT_REQUIRED");
    assert.equal(called, false);
  });
});

test("VoiceStudio adapter fails closed when not configured", async () => {
  let called = false;
  await withServer({}, async () => {
    called = true;
    return new Response("unexpected", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/voices");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});
