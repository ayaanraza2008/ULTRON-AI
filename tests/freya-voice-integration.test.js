import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFreyaVoiceRouter, freyaVoiceReadiness } from "../integrations/freya-voice.js";

async function withServer(env, fetchImpl, run, { userId = "00000000-0000-4000-8000-000000000001" } = {}) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const configuredEnv = { ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001", ...env };
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: userId }; next(); };
  app.use("/api", createFreyaVoiceRouter({ env: configuredEnv, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const key = "synthetic-freya-key";
const env = { FREYA_API_KEY: key };

test("Freya readiness requires API key and uses documented separate hosts", () => {
  assert.equal(freyaVoiceReadiness({}).configured, false);
  const ready = freyaVoiceReadiness(env);
  assert.equal(ready.configured, true);
  assert.equal(ready.ttsEndpointConfigured, true);
  assert.equal(ready.sttEndpointConfigured, true);
  assert.equal(ready.reachable, undefined);
  assert.equal(JSON.stringify(ready).includes(key), false);
});

test("Freya denies non-owner accounts before contacting provider", async () => {
  let called = false;
  await withServer(env, async () => { called = true; throw new Error("must not call upstream"); }, async base => {
    const response = await fetch(base + "/api/integrations/freya/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "INTEGRATION_OWNER_ONLY");
    assert.equal(called, false);
  }, { userId: "00000000-0000-4000-8000-000000000002" });
});

test("Freya synthesis uses documented TTS host, payload, and server-side bearer auth", async () => {
  let request;
  await withServer(env, async (url, options) => {
    request = { url, options };
    return new Response(Buffer.from("freya-audio"), { status: 200, headers: { "content-type": "audio/wav" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/freya/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello ULTRON" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "freya");
    assert.equal(body.audioBase64, Buffer.from("freya-audio").toString("base64"));
    assert.equal(request.url, "https://tts.freyavoice.ai/v1/audio/speech");
    assert.equal(request.options.headers.Authorization, "Bearer " + key);
    assert.deepEqual(JSON.parse(request.options.body), { model: "freya-tts", voice: "leyla", input: "Hello ULTRON" });
    assert.equal(JSON.stringify(body).includes(key), false);
  });
});

test("Freya transcription sends multipart audio to the separate STT host", async () => {
  let request;
  await withServer(env, async (url, options) => {
    request = { url, options };
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("model"), "freya-stt");
    assert.equal(options.body.get("language"), null);
    assert.equal((await options.body.get("file").arrayBuffer()).byteLength, 4);
    return new Response(JSON.stringify({ text: "Namaste ULTRON", language: "hi" }));
  }, async base => {
    const response = await fetch(base + "/api/integrations/freya/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("RIFF").toString("base64"), mimeType: "audio/wav" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { provider: "freya", text: "Namaste ULTRON", language: "hi" });
    assert.equal(request.url, "https://stt.freyavoice.ai/v1/audio/transcriptions");
    assert.equal(request.options.headers.Authorization, "Bearer " + key);
    assert.equal(request.options.redirect, "error");
  });
});

test("Freya rejects invalid audio without contacting upstream", async () => {
  let called = false;
  await withServer(env, async () => { called = true; throw new Error("unexpected upstream call"); }, async base => {
    const response = await fetch(base + "/api/integrations/freya/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: "not-base64", mimeType: "audio/wav" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "FREYA_AUDIO_INVALID");
    assert.equal(called, false);
  });
});
