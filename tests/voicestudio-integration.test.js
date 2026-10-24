import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createVoiceStudioRouter, voiceStudioReadiness } from "../integrations/voicestudio.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
    next();
  };
  app.use("/api", createVoiceStudioRouter({ env, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("VoiceStudio readiness requires a secure remote endpoint and API key", () => {
  assert.equal(voiceStudioReadiness({}).configured, false);
  assert.equal(voiceStudioReadiness({ VOICESTUDIO_BASE_URL: "http://voice.example" }).state, "https_required");
  assert.equal(voiceStudioReadiness({ VOICESTUDIO_BASE_URL: "https://voice.example" }).state, "remote_api_key_required");
  assert.equal(voiceStudioReadiness({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "secret" }).configured, true);
  assert.equal(voiceStudioReadiness({ VOICESTUDIO_BASE_URL: "http://localhost:3900" }).configured, true);
});

test("VoiceStudio status reports live discovery and model count without exposing credentials", async () => {
  const seen = [];
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    seen.push({ url, options });
    if (url.endsWith("/.well-known/voicestudio-speech")) return new Response(JSON.stringify({ name: "VoiceStudio", version: "0.5.3" }));
    return new Response(JSON.stringify({ data: [{ id: "omnivoice" }, { id: "whisper" }] }));
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/status");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reachable, true);
    assert.equal(body.modelCount, 2);
    assert.equal(JSON.stringify(body).includes("private-token"), false);
    assert.equal(seen.length, 2);
    assert.ok(seen.every(item => item.options.headers.Authorization === "Bearer private-token"));
    assert.ok(seen.every(item => item.options.redirect === "error"));
  });
});

test("VoiceStudio synthesis forwards validated options and returns bounded audio", async () => {
  let request;
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    request = { url, options };
    return new Response(Buffer.from("fake-wav"), { status: 200, headers: { "content-type": "audio/wav" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello ULTRON", voice: "vaultar-voice", format: "wav", speed: 1.1 })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.audioBase64, Buffer.from("fake-wav").toString("base64"));
    assert.equal(request.url, "https://voice.example/v1/audio/speech");
    assert.equal(request.options.headers.Authorization, "Bearer private-token");
    assert.equal(request.options.redirect, "error");
    assert.deepEqual(JSON.parse(request.options.body), {
      model: "tts-1", input: "Hello ULTRON", voice: "vaultar-voice", response_format: "wav", speed: 1.1
    });
  });
});

test("VoiceStudio synthesis rejects an oversized declared response before reading it", async () => {
  let cancelled = false;
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async () => {
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; }
    }), { status: 200, headers: { "content-type": "audio/wav", "content-length": String(12 * 1024 * 1024 + 1) } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test", format: "wav" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_RESPONSE_TOO_LARGE");
    assert.equal(cancelled, true);
  });
});

test("VoiceStudio synthesis cancels a streamed response that crosses the byte limit", async () => {
  let cancelled = false;
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async () => {
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; }
    }), { status: 200, headers: { "content-type": "audio/wav" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test", format: "wav" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_RESPONSE_TOO_LARGE");
    assert.equal(cancelled, true);
  });
});

test("VoiceStudio synthesis rejects unsupported format before network call", async () => {
  let called = false;
  await withServer({ VOICESTUDIO_BASE_URL: "http://localhost:3900" }, async () => {
    called = true;
    throw new Error("unexpected upstream call");
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", format: "exe" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_FORMAT_INVALID");
    assert.equal(called, false);
  });
});

test("VoiceStudio transcription sends multipart audio and returns recognized text", async () => {
  let request;
  await withServer({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    request = { url, options };
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("model"), "whisper-1");
    assert.equal(options.body.get("language"), "hi");
    assert.equal((await options.body.get("file").arrayBuffer()).byteLength, 4);
    return new Response(JSON.stringify({ text: "Namaste ULTRON", language: "hi" }));
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("RIFF").toString("base64"), mimeType: "audio/wav", language: "hi" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { provider: "voicestudio", text: "Namaste ULTRON", language: "hi" });
    assert.equal(request.url, "https://voice.example/v1/audio/transcriptions");
    assert.equal(request.options.headers.Authorization, "Bearer private-token");
    assert.equal(request.options.redirect, "error");
  });
});

test("VoiceStudio transcription rejects invalid audio before network call", async () => {
  let called = false;
  await withServer({ VOICESTUDIO_BASE_URL: "http://localhost:3900" }, async () => {
    called = true;
    throw new Error("unexpected upstream call");
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: "not base64!", mimeType: "audio/wav" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_AUDIO_INVALID");
    assert.equal(called, false);
  });
});
