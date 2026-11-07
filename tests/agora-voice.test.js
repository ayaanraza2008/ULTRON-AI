import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAgoraVoiceRouter, agoraVoiceReadiness } from "../integrations/agora-voice.js";

const env = {
  ULTRON_INTEGRATION_OWNER_USER_ID: "owner-1",
  AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  AGORA_APP_CERTIFICATE: "abcdef0123456789abcdef0123456789",
  AGORA_PIPELINE_ID: "pipeline-1",
  AGORA_DEFAULT_CHANNEL: "ultron-test"
};

async function withServer(handler, run, testEnv = env) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.supabaseUser = { id: req.headers["x-user"] || "owner-1" }; next(); });
  app.use("/api", createAgoraVoiceRouter({ env: testEnv, requireSupabaseUser: (_req, _res, next) => next(), fetchImpl: handler }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("Agora readiness requires a valid App ID, App Certificate, and published pipeline", () => {
  assert.equal(agoraVoiceReadiness(env).configured, true);
  assert.equal(agoraVoiceReadiness({}).configured, false);
  assert.equal(agoraVoiceReadiness({ ...env, AGORA_APP_CERTIFICATE: "" }).configured, false);
  assert.equal(agoraVoiceReadiness({ ...env, AGORA_APP_ID: "not-an-app-id" }).configured, false);
});

test("Agora routes reject non-owner accounts before contacting provider", async () => {
  await withServer(async () => { throw new Error("fetch must not be called"); }, async base => {
    const response = await fetch(base + "/api/integrations/agora/start", {
      method: "POST", headers: { "Content-Type": "application/json", "x-user": "other" }, body: "{}"
    });
    assert.equal(response.status, 403);
  });
});

test("Agora refuses to start without a server-side App Certificate", async () => {
  await withServer(async () => { throw new Error("fetch must not be called"); }, async base => {
    const response = await fetch(base + "/api/integrations/agora/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "AGORA_NOT_CONFIGURED");
  }, { ...env, AGORA_APP_CERTIFICATE: "" });
});

test("Agora starts a saved pipeline with generated ConvoAI and client RTC tokens", async () => {
  let captured;
  await withServer(async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ agent_id: "agent-instance-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/agora/start", { method: "POST" });
    assert.equal(response.status, 201);
    const data = await response.json();
    const properties = JSON.parse(captured.options.body).properties;
    assert.equal(data.agentId, "agent-instance-1");
    assert.equal(data.appId, env.AGORA_APP_ID);
    assert.match(data.channel, /^ultron-test-[a-f0-9]{8}$/);
    assert.ok(Number.isInteger(data.rtcUid) && data.rtcUid > 0);
    assert.match(data.rtcToken, /^007/);
    assert.match(properties.token, /^007/);
    assert.equal(properties.agent_rtc_uid, String(Number(properties.agent_rtc_uid)));
    assert.deepEqual(properties.remote_rtc_uids, [String(data.rtcUid)]);
    assert.equal(properties.channel, data.channel);
    assert.equal(captured.url, "https://api.agora.io/api/conversational-ai-agent/v2/projects/" + env.AGORA_APP_ID + "/join");
    assert.equal(captured.options.headers.Authorization, 'agora token="' + properties.token + '"');
    assert.equal(JSON.stringify(data).includes(env.AGORA_APP_CERTIFICATE), false);
    assert.equal(JSON.stringify(data).includes(properties.token), false);
  });
});

test("Agora stops only a session started in this process and reuses its private agent token", async () => {
  const requests = [];
  await withServer(async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ agent_id: "agent-stop-1" }), { status: 200 });
  }, async base => {
    const start = await fetch(base + "/api/integrations/agora/start", { method: "POST" });
    assert.equal(start.status, 201);
    const data = await start.json();
    const stop = await fetch(base + "/api/integrations/agora/" + data.agentId + "/stop", { method: "POST" });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).status, "stopped");
    assert.match(requests[0].options.headers.Authorization, /^agora token="007/);
    assert.equal(requests[1].options.headers.Authorization, requests[0].options.headers.Authorization);
    assert.match(requests[1].url, /\/agents\/agent-stop-1\/leave$/);
  });
});
