import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function withServer(env, fetchImpl, run, extras = {}) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env, fetchImpl, requireSupabaseUser, supabaseRest: extras.supabaseRest, logger: { warn() {} } }));
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
    assert.equal(calls, 4);
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


test("background employee task is blocked when worker configuration is missing", async () => {
  let databaseWrites = 0;
  const supabaseRest = async (_req, table, method) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    if (table === "memory_items") return [];
    if (method !== "GET") databaseWrites += 1;
    return [];
  };
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.tools) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "employee-call", type: "function", function: { name: "enqueue_employee_task", arguments: JSON.stringify({ role: "web-dev", goal: "Review dependency risks", mode: "review" }) } }] } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Background worker configuration is missing." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Queue a web-dev review in the background" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "blocked");
    assert.equal(databaseWrites, 0);
  }, { supabaseRest });
});
test("confirmed background employee task is stored as a guarded worker task", async () => {
  let providerCalls = 0;
  const databaseCalls = [];
  const supabaseRest = async (_req, table, method, query, body) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    if (table === "memory_items") return [];
    databaseCalls.push({ table, method, query, body });
    if (table === "agent_tasks") return [{ id: "00000000-0000-4000-8000-000000000123", title: body.title, input: body.input, status: body.status, created_at: new Date().toISOString() }];
    return [];
  };
  await withServer({ OPENROUTER_API_KEY: "test-only", ULTRON_EMPLOYEES_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "server-only-test" }, async (_url, options) => {
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "employee-call", type: "function", function: { name: "enqueue_employee_task", arguments: JSON.stringify({ role: "web-dev", goal: "Review dependency risks", mode: "review" }) } }] } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The review task is queued for background processing." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Queue a web-dev review in the background", confirmBackgroundTask: true }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "queued");
    assert.equal(body.toolResults[0].result.execution, "background_draft_only");
    assert.equal(databaseCalls.length, 2);
    assert.equal(databaseCalls[0].table, "agent_tasks");
    assert.equal(databaseCalls[0].body.status, "QUEUED");
    assert.equal(databaseCalls[0].body.input.approved, true);
    assert.equal(databaseCalls[0].body.input.requiresApproval, false);
    assert.equal(databaseCalls[1].table, "audit_events");
  }, { supabaseRest });
});


test("background task intent fallback works when the free model does not support tools", async () => {
  let providerCalls = 0;
  const supabaseRest = async (_req, table, _method, _query, body) => {
    if (table === "agent_tasks") return [{ id: "00000000-0000-4000-8000-000000000456", title: body.title, input: body.input, status: body.status, created_at: new Date().toISOString() }];
    return [];
  };
  await withServer({ OPENROUTER_API_KEY: "test-only", ULTRON_EMPLOYEES_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "server-only-test" }, async (_url, options) => {
    providerCalls += 1;
    const request = JSON.parse(options.body);
    if (request.tools) return new Response(JSON.stringify({ error: { message: "tools unsupported" } }), { status: 400 });
    if (providerCalls === 2) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I cannot call tools in this model." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Queued the confirmed review task." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Queue a web-dev review in the background", confirmBackgroundTask: true }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].name, "enqueue_employee_task");
    assert.equal(body.toolResults[0].result.state, "queued");
    assert.equal(providerCalls, 4);
  }, { supabaseRest });
});


test("ComfyUI asks for the exact workflow before asking the user to confirm compute use", async () => {
  let providerCalls = 0;
  let comfyCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", COMFYUI_BASE_URL: "https://comfy.example" }, async (url, options) => {
    if (url.startsWith("https://comfy.example/")) { comfyCalls += 1; throw new Error("must not queue without workflow"); }
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "comfy-call", type: "function", function: { name: "run_comfyui_workflow", arguments: JSON.stringify({ reason: "Generate an image" }) } }] } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Attach the workflow JSON first." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Run a ComfyUI workflow" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "needs_input");
    assert.deepEqual(body.toolResults[0].result.requiredInputs, ["workflow"]);
    assert.equal(comfyCalls, 0);
  });
});


test("agent automatically uses active user memories when memory is enabled", async () => {
  let capturedMessages = [];
  const supabaseCalls = [];
  const supabaseRest = async (_req, table, method, query) => {
    supabaseCalls.push({ table, method, query });
    if (table === "user_preferences") return [{ memory_enabled: true }];
    if (table === "memory_items") return [{ kind: "preference", title: "Answer style", content: "Prefer concise Hinglish answers." }];
    throw new Error("unexpected table");
  };
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    capturedMessages = JSON.parse(options.body).messages;
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Samajh gaya." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Explain this briefly" }) });
    assert.equal(response.status, 200);
    const memoryMessage = capturedMessages.find(m => m.role === "system" && String(m.content).includes("User-approved memory context"));
    assert.ok(memoryMessage);
    assert.match(memoryMessage.content, /Prefer concise Hinglish answers/);
    assert.deepEqual(supabaseCalls.map(x => x.table), ["user_preferences", "memory_items"]);
  }, { supabaseRest });
});

test("agent respects the user's memory-disabled preference", async () => {
  let memoryItemsRead = false;
  let capturedMessages = [];
  const supabaseRest = async (_req, table) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    if (table === "memory_items") { memoryItemsRead = true; return [{ kind: "preference", title: "Private", content: "Do not inject me." }]; }
    return [];
  };
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    capturedMessages = JSON.parse(options.body).messages;
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Okay." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Hi" }) });
    assert.equal(response.status, 200);
    assert.equal(memoryItemsRead, false);
    assert.equal(capturedMessages.some(m => String(m.content).includes("Do not inject me.")), false);
  }, { supabaseRest });
});


test("agent performs one bounded follow-up tool round and reports both results", async () => {
  let modelCalls = 0;
  const fetchImpl = async (url, options) => {
    if (url === "https://api.tavily.com/search") {
      return new Response(JSON.stringify({ answer: "A recent public source was found.", results: [{ title: "AI agent release notes", url: "https://example.com/agents", content: "Public release notes." }] }), { status: 200 });
    }
    modelCalls += 1;
    const request = JSON.parse(options.body);
    if (modelCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "first-tool", type: "function", function: { name: "check_integrations", arguments: "{}" } }] } }] }), { status: 200 });
    }
    if (modelCalls === 2) {
      assert.ok(request.tools, "follow-up model call should have tools enabled");
      assert.ok(request.messages.some(m => m.role === "tool" && m.tool_call_id === "first-tool"));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "second-tool", type: "function", function: { name: "research_web", arguments: JSON.stringify({ query: "recent AI agent releases" }) } }] } }] }), { status: 200 });
    }
    assert.ok(request.messages.some(m => m.role === "tool" && m.tool_call_id === "second-tool"));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I checked the configured integrations and researched a public source." } }] }), { status: 200 });
  };
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Check integrations and research recent AI agent releases" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolsUsed.length, 2);
    assert.equal(body.toolsUsed[0].name, "check_integrations");
    assert.equal(body.toolsUsed[1].name, "research_web");
    assert.equal(body.toolsUsed[1].ok, true);
    assert.match(body.content, /researched a public source/i);
    assert.equal(modelCalls, 3);
  });
});


test("agent autonomously runs multiple safe tools when model function calling is unavailable", async () => {
  const modelCalls = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      modelCalls.push(JSON.parse(options.body));
      throw new Error("free model endpoint unavailable");
    }
    if (url === "https://api.tavily.com/search") {
      return new Response(JSON.stringify({ answer: "Found public research.", results: [{ title: "Public source", url: "https://example.com/source", content: "Verified public snippet." }] }), { status: 200 });
    }
    throw new Error("unexpected network call: " + url);
  };
  await withServer({ TAVILY_API_KEY: "tavily-test" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Check integrations and research recent AI agent releases" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.toolsUsed.map(x => x.name), ["check_integrations", "research_web"]);
    assert.equal(body.toolResults[1].result.provider, "tavily");
    assert.match(body.content, /research_web/);
    assert.equal(modelCalls.length, 0, "missing provider credentials should fall back before making network calls");
  });
});


test("agent infers generic image-generation requests without requiring the user to name ComfyUI", async () => {
  let providerCalls = 0;
  let comfyCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", COMFYUI_BASE_URL: "https://comfy.example" }, async (url, options) => {
    if (url.startsWith("https://comfy.example/")) { comfyCalls += 1; throw new Error("must not queue without workflow"); }
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I can help create that image." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Attach a ComfyUI API workflow JSON so I can inspect it before asking for compute confirmation." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Create an image of a futuristic city at night" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].name, "run_comfyui_workflow");
    assert.equal(body.toolResults[0].result.state, "needs_input");
    assert.deepEqual(body.toolResults[0].result.requiredInputs, ["workflow"]);
    assert.equal(comfyCalls, 0);
  });
});
