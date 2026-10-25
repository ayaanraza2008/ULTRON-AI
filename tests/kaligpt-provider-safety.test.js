import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createFeatureRouter({
    env,
    requireSession: (_req, _res, next) => next(),
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
      next();
    },
    fetchImpl,
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const authEnv = {
  OPENROUTER_API_KEY: "test-only-provider-secret",
  OPENROUTER_DEFAULT_MODEL: "openrouter/free"
};

test("KaliGPT security-assist provider calls reject redirects", async () => {
  const calls = [];
  await withServer(authEnv, async (url, options) => {
    calls.push({ url, redirect: options.redirect, authorization: options.headers.Authorization });
    return new Response(JSON.stringify({
      model: "test-model",
      choices: [{ message: { content: "Use parameterized queries and least privilege." } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", mode: "learn", task: "Explain SQL injection prevention" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).answer, /parameterized queries/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, "error");
    assert.equal(calls[0].authorization, "Bearer test-only-provider-secret");
  });
});

test("KaliGPT vision provider calls reject redirects and parse only bounded JSON", async () => {
  const calls = [];
  await withServer(authEnv, async (url, options) => {
    calls.push({ url, redirect: options.redirect });
    return new Response(JSON.stringify({
      model: "test-vision-model",
      choices: [{ message: { content: "The supplied image contains a simple test pattern." } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/kaligpt/vision/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", mimeType: "image/png", imageBase64: Buffer.from("hello").toString("base64"), prompt: "Describe the image" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).answer, /test pattern/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].redirect, "error");
  });
});

test("KaliGPT vision cancels a response declared larger than the provider-response limit", async () => {
  let cancelled = false;
  let providerCalls = 0;
  await withServer(authEnv, async (_url, options) => {
    providerCalls += 1;
    assert.equal(options.redirect, "error");
    return new Response(new ReadableStream({
      start() {},
      cancel() { cancelled = true; }
    }), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1) }
    });
  }, async base => {
    const response = await fetch(base + "/api/kaligpt/vision/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", mimeType: "image/png", imageBase64: Buffer.from("hello").toString("base64"), prompt: "Describe the image" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "VISION_PROVIDERS_FAILED");
    assert.equal(providerCalls, 1);
    assert.equal(cancelled, true);
  });
});

test("KaliGPT refuses unsafe custom OpenAI URLs instead of silently using the public default", async () => {
  let providerCalls = 0;
  const unsafeOverride = {
    OPENAI_API_KEY: "test-only-openai-secret",
    OPENAI_BASE_URL: "http://169.254.169.254/v1",
    OPENAI_DEFAULT_MODEL: "test-model"
  };
  await withServer(unsafeOverride, async () => {
    providerCalls += 1;
    throw new Error("A provider call must not occur for an unsafe configured endpoint.");
  }, async base => {
    const security = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", mode: "learn", task: "Explain secure input handling" })
    });
    assert.equal(security.status, 503);
    assert.equal((await security.json()).error.code, "SECURITY_PROVIDER_NOT_CONFIGURED");
    const vision = await fetch(base + "/api/kaligpt/vision/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", mimeType: "image/png", imageBase64: Buffer.from("hello").toString("base64"), prompt: "Describe the image" })
    });
    assert.equal(vision.status, 503);
    assert.equal((await vision.json()).error.code, "VISION_PROVIDER_NOT_CONFIGURED");
    assert.equal(providerCalls, 0);
  });
});
