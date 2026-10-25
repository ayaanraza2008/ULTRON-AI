import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createVoiceStudioRouter, voiceStudioReadiness } from "../integrations/voicestudio.js";
import { voiceStudioSettings } from "../agent-runtime.js";

async function withServer(env, fetchImpl, run, { userId = "00000000-0000-4000-8000-000000000001" } = {}) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const configuredEnv = { ...env };
  if (!Object.hasOwn(configuredEnv, "ULTRON_INTEGRATION_OWNER_USER_ID")) {
    configuredEnv.ULTRON_INTEGRATION_OWNER_USER_ID = "00000000-0000-4000-8000-000000000001";
  }
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use("/api", createVoiceStudioRouter({ env: configuredEnv, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("VoiceStudio refuses shared credentials when the owner guard is missing", async () => {
  let called = false;
  await withServer({
    ULTRON_INTEGRATION_OWNER_USER_ID: "",
    VOICESTUDIO_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "synthetic-voice-key"
  }, async () => {
    called = true;
    throw new Error("VoiceStudio request should not reach the provider without an owner guard.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/voices");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});

test("VoiceStudio denies non-owner accounts before calling the upstream service", async () => {
  let called = false;
  await withServer({
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000002",
    VOICESTUDIO_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "synthetic-voice-key"
  }, async () => {
    called = true;
    throw new Error("Non-owner request must be rejected locally.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello world", format: "wav" })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "INTEGRATION_OWNER_ONLY");
    assert.equal(called, false);
  });
});

test("VoiceStudio JSON response reader stops at the byte limit instead of buffering the entire response", async () => {
  await withServer({
    VOICESTUDIO_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "synthetic-voice-key"
  }, async url => {
    assert.equal(url, "https://voice.example.com/v1/audio/voices");
    return new Response("x".repeat(1_000_001), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/voicestudio/voices");
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "VOICESTUDIO_RESPONSE_TOO_LARGE");
  });
});


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
    assert.equal(request.url, "https://voice.example.com/v1/audio/speech");
    assert.equal(request.options.headers.Authorization, "Bearer private-token");
    assert.equal(request.options.redirect, "error");
    assert.deepEqual(JSON.parse(request.options.body), {
      model: "tts-1", input: "Hello ULTRON", voice: "vaultar-voice", response_format: "wav", speed: 1.1
    });
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
    assert.equal(request.url, "https://voice.example.com/v1/audio/transcriptions");
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


test("VoiceStudio blocks private, link-local, metadata, and local HTTPS endpoints before forwarding credentials", async () => {
  const unsafeUrls = [
    "https://192.168.1.10",
    "https://10.2.3.4",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal",
    "https://[::1]",
    "https://[fd00::1]"
  ];
  for (const url of unsafeUrls) {
    assert.equal(voiceStudioReadiness({ VOICESTUDIO_BASE_URL: url, VOICESTUDIO_API_KEY: "synthetic-token" }).configured, false, url);
    assert.equal(voiceStudioSettings({ VOICESTUDIO_BASE_URL: url, VOICESTUDIO_API_KEY: "synthetic-token" }), null, url);
    let called = false;
    await withServer({
      VOICESTUDIO_BASE_URL: url,
      VOICESTUDIO_API_KEY: "synthetic-token"
    }, async () => {
      called = true;
      throw new Error("Unsafe VoiceStudio URL must never be contacted.");
    }, async base => {
      const response = await fetch(base + "/api/integrations/voicestudio/voices");
      assert.equal(response.status, 503, url);
      assert.equal(called, false, url);
    });
  }
});

test("VoiceStudio still allows local loopback development and secure public remote services", () => {
  assert.equal(voiceStudioSettings({ VOICESTUDIO_BASE_URL: "http://localhost:3900" }).baseUrl, "http://localhost:3900");
  assert.equal(voiceStudioSettings({ VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "synthetic-token" }).baseUrl, "https://voice.example");
});
