import test from "node:test";
import assert from "node:assert/strict";
import { runVisionProviderSmoke } from "../scripts/vision-provider-smoke.mjs";

const success = (model, content = "ULTRON_VISION_SMOKE_OK") => new Response(JSON.stringify({
  model, choices: [{ message: { content } }]
}), { status: 200, headers: { "content-type": "application/json" } });

const env = extra => ({
  OPENROUTER_API_KEY: "vision-test-secret",
  ULTRON_VISION_MODELS: "qwen/qwen2.5-vl-72b-instruct:free,nvidia/nemotron-nano-12b-v2-vl:free",
  ...extra
});

test("vision smoke sends bounded inline image input and never returns secrets or completion text", async () => {
  let request;
  const report = await runVisionProviderSmoke({
    env: env({}),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer vision-test-secret");
      request = JSON.parse(options.body);
      return success(request.model);
    },
    now: () => "fixed-time"
  });
  assert.equal(report.status, "passed");
  assert.equal(report.imageInputAccepted, true);
  assert.equal(report.model, "qwen/qwen2.5-vl-72b-instruct:free");
  assert.equal(request.messages[1].content[1].type, "image_url");
  assert.match(request.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(report).includes("vision-test-secret"), false);
  assert.equal(JSON.stringify(report).includes("ULTRON_VISION_SMOKE_OK"), false);
});

test("vision smoke falls back after rate limit and tries only configured free vision models", async () => {
  const seen = [];
  const report = await runVisionProviderSmoke({
    env: env({ ULTRON_VISION_MODELS: "paid/model,invalid,first/model:free,first/model:free,second/model:free" }),
    fetchImpl: async (_url, options) => {
      const model = JSON.parse(options.body).model;
      seen.push(model);
      return model === "first/model:free" ? new Response("{}", { status: 429 }) : success(model);
    }
  });
  assert.equal(report.status, "passed");
  assert.deepEqual(seen, ["first/model:free", "second/model:free"]);
  assert.equal(report.attempts[0].code, "RATE_LIMITED");
});

test("vision smoke blocks if no explicitly configured free vision model exists", async () => {
  let called = false;
  const report = await runVisionProviderSmoke({
    env: env({ ULTRON_VISION_MODELS: "provider/paid-model,not-a-model" }),
    fetchImpl: async () => { called = true; return success("unused"); }
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.reason, "FREE_VISION_MODEL_LIST_REQUIRED");
  assert.equal(called, false);
});

test("vision smoke blocks unsafe base URLs before sending the API key", async () => {
  let called = false;
  const report = await runVisionProviderSmoke({
    env: env({ OPENROUTER_BASE_URL: "https://127.0.0.1/v1" }),
    fetchImpl: async () => { called = true; return success("unused"); }
  });
  assert.equal(report.status, "blocked");
  assert.equal(called, false);
});

test("vision smoke never exposes raw provider response text on challenge failure", async () => {
  const privateText = "private provider diagnostic text";
  const report = await runVisionProviderSmoke({
    env: env({ ULTRON_VISION_MODELS: "first/model:free" }),
    fetchImpl: async () => success("first/model:free", privateText)
  });
  assert.equal(report.status, "failed");
  assert.equal(report.attempts[0].code, "UNEXPECTED_COMPLETION");
  assert.equal(JSON.stringify(report).includes(privateText), false);
  assert.equal(JSON.stringify(report).includes("vision-test-secret"), false);
});
