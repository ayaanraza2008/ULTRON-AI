import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env: { ...env, ULTRON_INTEGRATION_OWNER_USER_ID: env.ULTRON_INTEGRATION_OWNER_USER_ID ?? "00000000-0000-4000-8000-000000000001" }, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("ULTRON designs a synthetic VoiceStudio profile after an explicit request", async () => {
  let modelCalls = 0;
  let describeCalls = 0;
  let createCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    if (url === "https://voice.example/design/describe") {
      describeCalls += 1;
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.deepEqual(JSON.parse(options.body), { description: "deep male voice with Indian accent" });
      return new Response(JSON.stringify({
        attrs: { Gender: "male", Age: "young adult", Pitch: "low", EnglishAccent: "indian", Style: "Auto", ChineseDialect: "Auto" },
        instruct: "male, young adult, low pitch, indian accent",
        matched: [{ category: "Gender", token: "male" }, { category: "Pitch", token: "low" }],
        unmatched: []
      }));
    }
    if (url === "https://voice.example/profiles") {
      createCalls += 1;
      assert.equal(options.method, "POST");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.equal(options.body.get("name"), "Aarav");
      assert.equal(options.body.get("kind"), "design");
      assert.equal(options.body.get("language"), "hi");
      assert.ok(JSON.parse(options.body.get("vd_states")).Gender === "male");
      return new Response(JSON.stringify({ id: "voice-abc123", name: "Aarav", kind: "design" }));
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    assert.ok(body.tools.some(tool => tool.function.name === "design_speech_voice"));
    if (modelCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
        { id: "call-design", type: "function", function: { name: "design_speech_voice", arguments: JSON.stringify({ name: "Aarav", description: "deep male voice with Indian accent", language: "hi" }) } }
      ] } }] }));
    }
    assert.ok(body.messages.some(message => message.role === "tool" && String(message.content).includes("voice-abc123")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Created the synthetic Aarav voice profile." } }] }));
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Design a deep male voice with Indian accent and save it as Aarav" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Aarav/);
    assert.equal(body.toolsUsed.some(tool => tool.name === "design_speech_voice" && tool.ok), true);
    assert.equal(body.toolResults.some(tool => tool.result?.profileId === "voice-abc123"), true);
    assert.equal(describeCalls, 1);
    assert.equal(createCalls, 1);
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes("private-token"), false);
  });
});
