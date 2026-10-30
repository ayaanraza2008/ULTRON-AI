import test from "node:test";
import assert from "node:assert/strict";
import {
  getOpenHiggsfieldReadiness,
  listOpenHiggsfieldModels,
  runOpenHiggsfieldAction,
  OPEN_HIGGSFIELD_PAID_CONFIRMATION
} from "../integrations/open-higgsfield.js";

const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const readyEnv = {
  ULTRON_OPEN_HIGGSFIELD_ENABLED: "true",
  HF_API_BASE_URL: "https://api.higgsfield.ai",
  OPEN_HIGGSFIELD_API_KEY: "test-id:secret-value-123456",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};
const approvedPrompt = "I explicitly approve paid generation using my provider credits.";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("OpenHiggsfield exposes the 38 upstream model IDs without needing credentials", async () => {
  const catalog = await runOpenHiggsfieldAction({ action: "catalog" });
  assert.equal(catalog.modelCount, 38);
  assert.equal(new Set(catalog.models.map(model => model.id)).size, 38);
  assert.ok(catalog.models.some(model => model.id === "seedance-2.5-edit"));
  assert.ok(catalog.models.some(model => model.id === "kling-3-motion-pro"));
  assert.ok(catalog.models.some(model => model.id === "grok-imagine-video-1.5"));
});

test("OpenHiggsfield is disabled by default and readiness never returns the key", () => {
  const readiness = getOpenHiggsfieldReadiness({});
  assert.equal(readiness.configured, false);
  assert.equal(readiness.state, "disabled_by_config");
  assert.equal(JSON.stringify(readiness).includes("secret-value"), false);
  const configured = getOpenHiggsfieldReadiness(readyEnv, owner);
  assert.equal(configured.configured, true);
  assert.equal(configured.ownerAuthorized, true);
  assert.equal(JSON.stringify(configured).includes(readyEnv.OPEN_HIGGSFIELD_API_KEY), false);
});

test("OpenHiggsfield requires explicit paid-use confirmation before any provider call", async () => {
  let calls = 0;
  const result = await runOpenHiggsfieldAction({
    env: readyEnv, userId: owner, action: "generate", model: "soul-cinema", prompt: "A red planet at sunrise",
    approvePaidGeneration: false, fetchImpl: async () => { calls++; throw new Error("unexpected provider call"); }
  });
  assert.equal(result.state, "approval_required");
  assert.equal(result.execution, "not_started");
  assert.equal(calls, 0);
});

test("OpenHiggsfield blocks non-owner accounts before outbound requests", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenHiggsfieldAction({ env: readyEnv, userId: stranger, action: "status", requestId: "req_123", fetchImpl: async () => { calls++; return jsonResponse({}); } }),
    error => error.code === "INTEGRATION_OWNER_ONLY"
  );
  assert.equal(calls, 0);
});

test("OpenHiggsfield queue uses fixed model routes, server key auth, and bounded body", async () => {
  let request;
  const result = await runOpenHiggsfieldAction({
    env: readyEnv, userId: owner, action: "generate",
    model: "soul-cinema", prompt: "Cinematic crimson planet over a dark horizon",
    settings: { batchSize: 4, aspectRatio: "16:9", resolution: "1080p", enhancePrompt: true },
    approvePaidGeneration: true,
    confirmationText: OPEN_HIGGSFIELD_PAID_CONFIRMATION,
    userPrompt: approvedPrompt,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ request_id: "req_123", status: "queued", status_url: "https://attacker.invalid/status" });
    }
  });
  assert.equal(result.state, "queued");
  assert.equal(result.requestId, "req_123");
  assert.equal(result.model, "soul-cinema");
  assert.equal(request.url, "https://api.higgsfield.ai/higgsfield-ai/soul/cinema");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Key " + readyEnv.OPEN_HIGGSFIELD_API_KEY);
  assert.equal(request.options.redirect, "error");
  const body = JSON.parse(request.options.body);
  assert.equal(body.prompt, "Cinematic crimson planet over a dark horizon");
  assert.equal(body.batch_size, 4);
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.resolution, "1080p");
  assert.equal(JSON.stringify(result).includes(readyEnv.OPEN_HIGGSFIELD_API_KEY), false);
  assert.match(result.notice, /not estimated or capped/i);
});

test("OpenHiggsfield rejects non-public media and invalid settings before calling provider", async () => {
  let calls = 0;
  const call = (options) => runOpenHiggsfieldAction({
    env: readyEnv, userId: owner, action: "generate",
    approvePaidGeneration: true,
    confirmationText: OPEN_HIGGSFIELD_PAID_CONFIRMATION,
    userPrompt: approvedPrompt,
    fetchImpl: async () => { calls++; return jsonResponse({ request_id: "req_123" }); },
    ...options
  });
  await assert.rejects(call({ model: "seedance-2", prompt: "video", media: { start: ["http://127.0.0.1/private.png"] } }),
    error => error.code === "OPEN_HIGGSFIELD_MEDIA_URL_INVALID");
  await assert.rejects(call({ model: "soul-cinema", prompt: "image", settings: { aspectRatio: "20:1" } }),
    error => error.code === "OPEN_HIGGSFIELD_SETTING_INVALID");
  await assert.rejects(call({ model: "../../arbitrary-endpoint", prompt: "image" }),
    error => error.code === "OPEN_HIGGSFIELD_MODEL_INVALID");
  assert.equal(calls, 0);
});

test("OpenHiggsfield requires supplied first-frame media for models that cannot text-generate", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenHiggsfieldAction({
      env: readyEnv, userId: owner, action: "generate", model: "kling-2.5", prompt: "A bicycle turns",
      approvePaidGeneration: true, confirmationText: OPEN_HIGGSFIELD_PAID_CONFIRMATION, userPrompt: approvedPrompt,
      fetchImpl: async () => { calls++; return jsonResponse({ request_id: "req_123" }); }
    }),
    error => error.code === "OPEN_HIGGSFIELD_MEDIA_REQUIRED"
  );
  assert.equal(calls, 0);
});

test("OpenHiggsfield status polling only returns bounded public media URLs", async () => {
  let request;
  const result = await runOpenHiggsfieldAction({
    env: readyEnv, userId: owner, action: "status", requestId: "req_123",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        request_id: "req_123", status: "completed",
        images: [{ url: "https://cdn.higgsfield.ai/result.webp" }, { url: "https://127.0.0.1/private.webp" }],
        video: { url: "https://cdn.higgsfield.ai/result.mp4" }
      });
    }
  });
  assert.equal(request.url, "https://api.higgsfield.ai/requests/req_123/status");
  assert.equal(request.options.method, "GET");
  assert.equal(result.state, "status_available");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.images, ["https://cdn.higgsfield.ai/result.webp"]);
  assert.equal(result.video, "https://cdn.higgsfield.ai/result.mp4");
  assert.equal(JSON.stringify(result).includes("127.0.0.1"), false);
});

test("OpenHiggsfield rejects unsafe request IDs and failed provider authentication without leaking details", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenHiggsfieldAction({ env: readyEnv, userId: owner, action: "status", requestId: "../secret", fetchImpl: async () => { calls++; return jsonResponse({}); } }),
    error => error.code === "OPEN_HIGGSFIELD_REQUEST_ID_INVALID"
  );
  const failed = await runOpenHiggsfieldAction({
    env: readyEnv, userId: owner, action: "status", requestId: "req_123",
    fetchImpl: async () => jsonResponse({ detail: "bad key test-id:secret-value-123456" }, 401)
  }).catch(error => error);
  assert.equal(failed.code, "OPEN_HIGGSFIELD_AUTH_FAILED");
  assert.doesNotMatch(failed.message, /secret-value|test-id/);
  assert.equal(calls, 0);
});
