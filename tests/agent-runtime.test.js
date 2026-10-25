import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter, buildBrowserUseGuidance, normalizeHinglishForRouting, modelSafeResult } from "../agent-runtime.js";

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


test("agent cancels oversized model responses and falls back to the next configured provider", async () => {
  let firstCancelled = false;
  let providerCalls = 0;
  const env = {
    FIRST_KEY: "first-test-key",
    SECOND_KEY: "second-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/api/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/api/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  await withServer(env, async (url) => {
    providerCalls += 1;
    if (url.startsWith("https://first.example/")) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        },
        cancel() { firstCancelled = true; }
      });
      return new Response(stream, { status: 200 });
    }
    assert.equal(url, "https://second.example/api/v1/chat/completions");
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Recovered through the fallback provider." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Give me a short status update" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /fallback provider/);
    assert.equal(providerCalls, 2);
    assert.equal(firstCancelled, true);
  });
});


test("browser bridge requests reject redirects and keep the shared token on the configured bridge", async () => {
  let bridgeCalls = 0;
  let providerCalls = 0;
  await withServer({
    OPENROUTER_API_KEY: "test-only",
    ULTRON_BROWSER_USE_URL: "https://browser.example",
    ULTRON_BROWSER_USE_TOKEN: "bridge-test-token"
  }, async (url, options) => {
    if (url === "https://browser.example/run") {
      bridgeCalls += 1;
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["X-ULTRON-BROWSER-TOKEN"], "bridge-test-token");
      return new Response(JSON.stringify({ status: "completed", result: "Page inspected safely." }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "browser-safe-call", type: "function",
        function: { name: "browser_use", arguments: JSON.stringify({ task: "Open the website and inspect the pricing page" }) }
      }] } }] }), { status: 200 });
    }
    assert.ok(payload.messages.some(message => message.role === "system" && String(message.content).includes("Page inspected safely.")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The pricing page was inspected." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Open the website and inspect the pricing page" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Page inspected safely/i);
    assert.equal(bridgeCalls, 1);
    assert.ok(providerCalls >= 2, "expected the model to be called for tool execution and follow-up");
  });
});

test("agent automatically injects relevant AgentMemory results for continuation tasks", async () => {
  let memoryCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "memory-test-secret" }, async (url, options) => {
    if (url === "https://memory.example/agentmemory/smart-search") {
      memoryCalls += 1;
      assert.equal(JSON.parse(options.body).project, "ultron-ai-user-00000000-0000-4000-8000-000000000001");
      assert.equal(options.headers.Authorization, "Bearer memory-test-secret");
      return new Response(JSON.stringify({ results: [{ title: "Prior architecture", content: "The worker is isolated from the API process." }] }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.ok(body.messages.some(message => message.role === "system" && String(message.content).includes("The worker is isolated from the API process.")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Continuing with the prior architecture." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Continue the previous repository implementation" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /prior architecture/);
    assert.equal(memoryCalls, 1);
  });
});

test("automatically stores high-signal decisions in the existing durable Supabase memory when AgentMemory is not configured", async () => {
  const writes = [];
  const supabaseRest = async (_req, table, method, query, body) => {
    if (table === "user_preferences") return [{ memory_enabled: true }];
    if (table === "memory_items" && method === "GET") return [];
    if (table === "memory_items" && method === "POST") {
      writes.push({ query, body });
      return [{ id: "memory-row-1", ...body }];
    }
    throw new Error("unexpected database operation");
  };
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.tools?.length > 0, true);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Decision noted for future project work." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "We decided: keep the worker isolated from the API process." })
    });
    assert.equal(response.status, 200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.user_id, "00000000-0000-4000-8000-000000000001");
    assert.equal(writes[0].body.kind, "project_fact");
    assert.equal(writes[0].body.source, "conversation_summary");
    assert.match(writes[0].body.content, /worker isolated/);
  }, { supabaseRest });
});

test("AgentMemory readiness is authenticated and does not return memory contents", async () => {
  await withServer({ AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "memory-test-secret" }, async (url, options) => {
    assert.equal(url, "https://memory.example/agentmemory/smart-search");
    assert.equal(options.headers.Authorization, "Bearer memory-test-secret");
    return new Response(JSON.stringify({ results: [{ content: "private memory text" }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/agentmemory?task=Continue%20the%20previous%20repository");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.configured, true);
    assert.equal(body.memoriesReturned, 1);
    assert.equal(JSON.stringify(body).includes("private memory text"), false);
    assert.equal(JSON.stringify(body).includes("memory-test-secret"), false);
  });
});

test("agent route rejects an empty prompt without calling a provider", async () => {
  let called = false;
  await withServer({}, async () => { called = true; throw new Error("unexpected provider call"); }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "AGENT_PROMPT_REQUIRED");
    assert.equal(called, false);
  });
});

test("agent drafts a YouTube production package without pretending to render or publish media", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (providerCalls === 1) {
      assert.ok(payload.tools.some(tool => tool.function?.name === "create_youtube_production_plan"));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "youtube-plan-call", type: "function",
        function: { name: "create_youtube_production_plan", arguments: JSON.stringify({
          topic: "A mysterious abandoned lighthouse with an original story",
          format: "cinematic_mystery", targetSeconds: 120, sceneCount: 12, language: "English"
        }) }
      }] } }] }), { status: 200 });
    }
    if (providerCalls === 2) {
      assert.ok(payload.messages.some(message => message.role === "system" && String(message.content).includes("YouTube production planner")));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({
        topic: "An abandoned lighthouse", format: "cinematic_mystery", durationSeconds: 120,
        titleOptions: ["The Lighthouse That Blinked", "The Keeper Never Left", "A Signal Below the Sea"],
        scenes: Array.from({ length: 12 }, (_, i) => ({ sceneNumber: i + 1, startSeconds: i * 10, durationSeconds: 10, location: "Lighthouse", characters: [], items: ["Lantern"], visualPrompt: "Original cinematic lighthouse shot", narration: "", audioCue: "Wind", transition: "Cut", continuity: "Keep lantern in right hand" })),
        factCheckRequired: false, factCheckItems: [], mediaRightsChecklist: ["Verify all footage rights"],
        publishingGate: "Creator review required before upload"
      }) } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Draft production package prepared. No media was rendered or published." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Create a 2-minute cinematic mystery YouTube video plan about an abandoned lighthouse, with 12 scenes." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "create_youtube_production_plan" && item.ok));
    const result = body.toolResults.find(item => item.name === "create_youtube_production_plan").result;
    assert.equal(result.state, "draft_ready");
    assert.equal(result.structured, true);
    assert.equal(result.plan.scenes.length, 12);
    assert.equal(result.requiresHumanReview, true);
    assert.equal(result.published, false);
    assert.ok(result.stagesNotExecuted.includes("video_assembly"));
    assert.ok(result.stagesNotExecuted.includes("publish"));
    assert.equal(JSON.stringify(body).includes("test-only"), false);
    assert.equal(providerCalls, 3);
  });
});

test("Cactus is tried before cloud models when the local-first provider is configured", async () => {
  let calls = 0;
  await withServer({
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    CACTUS_CONFIDENCE_THRESHOLD: "0.72",
    OPENROUTER_API_KEY: "openrouter-test",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free"
  }, async (url, options) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:8080/v1/chat/completions");
    assert.equal(options.headers.Authorization, undefined);
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "Cactus-Compute/needle");
    return new Response(JSON.stringify({ confidence: 0.93, cloud_handoff: false, choices: [{ message: { role: "assistant", content: "Answered locally by Cactus." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Explain how a local model can help ULTRON." })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /Answered locally by Cactus/);
    assert.equal(calls, 1);
  });
});

test("Cactus low-confidence answers fall back to the next configured provider", async () => {
  const attempts = [];
  await withServer({
    CACTUS_BASE_URL: "http://127.0.0.1:8080/v1",
    CACTUS_MODEL: "Cactus-Compute/needle",
    CACTUS_CONFIDENCE_THRESHOLD: "0.72",
    OPENROUTER_API_KEY: "openrouter-test",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free"
  }, async (url, options) => {
    attempts.push(url);
    if (url === "http://127.0.0.1:8080/v1/chat/completions") {
      return new Response(JSON.stringify({ confidence: 0.21, cloud_handoff: false, choices: [{ message: { role: "assistant", content: "Uncertain local answer." } }] }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer openrouter-test");
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Verified through the configured fallback model." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Summarize why model confidence matters." })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /configured fallback model/);
    assert.deepEqual(attempts, [
      "http://127.0.0.1:8080/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions"
    ]);
  });
});

test("agent automatically routes explicit Obscura requests to a public-page snapshot", async () => {
  const modelCalls = [];
  const mcpCalls = [];
  const env = {
    OPENROUTER_API_KEY: "openrouter-test",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
    OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp"
  };
  await withServer(env, async (url, options) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      modelCalls.push(JSON.parse(options.body));
      if (modelCalls.length === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I will inspect the public page." } }] }), { status: 200 });
      assert.ok(modelCalls[1].messages.some(message => message.role === "tool" && String(message.content).includes("Public product page")));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Obscura read the public product page; no actions were submitted." } }] }), { status: 200 });
    }
    assert.equal(url, "http://127.0.0.1:8080/mcp");
    const payload = JSON.parse(options.body);
    mcpCalls.push(payload.method);
    if (payload.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "obscura", version: "test" } } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-agent" } });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "session-agent" } });
    if (payload.params.name === "browser_navigate") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "Navigation complete" }] } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-agent" } });
    if (payload.params.name === "browser_snapshot") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "Title: Sample\nBody: Public product page; no account information." }] } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-agent" } });
    throw new Error("Unexpected Obscura MCP request");
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Use Obscura to inspect https://example.com." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "obscura_inspect_public_page" && item.ok));
    assert.match(body.content, /Obscura read the public product page/);
    assert.deepEqual(mcpCalls, ["initialize", "notifications/initialized", "tools/call", "tools/call"]);
    assert.equal(JSON.stringify(body).includes("openrouter-test"), false);
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

test("agent can inspect task-matched repository readiness without exposing credentials", async () => {
  let providerCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "test-only",
    CHATWOOT_BASE_URL: "https://chat.example",
    CHATWOOT_API_TOKEN: "private-chat-secret",
    CHATWOOT_ACCOUNT_ID: "12",
    OPENPROJECT_BASE_URL: "https://projects.example",
    OPENPROJECT_API_TOKEN: "private-project-secret",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  };
  await withServer(env, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      const payload = JSON.parse(options.body);
      assert.ok(payload.tools.some(tool => tool.function?.name === "check_repository_capabilities"));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "capability-status-call", type: "function",
        function: { name: "check_repository_capabilities", arguments: JSON.stringify({ task: "Review the Chatwoot support inbox and OpenProject task board" }) }
      }] } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The readiness map identified the relevant connectors; live API verification is still needed." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Check which tools are available for Chatwoot support and OpenProject tasks" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolsUsed[0].name, "check_repository_capabilities");
    assert.equal(body.toolsUsed[0].ok, true);
    const result = body.toolResults[0].result;
    assert.equal(result.repositoryCount, 28);
    assert.ok(result.taskMatches.some(item => item.id === "chatwoot"));
    assert.ok(result.taskMatches.some(item => item.id === "openproject"));
    assert.ok(result.taskMatches.every(item => item.state === "configured_unverified"));
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("private-chat-secret"), false);
    assert.equal(serialized.includes("private-project-secret"), false);
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


test("research tool rejects oversized upstream responses instead of buffering them unbounded", async () => {
  let providerCalls = 0;
  let researchCancelled = false;
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, async (url) => {
    if (url === "https://api.tavily.com/search") {
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
        cancel() { researchCancelled = true; }
      });
      return new Response(stream, { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "research-large-response", type: "function",
        function: { name: "research_web", arguments: JSON.stringify({ query: "recent AI security research" }) }
      }] } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Research provider response was safely rejected." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Research recent AI security research" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolsUsed[0].name, "research_web");
    assert.equal(body.toolsUsed[0].ok, false);
    assert.equal(providerCalls, 2);
    assert.equal(researchCancelled, true);
  });
});


test("agent executes a model-selected research tool and passes results back for synthesis", async () => {
  let providerCalls = 0;
  let researchCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, async (url, options) => {
    if (url === "https://api.tavily.com/search") {
      researchCalls += 1;
      assert.equal(JSON.parse(options.body).query, "latest space launch");
      return new Response(JSON.stringify({ answer: "A recent launch was reported.", results: [{ title: "Launch report", url: "https://example.com/launch", content: "Source snippet." }, { title: "Mapped loopback", url: "http://[::ffff:7f00:1]/admin", content: "Must be rejected." }, { title: "Mapped private address", url: "http://[::ffff:c0a8:101]/", content: "Must be rejected." }] }), { status: 200 });
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
    assert.deepEqual(body.toolResults[0].result.results.map(result => result.url), ["https://example.com/launch"]);
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


test("agent recognizes ordinary read-aloud requests and reports missing voice configuration", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I can read that aloud." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Voice generation is not configured yet." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Read this aloud: Hello world" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].name, "synthesize_speech");
    assert.equal(body.toolResults[0].result.state, "blocked");
    assert.match(body.toolResults[0].result.blocker, /OMNIVOICE_API_BASE_URL/);
  });
});

test("agent routes plain-language website-building requests to the coding tool", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I'll prepare a website implementation draft." } }] }), { status: 200 });
    if (providerCalls === 2) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Use a small Express app with routes and tests." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I prepared a coding draft, not a deployed website." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Build a website for my portfolio" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].name, "coding_assist");
    assert.equal(body.toolResults[0].result.execution, "draft_only");
    assert.match(body.toolResults[0].result.answer, /Express app/);
  });
});


test("autonomous fallback dispatches multiple explicitly requested safe tools without model availability", async () => {
  await withServer({}, async () => { throw new Error("provider should not be called without credentials"); }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Show satellites in God's Eye and read aloud: hello world" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.toolsUsed.map(item => item.name), ["world_intelligence_command", "synthesize_speech"]);
    assert.equal(body.toolResults[0].result.action.name, "set_layer_visibility");
    assert.deepEqual(body.toolResults[0].result.action.args, { layerId: "satellites", enabled: true });
    assert.equal(body.toolResults[0].ok, true);
    assert.equal(body.toolResults[1].ok, true);
    assert.equal(body.toolResults[1].result.state, "blocked");
    assert.match(body.toolResults[1].result.blocker, /OMNIVOICE_API_BASE_URL/);
  });
});

test("autonomous fallback combines research, image generation readiness, and code drafts", async () => {
  let tavilyCalls = 0;
  await withServer({ TAVILY_API_KEY: "tavily-test", COMFYUI_BASE_URL: "https://comfy.example" }, async (url) => {
    if (url === "https://api.tavily.com/search") {
      tavilyCalls += 1;
      return new Response(JSON.stringify({ answer: "Research summary", results: [{ title: "Source", url: "https://example.com", content: "Snippet" }] }), { status: 200 });
    }
    throw new Error("unexpected network call: " + url);
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Research AI agents, create an image of a futuristic city, and build a small website about it" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.toolsUsed.map(item => item.name), ["research_web", "run_comfyui_workflow", "coding_assist"]);
    assert.equal(body.toolResults[0].result.provider, "tavily");
    assert.equal(body.toolResults[1].result.state, "needs_input");
    assert.equal(body.toolResults[2].ok, false, "code generation honestly reports missing model configuration");
    assert.equal(tavilyCalls, 1);
  });
});


test("high-impact user intent blocks tool dispatch until a task-specific approval flow exists", async () => {
  let externalCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    if (body.messages.some(message => message.role === "system" && String(message.content).includes("Summarize the tool results accurately"))) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ULTRON did not send anything because approval is required." } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-risky", type: "function", function: { name: "research_web", arguments: JSON.stringify({ query: "customer email" }) } }] } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Send an email to the customer confirming the order." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.autonomy.risk.level, "external_effect");
    assert.equal(body.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(body.toolResults[0].result.approvalRequired, true);
    assert.equal(externalCalls, 0);
  });
});


test("browser-use readiness explains that the optional bridge is not configured", async () => {
  await withServer({}, async () => { throw new Error("readiness must not call a provider"); }, async base => {
    const response = await fetch(base + "/api/agent/browser-use");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "automatic_task_aware_browser_use");
    assert.equal(body.available, false);
    assert.equal(body.browserRequested, false);
  });
});

test("agent routes interactive website tasks to Browser Use and reports missing bridge", async () => {
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    const isSynthesis = body.messages.some(message => message.role === "system" && String(message.content).includes("Summarize the tool results accurately"));
    if (isSynthesis) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Browser bridge is not configured." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "browser-call", type: "function", function: { name: "browser_use", arguments: JSON.stringify({ task: "Open the website and click the pricing tab", maxSteps: 5 }) } }] } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Open the website and click the pricing tab" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "browser_use"));
    const browserResult = body.toolResults.find(item => item.name === "browser_use");
    assert.equal(browserResult.result.state, "blocked");
    assert.match(browserResult.result.blocker, /Browser Use bridge is not configured/);
  });
});


test("browser intent recognises ordinary visit, URL navigation and page inspection phrasing", () => {
  assert.equal(buildBrowserUseGuidance("Visit the website and inspect the pricing page").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("Go to the URL and check the documentation").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("Navigate to the site and take a screenshot").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("What is the latest news about browser automation?").browserRequested, false);
});


test("diagram requests load a bounded upstream reference as untrusted context", async () => {
  const referenceRequests = [];
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (url, options) => {
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      referenceRequests.push(url);
      return new Response("# Diagram reference\\nUse labeled components and arrows.", { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const request = JSON.parse(options.body);
    assert.ok(request.messages.some(message => message.role === "user" && String(message.content).includes("UNTRUSTED reference data")));
    assert.ok(request.messages.some(message => message.role === "user" && String(message.content).includes("Diagram reference")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I can draft the sequence diagram." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Create a sequence diagram for the login API" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /sequence diagram/i);
    assert.ok(referenceRequests.length >= 1);
    assert.ok(referenceRequests.length <= 3);
  });
});


test("Hinglish command normalization enables deterministic agent tool routing", () => {
  assert.match(normalizeHinglishForRouting("AI agents ke baare mein research karo"), /research/i);
  assert.match(normalizeHinglishForRouting("God's Eye me satellites dikhao"), /show satellites in God's Eye/i);
  assert.match(normalizeHinglishForRouting("image banao"), /create image/i);
  assert.match(normalizeHinglishForRouting("website bana do"), /build website/i);
  assert.match(normalizeHinglishForRouting("is text ko awaaz mein sunao"), /read aloud/i);
  assert.match(normalizeHinglishForRouting("integration status check karo"), /check integration status/i);
});

test("Hinglish normalization preserves the original request text", () => {
  const request = "AI agents ke baare mein research karo";
  const normalized = normalizeHinglishForRouting(request);
  assert.notEqual(normalized, request);
  assert.match(normalized, /AI agents ke baare mein research/i);
});


test("browser guidance recognizes common Hinglish navigation and screenshot requests", () => {
  assert.equal(buildBrowserUseGuidance("website kholo aur pricing tab par click karo").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("site par jao aur screenshot lo").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("website check karo").browserRequested, true);
});

test("model provider registry falls back from OpenRouter rate limits to a configured provider", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "openrouter-test",
    GROQ_API_KEY: "groq-test",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      model: "test-model",
      priority: 1,
      supportsTools: true
    }])
  };
  await withServer(env, async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization, redirect: options.redirect });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return new Response("rate limited", { status: 429 });
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer groq-test");
    return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { role: "assistant", content: "Fallback provider works." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Explain a simple concept without using tools." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Fallback provider works/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].auth, "Bearer openrouter-test");
    assert.equal(calls[1].auth, "Bearer groq-test");
    assert.deepEqual(calls.map(call => call.redirect), ["error", "error"]);
  });
});

test("model provider registry ignores providers with missing keys or insecure URLs", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "openrouter-test",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "missing", baseUrl: "https://api.example.com/v1", apiKeyEnv: "MISSING_KEY", model: "model", priority: 1 },
      { name: "insecure", baseUrl: "http://api.example.com/v1", apiKeyEnv: "INSECURE_KEY", model: "model", priority: 2 }
    ])
  };
  await withServer(env, async (url, options) => {
    calls.push(url);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Primary provider works." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Explain a simple concept without using tools." })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /Primary provider works/);
    assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
  });
});


test("agent autonomously uses VoiceStudio for speech when configured", async () => {
  let modelCalls = 0;
  const audioBytes = Buffer.from("test-wav-audio");
  await withServer({
    OPENROUTER_API_KEY: "test-only",
    VOICESTUDIO_BASE_URL: "https://voice.example",
    VOICESTUDIO_API_KEY: "voice-studio-test-token"
  }, async (url, options) => {
    if (url === "https://voice.example/v1/audio/speech") {
      const body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, "Bearer voice-studio-test-token");
      assert.equal(body.input, "hello ULTRON");
      assert.equal(body.response_format, "wav");
      return new Response(audioBytes, { status: 200, headers: { "content-type": "audio/wav" } });
    }
    modelCalls += 1;
    if (modelCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "voice-studio-call", type: "function",
        function: { name: "synthesize_speech", arguments: JSON.stringify({ text: "hello ULTRON" }) }
      }] } }] }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    const toolMessage = body.messages.find(message => message.role === "tool" && message.tool_call_id === "voice-studio-call");
    assert.ok(toolMessage);
    assert.equal(toolMessage.content.includes(audioBytes.toString("base64")), false);
    assert.match(toolMessage.content, /binary payload omitted/);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "VoiceStudio generated the speech audio." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Generate speech saying hello ULTRON" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /synthesize_speech/i);
    assert.equal(body.toolResults[0].name, "synthesize_speech");
    assert.equal(body.toolResults[0].result.provider, "voicestudio");
    assert.equal(body.toolResults[0].result.audioBase64, audioBytes.toString("base64"));
  });
});


test("research tool filters local, private-network, and credential-bearing source URLs", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, async (url, options) => {
    if (url === "https://api.tavily.com/search") {
      return new Response(JSON.stringify({ results: [
        { title: "Public source", url: "https://example.com/article", content: "public" },
        { title: "Loopback", url: "http://127.0.0.1/admin", content: "local" },
        { title: "Private IPv4", url: "http://192.168.1.10/status", content: "private" },
        { title: "Link local", url: "http://169.254.169.254/latest/meta-data", content: "metadata" },
        { title: "Local hostname", url: "http://printer.local/", content: "local" },
        { title: "Credentials", url: "https://user:password@example.org/private", content: "private" },
        { title: "IPv6 loopback", url: "http://[::1]/", content: "local" }
      ] }), { status: 200 });
    }
    providerCalls += 1;
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
        { id: "research-private-filter", type: "function", function: { name: "research_web", arguments: JSON.stringify({ query: "public sources" }) } }
      ] } }] }), { status: 200 });
    }
    const request = JSON.parse(options.body);
    const toolMessage = request.messages.find(message => message.role === "tool" && message.tool_call_id === "research-private-filter");
    assert.ok(toolMessage);
    const toolResult = JSON.parse(toolMessage.content);
    assert.deepEqual(toolResult.results.map(item => item.url), ["https://example.com/article"]);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Research completed with a public source." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Research public sources" }) });
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 2);
  });
});

test("research tool rejects Teredo and 6to4 IPv6 URLs that can tunnel private IPv4 destinations", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only", TAVILY_API_KEY: "tavily-test" }, async (url, options) => {
    if (url === "https://api.tavily.com/search") {
      return new Response(JSON.stringify({ answer: "Test results", results: [
        { title: "Safe source", url: "https://example.com/report", content: "Public source." },
        { title: "6to4 loopback tunnel", url: "http://[2002:7f00:1::]/", content: "Reject." },
        { title: "Teredo tunnel", url: "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/", content: "Reject." },
        { title: "Reserved IPv6", url: "http://[4000::1]/", content: "Reject." },
        { title: "Outside global-unicast IPv6", url: "http://[1000::1]/", content: "Reject." }
      ] }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
        { id: "research-tunnel-test", type: "function", function: { name: "research_web", arguments: JSON.stringify({ query: "IPv6 tunnel URL validation" }) } }
      ] } }] }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    const tool = body.messages.find(message => message.role === "tool" && message.tool_call_id === "research-tunnel-test");
    assert.ok(tool);
    const result = JSON.parse(tool.content);
    assert.deepEqual(result.results.map(item => item.url), ["https://example.com/report"]);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Filtered sources." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Research IPv6 tunnel URL validation" })
    });
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 2);
  });
});


test("agent rejects provider responses that cannot be safely streamed and continues to the next provider", async () => {
  let firstTextCalls = 0;
  let providerCalls = 0;
  const env = {
    FIRST_KEY: "first-test-key",
    SECOND_KEY: "second-test-key",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example/api/v1", apiKeyEnv: "FIRST_KEY", model: "model-a", priority: 0 },
      { name: "second", baseUrl: "https://second.example/api/v1", apiKeyEnv: "SECOND_KEY", model: "model-b", priority: 1 }
    ])
  };
  await withServer(env, async url => {
    providerCalls += 1;
    if (url.startsWith("https://first.example/")) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: undefined,
        async text() {
          firstTextCalls += 1;
          throw new Error("unbounded text fallback must not be called");
        }
      };
    }
    assert.equal(url, "https://second.example/api/v1/chat/completions");
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Recovered safely." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Give me a short status update" })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /Recovered safely/);
    assert.equal(providerCalls, 2);
    assert.equal(firstTextCalls, 0);
  });
});


test("background research-to-report task is classified as an autonomous report", async () => {
  let providerCalls = 0;
  const databaseCalls = [];
  const supabaseRest = async (_req, table, method, query, body) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    if (table === "memory_items") return [];
    databaseCalls.push({ table, method, query, body });
    if (table === "agent_tasks") return [{ id: "00000000-0000-4000-8000-000000000789", title: body.title, input: body.input, status: body.status, created_at: new Date().toISOString() }];
    return [];
  };
  await withServer({ OPENROUTER_API_KEY: "test-only", ULTRON_EMPLOYEES_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "server-only-test" }, async (_url, options) => {
    providerCalls += 1;
    const request = JSON.parse(options.body);
    if (providerCalls === 1) {
      assert.ok(Array.isArray(request.tools));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "research-report-call", type: "function", function: { name: "enqueue_employee_task", arguments: JSON.stringify({ role: "chief-of-staff", goal: "Research recent AI security tools and write a report with sources and recommendations", mode: "report" }) } }] } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The research-to-report task is queued." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Queue a background research report", confirmBackgroundTask: true })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "queued");
    assert.equal(body.toolResults[0].result.execution, "background_autonomous_research_and_report");
    assert.equal(databaseCalls.length, 2);
    assert.equal(databaseCalls[0].table, "agent_tasks");
    assert.equal(databaseCalls[0].body.input.taskType, "autonomous");
    assert.equal(databaseCalls[0].body.input.mode, "report");
    assert.equal(databaseCalls[0].body.input.requiresApproval, false);
    assert.equal(databaseCalls[1].table, "audit_events");
    assert.equal(providerCalls, 2);
  }, { supabaseRest });
});


test("background employee task queues with a configured alternate model provider and no OpenRouter key", async () => {
  let providerCalls = 0;
  const databaseCalls = [];
  const testUserId = "00000000-0000-4000-8000-000000000001";
  const env = {
    ULTRON_EMPLOYEES_ENABLED: "true",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-secret",
    ALTERNATE_MODEL_KEY: "alternate-model-test-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "alternate", baseUrl: "https://alternate.example/v1", apiKeyEnv: "ALTERNATE_MODEL_KEY", model: "free-model", priority: 10 }
    ])
  };
  const supabaseRest = async (_req, table, method, query, body) => {
    if (table === "user_preferences" && method === "GET") return [{ memory_enabled: false }];
    if (table === "memory_items" && method === "GET") return [];
    databaseCalls.push({ table, method, query, body });
    if (table === "agent_tasks" && method === "POST") {
      return [{ id: "queued-task-alternate-only", title: body.title, input: body.input, status: "QUEUED", created_at: "fixed-time" }];
    }
    if (table === "audit_events" && method === "POST") return [];
    throw new Error("Unexpected Supabase operation");
  };
  await withServer(env, async (url, options) => {
    assert.equal(url, "https://alternate.example/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer alternate-model-test-secret");
    assert.equal(options.redirect, "error");
    providerCalls += 1;
    const request = JSON.parse(options.body);
    if (providerCalls === 1) {
      assert.ok(Array.isArray(request.tools));
      return new Response(JSON.stringify({ choices: [{ message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "enqueue-alt-provider-task",
          type: "function",
          function: { name: "enqueue_employee_task", arguments: JSON.stringify({
            role: "chief-of-staff",
            goal: "Research current AI security risks and write a report with sources and recommendations",
            mode: "report"
          }) }
        }]
      } }] }), { status: 200 });
    }
    assert.ok(request.messages.some(message => message.role === "tool" && message.tool_call_id === "enqueue-alt-provider-task"));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The background research report is queued." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Please queue a background research report with sources." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /report is queued/i);
    assert.equal(body.toolResults[0].name, "enqueue_employee_task");
    assert.equal(body.toolResults[0].result.state, "queued");
    assert.equal(body.toolResults[0].result.task.id, "queued-task-alternate-only");
    assert.equal(body.toolResults[0].result.execution, "background_autonomous_research_and_report");
    const taskWrite = databaseCalls.find(call => call.table === "agent_tasks");
    const auditWrite = databaseCalls.find(call => call.table === "audit_events");
    assert.ok(taskWrite);
    assert.ok(auditWrite);
    assert.equal(taskWrite.body.user_id, testUserId);
    assert.equal(taskWrite.body.input.taskType, "autonomous");
    assert.equal(taskWrite.body.input.mode, "report");
    assert.equal(providerCalls, 2);
    assert.equal(JSON.stringify(body).includes("alternate-model-test-secret"), false);
    assert.equal(JSON.stringify(body).includes("service-role-test-secret"), false);
  }, { supabaseRest });
});


test("agent tool readiness advertises draft and background task features for alternate-only providers", async () => {
  const env = {
    ALTERNATE_MODEL_KEY: "alternate-model-test-secret",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-secret",
    ULTRON_EMPLOYEES_ENABLED: "true",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "alternate", baseUrl: "https://alternate.example/v1", apiKeyEnv: "ALTERNATE_MODEL_KEY", model: "free-model", priority: 10 }
    ])
  };
  await withServer(env, async () => {
    throw new Error("tool readiness must not call a model provider");
  }, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tools.find(item => item.name === "plan_employee").available, true);
    assert.equal(body.tools.find(item => item.name === "coding_assist").available, true);
    assert.equal(body.tools.find(item => item.name === "enqueue_employee_task").available, true);
    assert.equal(JSON.stringify(body).includes("alternate-model-test-secret"), false);
    assert.equal(JSON.stringify(body).includes("service-role-test-secret"), false);
  }, { supabaseRest: async () => [] });
});

test("employee model readiness rejects alternate provider URLs with credentials, query, or fragments", async () => {
  for (const baseUrl of [
    "https://user:password@unsafe.example/v1",
    "https://unsafe.example/v1?token=leaked",
    "https://unsafe.example/v1#fragment"
  ]) {
    const env = {
      ALTERNATE_MODEL_KEY: "alternate-model-test-secret",
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "alternate", baseUrl, apiKeyEnv: "ALTERNATE_MODEL_KEY", model: "free-model" }
      ])
    };
    await withServer(env, async () => {
      throw new Error("invalid provider configuration must be rejected before networking");
    }, async base => {
      const response = await fetch(base + "/api/agent/tools");
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.tools.find(item => item.name === "plan_employee").available, false);
      assert.equal(body.tools.find(item => item.name === "coding_assist").available, false);
      assert.equal(JSON.stringify(body).includes("alternate-model-test-secret"), false);
    });
  }
});

test("browser bridge rejects a configured URL with query parameters before forwarding its token", async () => {
  let bridgeCalls = 0;
  let providerCalls = 0;
  const querySecret = "no-query-token-forwarding";
  await withServer({
    OPENROUTER_API_KEY: "test-only",
    ULTRON_BROWSER_USE_URL: "https://browser.example?token=" + querySecret,
    ULTRON_BROWSER_USE_TOKEN: "bridge-test-token"
  }, async (url, options) => {
    if (url.startsWith("https://browser.example")) {
      bridgeCalls += 1;
      throw new Error("unsafe bridge URL must not be called");
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "browser-invalid-base", type: "function",
        function: { name: "browser_use", arguments: JSON.stringify({ task: "Open the website and inspect the pricing page" }) }
      }] } }] }), { status: 200 });
    }
    assert.ok(payload.messages.some(message => message.role === "tool" && String(message.content).includes("not configured")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Browser bridge was safely blocked." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Open the website and inspect the pricing page" })
    });
    assert.equal(response.status, 200);
    assert.equal(bridgeCalls, 0);
    const body = await response.json();
    assert.match(body.content, /safely blocked/i);
    assert.equal(JSON.stringify(body).includes(querySecret), false);
    assert.ok(providerCalls >= 2);
  });
});


test("model tool results redact credentials before model context", () => {
  const safe = modelSafeResult({
    status: "completed",
    apiKey: "credential-value",
    nested: { access_token: "private-value", title: "safe output" },
    message: "Authorization: Bearer abc.def.ghi and api_key=some-key-value"
  });
  assert.equal(safe.apiKey, "[redacted]");
  assert.equal(safe.nested.access_token, "[redacted]");
  assert.equal(safe.nested.title, "safe output");
  assert.doesNotMatch(JSON.stringify(safe), /credential-value|private-value|abc\.def\.ghi|some-key-value/);
});


test("agent skips semantically duplicate tool calls when argument key order changes", async () => {
  let providerCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (_url, options) => {
    providerCalls += 1;
    const request = JSON.parse(options.body);
    if (providerCalls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "plan-once", type: "function", function: { name: "create_spaceplanner_plan", arguments: JSON.stringify({ request: "Design a small office layout", widthCm: 5000, units: "cm" }) } }] } }] }), { status: 200 });
    }
    if (providerCalls === 2) {
      assert.ok(request.messages.some(message => message.role === "tool"));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "plan-again", type: "function", function: { name: "create_spaceplanner_plan", arguments: JSON.stringify({ units: "cm", request: "Design a small office layout", widthCm: 5000 }) } }] } }] }), { status: 200 });
    }
    assert.ok(request.messages.some(message => message.role === "tool" && String(message.content).includes("DUPLICATE_TOOL_CALL_SKIPPED")));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Duplicate plan generation safely skipped." } }] }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Create a small office floor plan" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Duplicate plan generation safely skipped/);
    assert.equal(body.toolsUsed.length, 2);
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolsUsed[1].ok, false);
    assert.equal(body.toolResults[1].result.error.code, "DUPLICATE_TOOL_CALL_SKIPPED");
    assert.equal(providerCalls, 3);
  });
});
