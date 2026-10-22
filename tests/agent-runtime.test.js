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

test("agent route rejects an empty prompt without calling a provider", async () => {
  let called = false;
  await withServer({}, async () => { called = true; throw new Error("unexpected provider call"); }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "AGENT_PROMPT_REQUIRED");
    assert.equal(called, false);
  });
});

test("agent automatically checks integration readiness when a free model omits tool calls", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", OPENROUTER_DEFAULT_MODEL: "openrouter/free", COMFYUI_BASE_URL: "https://comfy.example" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      const body = JSON.parse(options.body);
      assert.ok(Array.isArray(body.tools));
      return new Response(JSON.stringify({ model: "mock-model", choices: [{ message: { role: "assistant", content: "Checking available tools." } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ model: "mock-model", choices: [{ message: { role: "assistant", content: "ComfyUI is configured; connectivity still needs a live check." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Check integration status and available tools" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolsUsed[0].name, "check_integrations");
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.integrations.find(x => x.id === "comfyui").configured, true);
    assert.equal(JSON.stringify(body).includes("test-only"), false);
    assert.equal(providerCalls, 2);
  });
});

test("agent tool execution fails closed for invalid employee roles", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    providerCalls += 1;
    const body = JSON.parse(options.body);
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "plan_employee", arguments: JSON.stringify({ role: "root-admin", goal: "Do something", mode: "plan" }) } }] } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "That role is not allowed." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Make an employee plan" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].ok, false);
    assert.equal(body.toolResults[0].result.error.code, "INVALID_EMPLOYEE_TASK");
  });
});
