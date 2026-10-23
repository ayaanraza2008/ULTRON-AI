import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("ULTRON uses VoiceStudio to preview a requested voice description without saving a profile", async () => {
  let modelCalls = 0;
  let describeCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", VOICESTUDIO_BASE_URL: "https://voice.example", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    if (url === "https://voice.example/design/describe") {
      describeCalls += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.deepEqual(JSON.parse(options.body), { description: "deep male voice with Indian accent" });
      return new Response(JSON.stringify({
        attrs: { Gender: "male", Pitch: "low", EnglishAccent: "indian" },
        instruct: "male, low pitch, indian accent",
        matched: [{ category: "Gender", token: "male" }, { category: "Pitch", token: "low" }],
        unmatched: []
      }));
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    assert.ok(body.tools.some(tool => tool.function.name === "describe_speech_voice"));
    if (modelCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
        { id: "call-describe", type: "function", function: { name: "describe_speech_voice", arguments: JSON.stringify({ description: "deep male voice with Indian accent" }) } }
      ] } }] }));
    }
    assert.ok(body.messages.some(message => message.role === "tool" && String(message.content).includes("indian accent")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Voice preview: male, low pitch, Indian accent. Nothing was saved." } }] }));
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Describe a deep male voice with Indian accent" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Indian accent/);
    assert.equal(body.toolsUsed.some(tool => tool.name === "describe_speech_voice" && tool.ok), true);
    assert.equal(body.toolResults.some(tool => tool.result?.attrs?.Gender === "male"), true);
    assert.equal(describeCalls, 1);
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes("private-token"), false);
  });
});
