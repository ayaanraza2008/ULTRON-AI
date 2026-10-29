import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { runVisionProviderSmoke } from "../scripts/model-vision-smoke.mjs";

function decodeChallengePng(png) {
  let offset = 8;
  const imageChunks = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (end + 4 > png.length) throw new Error("Malformed PNG chunk");
    if (type === "IDAT") imageChunks.push(png.subarray(offset + 8, end));
    offset = end + 4;
    if (type === "IEND") break;
  }
  return inflateSync(Buffer.concat(imageChunks));
}

const env = {
  ULTRON_CONFIRM_VISION_SMOKE: "YES",
  OPENROUTER_API_KEY: "vision-smoke-secret",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  ULTRON_VISION_MODELS: "openrouter/free,nvidia/nemotron-3.5-lightning:free,openai/gpt-4.1,https://bad.example/model:free"
};
const response = (content, status = 200) => new Response(JSON.stringify({
  choices: [{ message: { role: "assistant", content } }]
}), { status, headers: { "Content-Type": "application/json" } });

test("vision smoke requires explicit confirmation before contacting any provider", async () => {
  let calls = 0;
  const result = await runVisionProviderSmoke({
    env: { ...env, ULTRON_CONFIRM_VISION_SMOKE: "" },
    fetchImpl: async () => { calls += 1; return response("ULTRON_VISION_SMOKE_OK"); }
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "EXPLICIT_CONFIRMATION_REQUIRED");
  assert.equal(calls, 0);
});

test("vision smoke blocks when credentials are missing and rejects paid model IDs", async () => {
  let calls = 0;
  const missingKey = await runVisionProviderSmoke({
    env: { ULTRON_CONFIRM_VISION_SMOKE: "YES" },
    fetchImpl: async () => { calls += 1; return response("ULTRON_VISION_SMOKE_OK"); }
  });
  assert.equal(missingKey.reason, "OPENROUTER_API_KEY_REQUIRED");
  const paidOnly = await runVisionProviderSmoke({
    env: { ...env, ULTRON_VISION_MODELS: "openai/gpt-4.1,anthropic/claude" },
    fetchImpl: async () => { calls += 1; return response("ULTRON_VISION_SMOKE_OK"); }
  });
  assert.equal(paidOnly.reason, "NO_ELIGIBLE_FREE_VISION_MODELS");
  assert.equal(calls, 0);
});

test("vision smoke verifies a real image payload and falls back through free vision models", async () => {
  const seen = [];
  const result = await runVisionProviderSmoke({
    env: { ...env, ULTRON_VISION_MODELS: "openrouter/free,nvidia/nemotron-3.5-lightning:free,openai/gpt-4.1" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer vision-smoke-secret");
      const body = JSON.parse(options.body);
      seen.push(body.model);
      const parts = body.messages[1].content;
      assert.ok(Array.isArray(parts));
      const dataUrl = parts.find(part => part.type === "image_url")?.image_url?.url;
      assert.match(dataUrl, /^data:image\/png;base64,/);
      const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(bytes.readUInt32BE(16), 64);
      assert.equal(bytes.readUInt32BE(20), 64);
      const pixels = decodeChallengePng(bytes);
      assert.equal(pixels.length, 64 * (1 + 64 * 3));
      assert.deepEqual([...pixels.subarray(1, 4)], [255, 0, 0], "leftmost pixel must be red");
      assert.deepEqual([...pixels.subarray(1 + 31 * 3, 1 + 32 * 3)], [255, 0, 0], "left half must be red");
      assert.deepEqual([...pixels.subarray(1 + 32 * 3, 1 + 33 * 3)], [0, 0, 255], "right half must be blue");
      assert.match(body.messages[0].content, /ULTRON_VISION_SMOKE_OK/);
      assert.equal(body.max_tokens, 96);
      assert.equal(body.stream, false);
      if (body.model === "openrouter/free") return new Response("{}", { status: 429 });
      return response("ULTRON_VISION_SMOKE_OK");
    },
    now: () => "fixed-time"
  });
  assert.equal(result.status, "passed");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "nvidia/nemotron-3.5-lightning:free");
  assert.equal(result.challengeVerified, true);
  assert.equal(result.generatedAt, "fixed-time");
  assert.deepEqual(seen, ["openrouter/free", "nvidia/nemotron-3.5-lightning:free"]);
  assert.equal(JSON.stringify(result).includes("vision-smoke-secret"), false);
  assert.equal(JSON.stringify(result).includes("ULTRON_VISION_SMOKE_OK"), false);
  assert.ok(result.attempts.some(attempt => attempt.code === "RATE_LIMITED"));
});

test("vision smoke rejects negative or non-matching challenge output without returning it", async () => {
  const privateOutput = "The left half appears blue, not red. ULTRON_VISION_SMOKE_WRONG";
  const result = await runVisionProviderSmoke({
    env: { ...env, ULTRON_VISION_MODELS: "openrouter/free" },
    fetchImpl: async () => response(privateOutput)
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "ALL_FREE_VISION_MODELS_FAILED");
  assert.equal(result.attempts[0].code, "VISION_CHALLENGE_FAILED");
  assert.equal(JSON.stringify(result).includes(privateOutput), false);
  assert.equal(JSON.stringify(result).includes("vision-smoke-secret"), false);
});

test("vision smoke rejects a provider endpoint outside OpenRouter before sending credentials", async () => {
  let calls = 0;
  const result = await runVisionProviderSmoke({
    env: { ...env, OPENROUTER_BASE_URL: "https://example.com/api/v1" },
    fetchImpl: async () => { calls += 1; return response("ULTRON_VISION_SMOKE_OK"); }
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "OPENROUTER_HOST_REQUIRED");
  assert.equal(calls, 0);
});

test("vision smoke never forwards credentials to private or loopback OpenRouter overrides", async () => {
  for (const baseUrl of ["https://localhost/v1", "https://192.168.1.4/v1", "https://169.254.169.254/v1"]) {
    let calls = 0;
    const result = await runVisionProviderSmoke({
      env: { ...env, OPENROUTER_BASE_URL: baseUrl },
      fetchImpl: async () => { calls += 1; return response("ULTRON_VISION_SMOKE_OK"); }
    });
    assert.equal(result.status, "blocked", baseUrl);
    assert.equal(calls, 0, baseUrl);
    assert.equal(JSON.stringify(result).includes("vision-smoke-secret"), false);
  }
});


test("vision diagnostics identify token-truncated responses without exposing model reasoning", async () => {
  const privateReasoning = "PRIVATE_VISION_REASONING_MUST_NOT_BE_RETURNED";
  const result = await runVisionProviderSmoke({
    env: { ...env, ULTRON_VISION_MODELS: "openrouter/free" },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: null, reasoning: privateReasoning } }]
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts[0].code, "COMPLETION_TRUNCATED");
  assert.equal(result.attempts[0].finishReason, "length");
  assert.equal(result.attempts[0].contentShape, "missing");
  assert.equal(result.attempts[0].reasoningPresent, true);
  assert.equal(JSON.stringify(result).includes(privateReasoning), false);
  assert.equal(JSON.stringify(result).includes("vision-smoke-secret"), false);
});
