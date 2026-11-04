import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const TOKEN = "appflowy-agent-secret-test-token";

async function withServer(env, userId, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: OWNER, ...env },
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: userId }; next(); },
    logger: { warn() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("AppFlowy agent tools are visible only to the configured owner and never expose the API token", async () => {
  const env = {
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: TOKEN
  };
  const noUpstream = async () => { throw new Error("tool catalog must not contact AppFlowy"); };

  await withServer(env, OWNER, noUpstream, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const name of ["check_appflowy", "appflowy_list_workspaces", "appflowy_get_document"]) {
      assert.equal(body.tools.find(tool => tool.name === name)?.available, true, name);
    }
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });

  await withServer(env, "other-user", noUpstream, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const name of ["check_appflowy", "appflowy_list_workspaces", "appflowy_get_document"]) {
      assert.equal(body.tools.find(tool => tool.name === name)?.available, false, name);
    }
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });
});

test("deterministic agent fallback routes AppFlowy status without contacting the upstream service", async () => {
  let providerCalls = 0;
  let appflowyCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: TOKEN
  };

  await withServer(env, OWNER, async (url, options) => {
    if (url === "https://appflowy.example.com/api/v1/workspace/list") {
      appflowyCalls += 1;
      throw new Error("status checks must not call the AppFlowy API");
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: providerCalls === 1 ? "" : "AppFlowy is configured for the owner account; live workspace access has not yet been tested." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Check AppFlowy status" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "check_appflowy" && item.ok));
    assert.equal(body.toolResults.find(item => item.name === "check_appflowy").result.state, "configured_unverified");
    assert.equal(appflowyCalls, 0);
    assert.equal(providerCalls, 2);
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });
});
