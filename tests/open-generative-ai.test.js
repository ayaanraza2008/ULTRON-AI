import test from "node:test";
import assert from "node:assert/strict";
import {
  getOpenGenerativeAIReadiness,
  listOpenGenerativeAIModels,
  runOpenGenerativeAIAction,
  OPEN_GENERATIVE_AI_PAID_CONFIRMATION
} from "../integrations/open-generative-ai.js";

const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const readyEnv = {
  ULTRON_OPEN_GENERATIVE_AI_ENABLED: "true",
  MUAPI_API_KEY: "muapi-test-key-123456",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};
const approvedPrompt = "I explicitly approve paid image generation using my MuAPI provider credits.";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("Open Generative AI exposes the fixed 38-model image/video catalog without credentials", async () => {
  const catalog = await runOpenGenerativeAIAction({ action: "catalog" });
  assert.equal(catalog.modelCount, 38);
  assert.equal(new Set(catalog.models.map(model => model.id)).size, 38);
  assert.ok(catalog.models.some(model => model.id === "nano-banana-pro"));
  assert.ok(catalog.models.some(model => model.id === "veo3.1-reference-to-video"));
  assert.ok(catalog.models.some(model => model.id === "wan2.7-video-extend"));
});

test("MuAPI adapter is disabled by default and readiness never returns the key", () => {
  const disabled = getOpenGenerativeAIReadiness({});
  assert.equal(disabled.configured, false);
  assert.equal(disabled.state, "disabled_by_config");
  assert.equal(JSON.stringify(disabled).includes("muapi-test-key"), false);
  const configured = getOpenGenerativeAIReadiness(readyEnv, owner);
  assert.equal(configured.configured, true);
  assert.equal(configured.ownerAuthorized, true);
  assert.equal(JSON.stringify(configured).includes(readyEnv.MUAPI_API_KEY), false);
});

test("MuAPI generation requires explicit paid-use approval before any provider call", async () => {
  let calls = 0;
  const result = await runOpenGenerativeAIAction({
    env: readyEnv, userId: owner, action: "generate",
    model: "nano-banana-pro", prompt: "A red planet under an eclipse",
    fetchImpl: async () => { calls++; throw new Error("unexpected provider call"); }
  });
  assert.equal(result.state, "approval_required");
  assert.equal(result.execution, "not_started");
  assert.equal(calls, 0);
});

test("MuAPI blocks non-owner accounts before outbound requests", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenGenerativeAIAction({
      env: readyEnv, userId: stranger, action: "status", requestId: "req_123",
      fetchImpl: async () => { calls++; return jsonResponse({ status: "completed" }); }
    }),
    error => error.code === "INTEGRATION_OWNER_ONLY"
  );
  assert.equal(calls, 0);
});

test("MuAPI image generation uses a fixed endpoint and server-only x-api-key", async () => {
  let request;
  const result = await runOpenGenerativeAIAction({
    env: readyEnv, userId: owner, action: "generate",
    model: "nano-banana-pro", prompt: "Cinematic red planet at sunrise",
    settings: { aspectRatio: "16:9", resolution: "2k" },
    approvePaidGeneration: true,
    confirmationText: OPEN_GENERATIVE_AI_PAID_CONFIRMATION,
    userPrompt: approvedPrompt,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ request_id: "req_image_123", status: "queued" }, 202);
    }
  });
  assert.equal(request.url, "https://api.muapi.ai/api/v1/nano-banana-pro");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-api-key"], readyEnv.MUAPI_API_KEY);
  assert.equal(request.options.redirect, "error");
  const body = JSON.parse(request.options.body);
  assert.equal(body.prompt, "Cinematic red planet at sunrise");
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.resolution, "2k");
  assert.equal(result.state, "queued");
  assert.equal(result.requestId, "req_image_123");
  assert.equal(JSON.stringify(result).includes(readyEnv.MUAPI_API_KEY), false);
  assert.match(result.notice, /does not estimate or cap/i);
});

test("MuAPI video endpoint accepts a supplied public image frame and maps settings", async () => {
  let request;
  const result = await runOpenGenerativeAIAction({
    env: readyEnv, userId: owner, action: "generate",
    model: "veo3.1-image-to-video", prompt: "The camera slowly moves around the city",
    media: { imageUrl: "https://cdn.example.com/start-frame.png" },
    settings: { aspectRatio: "16:9", duration: 8, resolution: "1080p", generate_audio: true },
    approvePaidGeneration: true,
    confirmationText: OPEN_GENERATIVE_AI_PAID_CONFIRMATION,
    userPrompt: "I approve this paid video generation using my provider credits.",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ request_id: "req_video_123", status: "pending" }, 202);
    }
  });
  assert.equal(request.url, "https://api.muapi.ai/api/v1/veo3.1-image-to-video");
  const body = JSON.parse(request.options.body);
  assert.equal(body.image_url, "https://cdn.example.com/start-frame.png");
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.duration, 8);
  assert.equal(body.generate_audio, true);
  assert.equal(result.state, "queued");
  assert.equal(result.requestId, "req_video_123");
});

test("MuAPI rejects private media URLs, incompatible settings and model injection before outbound calls", async () => {
  let calls = 0;
  const generate = options => runOpenGenerativeAIAction({
    env: readyEnv, userId: owner, action: "generate",
    approvePaidGeneration: true,
    confirmationText: OPEN_GENERATIVE_AI_PAID_CONFIRMATION,
    userPrompt: approvedPrompt,
    fetchImpl: async () => { calls++; return jsonResponse({ request_id: "req_123" }); },
    ...options
  });
  await assert.rejects(
    generate({ model: "veo3.1-image-to-video", prompt: "animate", media: { imageUrl: "http://127.0.0.1/private.png" } }),
    error => error.code === "MUAPI_MEDIA_URL_INVALID"
  );
  await assert.rejects(
    generate({ model: "nano-banana-pro", prompt: "image", settings: { resolution: "16k" } }),
    error => error.code === "MUAPI_SETTING_INVALID"
  );
  await assert.rejects(
    generate({ model: "../../admin/delete", prompt: "image" }),
    error => error.code === "MUAPI_MODEL_INVALID"
  );
  await assert.rejects(
    generate({ model: "veo3.1-image-to-video", prompt: "animate" }),
    error => error.code === "MUAPI_MEDIA_REQUIRED"
  );
  assert.equal(calls, 0);
});

test("MuAPI status polling normalizes completed output URLs and drops unsafe output hosts", async () => {
  let request;
  const result = await runOpenGenerativeAIAction({
    env: readyEnv, userId: owner, action: "status", requestId: "req_video_123",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        status: "completed",
        outputs: [
          "https://cdn.muapi.ai/output/video.mp4",
          "https://127.0.0.1/private.mp4"
        ],
        cost: { amount_credits: 12 }
      });
    }
  });
  assert.equal(request.url, "https://api.muapi.ai/api/v1/predictions/req_video_123/result");
  assert.equal(request.options.method, "GET");
  assert.equal(result.state, "status_available");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.outputs, ["https://cdn.muapi.ai/output/video.mp4"]);
  assert.equal(result.reportedCredits, 12);
  assert.equal(JSON.stringify(result).includes("127.0.0.1"), false);
});

test("MuAPI rejects malformed request IDs and redacts provider authentication errors", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenGenerativeAIAction({
      env: readyEnv, userId: owner, action: "status", requestId: "../secret",
      fetchImpl: async () => { calls++; return jsonResponse({ status: "completed" }); }
    }),
    error => error.code === "MUAPI_REQUEST_ID_INVALID"
  );
  await assert.rejects(
    runOpenGenerativeAIAction({
      env: readyEnv, userId: owner, action: "status", requestId: "req_123",
      fetchImpl: async () => jsonResponse({ error: "invalid key muapi-test-key-123456" }, 401)
    }),
    error => error.code === "MUAPI_AUTH_FAILED" && !/muapi-test-key/.test(error.message)
  );
  assert.equal(calls, 0);
});
