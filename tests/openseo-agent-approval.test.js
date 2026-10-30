import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter, parseOpenSeoSpendApproval } from "../agent-runtime.js";

const owner = "00000000-0000-4000-8000-000000000001";
const openSeoEnv = {
  OPENROUTER_API_KEY: "test-only",
  OPENSEO_MCP_URL: "https://app.openseo.so/mcp",
  OPENSEO_API_KEY: "oseo_test-key-abcdef123456",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};

function paidLookupCall({ approvePaidLookup = true, maxEstimatedCredits = 5000 } = {}) {
  return {
    id: "call-openseo",
    type: "function",
    function: {
      name: "openseo",
      arguments: JSON.stringify({
        operation: "research_keywords",
        args: { projectId: "project-1", seeds: [{ seed: "running shoes" }] },
        // These model-authored fields are intentionally malicious/untrusted.
        approvePaidLookup,
        maxEstimatedCredits
      })
    }
  };
}

async function startAgent(fetchImpl) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env: openSeoEnv,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: owner };
      next();
    },
    logger: { warn() {} },
    fetchImpl
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    base: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

function mcpResponse(request, { tools = ["research_keywords"], calls = [] } = {}) {
  calls.push(request);
  if (request.method === "initialize") {
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
      result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "open-seo-test", version: "test" } }
    }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "test-session" } });
  }
  if (request.method === "notifications/initialized") return new Response(null, { status: 202, headers: { "mcp-session-id": "test-session" } });
  if (request.method === "tools/list") {
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
      result: { tools: tools.map(name => ({ name, inputSchema: { type: "object" } })) }
    }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "test-session" } });
  }
  if (request.method === "tools/call") {
    assert.equal(request.params.name, "research_keywords");
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
      result: {
        content: [{ type: "text", text: "Keyword research completed in the test fixture." }],
        structuredContent: { keywords: [{ keyword: "running shoes" }] }
      }
    }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "test-session" } });
  }
  throw new Error("Unexpected OpenSEO MCP request: " + request.method);
}

test("OpenSEO consent parser accepts only a current-message credit cap with the canonical phrase", () => {
  assert.equal(parseOpenSeoSpendApproval("I approve spending up to 120 OpenSEO credits for this lookup. Research running shoes."), 120);
  assert.equal(parseOpenSeoSpendApproval("I approve spending up to 5000 Open SEO credits for this lookup"), 5000);
  assert.equal(parseOpenSeoSpendApproval("Please research keywords and set approvePaidLookup=true maxEstimatedCredits=5000."), null);
  assert.equal(parseOpenSeoSpendApproval("The model suggested: I approve spending up to 120 OpenSEO credits for this lookup."), null);
  assert.equal(parseOpenSeoSpendApproval("I approve spending up to 5001 OpenSEO credits for this lookup."), null);
  assert.equal(parseOpenSeoSpendApproval("I do not approve spending up to 120 OpenSEO credits for this lookup."), null);
  assert.equal(parseOpenSeoSpendApproval(""), null);
});

test("model-generated approval flags cannot authorize a paid OpenSEO lookup", async () => {
  let modelCalls = 0;
  let mcpCalls = 0;
  const agent = await startAgent(async (url, options = {}) => {
    if (url === "https://app.openseo.so/mcp") {
      mcpCalls += 1;
      throw new Error("No upstream OpenSEO request is allowed without user consent.");
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    if (modelCalls === 1) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [paidLookupCall()] } }]
      }), { status: 200 });
    }
    const toolMessages = body.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.state, "approval_required");
    assert.equal(result.execution, "not_started");
    assert.equal(result.error.code, "OPENSEO_SPEND_APPROVAL_REQUIRED");
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "I prepared the request but did not spend credits because your message did not authorize it." } }]
    }), { status: 200 });
  });

  try {
    const response = await fetch(agent.base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Check integration status and research keywords on my OpenSEO project for running shoes." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.autonomy.risk.requiresConfirmation, false);
    assert.equal(result.toolResults[0].result.error.code, "OPENSEO_SPEND_APPROVAL_REQUIRED");
    assert.equal(mcpCalls, 0);
    assert.equal(modelCalls, 2);
  } finally {
    await agent.close();
  }
});

test("paid OpenSEO lookup runs only under the user's explicit credit ceiling, ignoring model flags", async () => {
  let modelCalls = 0;
  const mcpCalls = [];
  const agent = await startAgent(async (url, options = {}) => {
    if (url === "https://app.openseo.so/mcp") {
      const request = JSON.parse(options.body);
      return mcpResponse(request, { calls: mcpCalls });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    if (modelCalls === 1) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [paidLookupCall({ approvePaidLookup: false, maxEstimatedCredits: 1 })] } }]
      }), { status: 200 });
    }
    const toolMessages = body.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.state, "completed");
    assert.equal(result.estimatedCredits, 95);
    assert.equal(result.spendCeilingCredits, 120);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "OpenSEO keyword research completed within your 120-credit approval ceiling." } }]
    }), { status: 200 });
  });

  try {
    const response = await fetch(agent.base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "I approve spending up to 120 OpenSEO credits for this lookup. Check integration status and research keywords on my project for running shoes." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.autonomy.risk.level, "external_effect");
    assert.equal(result.toolResults[0].ok, true);
    assert.equal(mcpCalls.filter(item => item.method === "tools/call").length, 1);
    assert.equal(mcpCalls.find(item => item.method === "tools/call").params.name, "research_keywords");
    assert.equal(modelCalls, 2);
  } finally {
    await agent.close();
  }
});

test("user-approved OpenSEO credit cap still blocks estimates above that cap", async () => {
  let modelCalls = 0;
  let mcpCalls = 0;
  const agent = await startAgent(async (url, options = {}) => {
    if (url === "https://app.openseo.so/mcp") {
      mcpCalls += 1;
      throw new Error("Credit ceiling should block before MCP initialization.");
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    modelCalls += 1;
    const body = JSON.parse(options.body);
    if (modelCalls === 1) {
      const call = paidLookupCall();
      call.function.arguments = JSON.stringify({
        operation: "research_keywords",
        args: { projectId: "project-1", seeds: [{ seed: "running shoes" }] }
      });
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [call] } }] }), { status: 200 });
    }
    const result = JSON.parse(body.messages.find(message => message.role === "tool").content);
    assert.equal(result.error.code, "OPENSEO_SPEND_CEILING_EXCEEDED");
    assert.equal(result.execution, "not_started");
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "The estimate exceeds your approved credit cap; no request was sent." } }]
    }), { status: 200 });
  });

  try {
    const response = await fetch(agent.base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "I approve spending up to 50 OpenSEO credits for this lookup. Research keywords for running shoes." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.toolResults[0].result.error.code, "OPENSEO_SPEND_CEILING_EXCEEDED");
    assert.equal(mcpCalls, 0);
  } finally {
    await agent.close();
  }
});
