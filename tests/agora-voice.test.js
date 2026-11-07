import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAgoraVoiceRouter, agoraVoiceReadiness } from "../integrations/agora-voice.js";

const env = {
  ULTRON_INTEGRATION_OWNER_USER_ID: "owner-1",
  AGORA_APP_ID: "app-id",
  AGORA_CUSTOMER_ID: "customer",
  AGORA_CUSTOMER_SECRET: "secret",
  AGORA_PIPELINE_ID: "pipeline-1",
  AGORA_DEFAULT_CHANNEL: "ultron-test"
};

async function withServer(handler, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.supabaseUser = { id: req.headers["x-user"] || "owner-1" }; next(); });
  app.use("/api", createAgoraVoiceRouter({ env, requireSupabaseUser: (_req, _res, next) => next(), fetchImpl: handler }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run("http://127.0.0.1:" + server.address().port); } finally { await new Promise(resolve => server.close(resolve)); }
}

test("Agora readiness reports configured but unverified", () => {
  assert.equal(agoraVoiceReadiness(env).configured, true);
  assert.equal(agoraVoiceReadiness({}).configured, false);
});

test("Agora routes reject non-owner accounts", async () => {
  await withServer(async () => { throw new Error("fetch must not be called"); }, async base => {
    const response = await fetch(base + "/api/integrations/agora/start", { method: "POST", headers: { "Content-Type": "application/json", "x-user": "other" }, body: JSON.stringify({ remoteRtcUid: "123" }) });
    assert.equal(response.status, 403);
  });
});

test("Agora starts a saved pipeline with server-side Basic auth", async () => {
  let captured;
  await withServer(async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ agent_id: "agent-instance-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/agora/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remoteRtcUid: "123" }) });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.agentId, "agent-instance-1");
    assert.match(captured.url, /\/join$/);
    assert.match(captured.options.headers.Authorization, /^Basic /);
    assert.equal(JSON.parse(captured.options.body).properties.remote_rtc_uids[0], "123");
  });
});

test("Agora stop only accepts a session started in this process", async () => {
  await withServer(async () => new Response("", { status: 200 }), async base => {
    const response = await fetch(base + "/api/integrations/agora/missing/stop", { method: "POST" });
    assert.equal(response.status, 404);
  });
});
