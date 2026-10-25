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

test("VoiceStudio cloning fails closed without consent in the raw user prompt", async () => {
  let providerCalls = 0;
  let voiceCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", VOICESTUDIO_BASE_URL: "https://voice.example.com", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    if (url === "https://voice.example.com/profiles") { voiceCalls += 1; throw new Error("must not clone without consent"); }
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
      { id: "clone-call", type: "function", function: { name: "clone_speech_voice", arguments: JSON.stringify({ name: "Sample", consentBasis: "speaker_permission" }) } }
    ] } }] }));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I need explicit voice-owner permission before cloning." } }] }));
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Clone this voice from the attached sample", audioBase64: Buffer.alloc(1500, 1).toString("base64"), mimeType: "audio/wav" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "needs_consent");
    assert.equal(voiceCalls, 0);
  });
});

test("VoiceStudio cloning requires supplied audio, creates the profile, and records the consent attestation", async () => {
  let modelCalls = 0;
  let profileCalls = 0;
  let attestationCalls = 0;
  const audioBase64 = Buffer.alloc(1500, 7).toString("base64");
  await withServer({ OPENROUTER_API_KEY: "test-only", VOICESTUDIO_BASE_URL: "https://voice.example.com", VOICESTUDIO_API_KEY: "private-token" }, async (url, options) => {
    if (url === "https://voice.example.com/profiles") {
      profileCalls += 1;
      assert.equal(options.method, "POST");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.equal(options.body.get("name"), "My Voice");
      assert.equal(options.body.get("kind"), "clone");
      assert.equal(options.body.get("ref_text"), "Hello there");
      assert.equal((await options.body.get("ref_audio").arrayBuffer()).byteLength, 1500);
      return new Response(JSON.stringify({ id: "clone_123", name: "My Voice", kind: "clone" }));
    }
    if (url === "https://voice.example.com/profiles/clone_123/attestation") {
      attestationCalls += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.deepEqual(JSON.parse(options.body), { basis: "own_voice" });
      return new Response(JSON.stringify({ id: "clone_123", consent_basis: "own_voice" }));
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    assert.ok(body.tools.some(tool => tool.function.name === "clone_speech_voice"));
    if (modelCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
      { id: "clone-call", type: "function", function: { name: "clone_speech_voice", arguments: JSON.stringify({ name: "My Voice", consentBasis: "own_voice", refText: "Hello there", language: "en" }) } }
    ] } }] }));
    assert.ok(body.messages.some(message => message.role === "tool" && String(message.content).includes("clone_123")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Voice clone created and consent attestation recorded." } }] }));
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Clone my voice from this sample; it is my own voice.", audioBase64, mimeType: "audio/wav" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "completed");
    assert.equal(body.toolResults[0].result.profileId, "clone_123");
    assert.equal(body.toolResults[0].result.consentRecorded, true);
    assert.equal(profileCalls, 1);
    assert.equal(attestationCalls, 1);
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes("private-token"), false);
  });
});
