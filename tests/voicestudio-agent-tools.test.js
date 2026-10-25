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

test("ULTRON autonomously lists VoiceStudio voices and passes the bounded catalog back to the model", async () => {
  let modelCalls = 0;
  let voiceCalls = 0;
  await withServer({
    OPENROUTER_API_KEY: "test-only",
    VOICESTUDIO_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "private-token"
  }, async (url, options) => {
    if (url === "https://voice.example/v1/audio/voices") {
      voiceCalls += 1;
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer private-token");
      return new Response(JSON.stringify({ voices: [
        { voice_id: "voice-hindi-01", name: "Hindi Natural", language: "hi" },
        { id: "voice-en-01", name: "English Clear", language: "en" }
      ] }));
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    assert.ok(body.tools.some(tool => tool.function.name === "list_speech_voices"));
    if (modelCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
        { id: "call-voices", type: "function", function: { name: "list_speech_voices", arguments: "{}" } }
      ] } }] }));
    }
    assert.ok(body.messages.some(message => message.role === "tool" && String(message.content).includes("Hindi Natural")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "VoiceStudio has Hindi Natural and English Clear available." } }] }));
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "List available VoiceStudio voices" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Hindi Natural/);
    assert.equal(body.toolsUsed.some(tool => tool.name === "list_speech_voices" && tool.ok), true);
    assert.equal(body.toolResults.some(tool => tool.result?.voices?.length === 2), true);
    assert.equal(voiceCalls, 1);
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes("private-token"), false);
  });
});
