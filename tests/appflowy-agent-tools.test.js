import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const appFlowyToken = "appflowy-agent-test-secret";

async function withServer(env, userId, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, ...env },
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: userId }; next(); },
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("agent tool catalog exposes AppFlowy only to its configured owner and never returns its token", async () => {
  const env = { APPFLOWY_BASE_URL: "https://appflowy.example.com", APPFLOWY_API_TOKEN: appFlowyToken };
  await withServer(env, ownerId, async () => { throw new Error("tool catalog must not call upstream"); }, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    const tool = body.tools.find(item => item.name === "appflowy_workspace");
    assert.equal(tool.available, true);
    assert.equal(tool.state, "configured_unverified");
    assert.equal(JSON.stringify(body).includes(appFlowyToken), false);
  });
  await withServer(env, "other-user", async () => { throw new Error("tool catalog must not call upstream"); }, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    const tool = body.tools.find(item => item.name === "appflowy_workspace");
    assert.equal(tool.available, false);
    assert.equal(tool.state, "owner_only");
    assert.equal(JSON.stringify(body).includes(appFlowyToken), false);
  });
});

test("deterministic agent fallback checks AppFlowy status without contacting upstream", async () => {
  let modelCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: appFlowyToken
  };
  await withServer(env, ownerId, async url => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const answer = modelCalls === 1
      ? "I'll check the AppFlowy connection."
      : "AppFlowy is configured for the owner; the upstream service has not yet been verified.";
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: answer } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Check AppFlowy status" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "check_appflowy" && item.ok));
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes(appFlowyToken), false);
    assert.equal(JSON.stringify(body).includes("provider-test-secret"), false);
  });
});

test("deterministic agent fallback lists AppFlowy workspaces through the authenticated owner connection", async () => {
  let modelCalls = 0;
  let upstreamCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: appFlowyToken
  };
  await withServer(env, ownerId, async (url, options) => {
    if (url === "https://appflowy.example.com/api/v1/workspace/list") {
      upstreamCalls += 1;
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer " + appFlowyToken);
      return new Response(JSON.stringify({ workspaces: [{ id: "workspace-1", name: "ULTRON" }] }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const answer = modelCalls === 1
      ? "I'll list the owner's AppFlowy workspaces."
      : "I found one AppFlowy workspace named ULTRON.";
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: answer } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "List my AppFlowy workspaces" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "appflowy_list_workspaces" && item.ok));
    assert.equal(upstreamCalls, 1);
    assert.equal(modelCalls, 2);
    assert.equal(JSON.stringify(body).includes(appFlowyToken), false);
    assert.equal(JSON.stringify(body).includes("provider-test-secret"), false);
  });
});
