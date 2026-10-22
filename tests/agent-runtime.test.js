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


test("agent executes a model-selected research tool and passes results back for synthesis", async () => {
  let providerCalls = 0;
  let researchCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, async (url, options) => {
    if (url === "https://api.tavily.com/search") {
      researchCalls += 1;
      assert.equal(JSON.parse(options.body).query, "latest space launch");
      return new Response(JSON.stringify({ answer: "A recent launch was reported.", results: [{ title: "Launch report", url: "https://example.com/launch", content: "Source snippet." }] }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ model: "mock-model", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "research-call", type: "function", function: { name: "research_web", arguments: JSON.stringify({ query: "latest space launch" }) } }] } }] }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    assert.ok(body.messages.some(m => m.role === "tool" && m.tool_call_id === "research-call"));
    return new Response(JSON.stringify({ model: "mock-model", choices: [{ message: { role: "assistant", content: "Here is the sourced summary." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Research latest space launch" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.content, "Here is the sourced summary.");
    assert.deepEqual(body.toolsUsed, [{ name: "research_web", ok: true }]);
    assert.equal(body.toolResults[0].result.results[0].url, "https://example.com/launch");
    assert.equal(researchCalls, 1);
    assert.equal(providerCalls, 2);
  });
});


test("agent tool discovery reports readiness without exposing credentials", async () => {
  await withServer({ OPENROUTER_API_KEY: "secret-provider-value", COMFYUI_BASE_URL: "https://comfy.example", COMFYUI_API_KEY: "secret-comfy-value" }, async () => {
    throw new Error("tool discovery should not make provider calls");
  }, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tools.find(x => x.name === "check_comfyui").available, true);
    assert.equal(JSON.stringify(body).includes("secret-provider-value"), false);
    assert.equal(JSON.stringify(body).includes("secret-comfy-value"), false);
  });
});

test("ComfyUI workflow is not queued until explicit confirmation is supplied", async () => {
  let providerCalls = 0;
  let queueCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", COMFYUI_BASE_URL: "https://comfy.example" }, async (url, options) => {
    if (url === "https://comfy.example/prompt") {
      queueCalls += 1;
      return new Response(JSON.stringify({ prompt_id: "prompt-abc" }), { status: 200 });
    }
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "comfy-call", type: "function", function: { name: "run_comfyui_workflow", arguments: JSON.stringify({ reason: "Generate the requested image" }) } }] } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The workflow needs explicit confirmation." } }] }), { status: 200 });
  }, async base => {
    const workflow = { "1": { class_type: "CheckpointLoaderSimple", inputs: {} } };
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Run this ComfyUI workflow", workflow }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "needs_confirmation");
    assert.equal(queueCalls, 0);
  });
});


test("agent turns a God’s Eye request into an allowlisted browser action without claiming execution", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I can prepare the globe action." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The satellite layer action is ready for the God’s Eye browser." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Show satellites in God’s Eye" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const action = body.toolResults[0].result;
    assert.equal(body.toolResults[0].name, "world_intelligence_command");
    assert.equal(action.action.name, "set_layer_visibility");
    assert.deepEqual(action.action.args, { layerId: "satellites", enabled: true });
    assert.equal(action.execution, "validated_for_globe_client");
    assert.match(action.notice, /not executed by the server/);
  });
});


test("safe integration checks still run when the model provider is unavailable", async () => {
  await withServer({}, async () => { throw new Error("no model or external provider call should be needed"); }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Check integration status and available tools" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolsUsed[0].name, "check_integrations");
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.integrations.length >= 4, true);
  });
});

test("agent retries plain chat when the model rejects function-calling schemas", async () => {
  let calls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (request.tools) return new Response(JSON.stringify({ error: { message: "tools not supported" } }), { status: 400 });
    if (calls === 2) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I will check the integrations." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Integration status checked." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Check integration status and available tools" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolsUsed[0].name, "check_integrations");
    assert.equal(body.content, "Integration status checked.");
    assert.equal(calls, 3);
  });
});


test("agent keeps large speech payloads out of model context but returns them to the client", async () => {
  let providerCalls = 0;
  const audioBase64 = "A".repeat(3000);
  await withServer({ OPENROUTER_API_KEY: "test-only", OMNIVOICE_API_BASE_URL: "https://voice.example", OMNIVOICE_API_KEY: "voice-test", OMNIVOICE_SYNTHESIS_PATH: "/synthesize" }, async (url, options) => {
    if (url === "https://voice.example/synthesize") return new Response(JSON.stringify({ audioBase64, format: "wav" }), { status: 200 });
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "voice-call", type: "function", function: { name: "synthesize_speech", arguments: JSON.stringify({ text: "Hello world" }) } }] } }] }), { status: 200 });
    const body = JSON.parse(options.body);
    const toolMessage = body.messages.find(m => m.role === "tool" && m.tool_call_id === "voice-call");
    assert.ok(toolMessage);
    assert.equal(toolMessage.content.includes(audioBase64), false);
    assert.match(toolMessage.content, /binary payload omitted/);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Speech generated." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Generate speech saying hello world" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.result.audioBase64, audioBase64);
  });
});
