import test from "node:test";
import assert from "node:assert/strict";
import { getOpenSeoReadiness, runOpenSeoTool } from "../integrations/openseo-mcp.js";

const owner = "00000000-0000-4000-8000-000000000001";
const readyEnv = {
  OPENSEO_MCP_URL: "https://app.openseo.so/mcp",
  OPENSEO_API_KEY: "oseo_test-key-abcdef123456",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};

function mcpFetchStub({ projectResult = { projects: [] }, tools = ["list_projects"], calls = [] } = {}) {
  return async (url, options) => {
    assert.equal(url, "https://app.openseo.so/mcp");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + readyEnv.OPENSEO_API_KEY);
    const request = JSON.parse(options.body);
    calls.push(request);
    if (request.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
        protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "open-seo-test", version: "test" }
      } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "open-seo-session" } });
    }
    if (request.method === "notifications/initialized") {
      return new Response(null, { status: 202, headers: { "mcp-session-id": "open-seo-session" } });
    }
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: tools.map(name => ({ name, inputSchema: { type: "object" } })) } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "open-seo-session" } });
    }
    if (request.method === "tools/call") {
      assert.equal(request.params.name, "list_projects");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
        content: [{ type: "text", text: "Projects: 0" }],
        structuredContent: projectResult
      } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "open-seo-session" } });
    }
    throw new Error("Unexpected MCP method: " + request.method);
  };
}

test("OpenSEO is optional and readiness never exposes the API key", () => {
  const readiness = getOpenSeoReadiness({});
  assert.equal(readiness.configured, false);
  assert.equal(readiness.state, "optional");

  const configuredReadiness = getOpenSeoReadiness({
    OPENSEO_MCP_URL: readyEnv.OPENSEO_MCP_URL,
    OPENSEO_API_KEY: readyEnv.OPENSEO_API_KEY,
    ULTRON_INTEGRATION_OWNER_USER_ID: owner
  }, owner);
  assert.equal(JSON.stringify(configuredReadiness).includes(readyEnv.OPENSEO_API_KEY), false);
});

test("OpenSEO blocks non-owner and missing key before outbound calls", async () => {
  let calls = 0;
  const nonOwner = await runOpenSeoTool({ env: readyEnv, userId: "00000000-0000-4000-8000-000000000002", operation: "list_projects", fetchImpl: async () => { calls++; throw new Error("unexpected"); } });
  const missing = await runOpenSeoTool({ env: { ...readyEnv, OPENSEO_API_KEY: "" }, userId: owner, operation: "list_projects", fetchImpl: async () => { calls++; throw new Error("unexpected"); } });
  assert.equal(nonOwner.state, "blocked");
  assert.equal(missing.state, "blocked");
  assert.equal(calls, 0);
});

test("OpenSEO free project listing initializes MCP and keeps the credential server-side", async () => {
  const calls = [];
  const result = await runOpenSeoTool({
    env: readyEnv, userId: owner, operation: "list_projects", args: {},
    fetchImpl: mcpFetchStub({ projectResult: { projects: [{ id: "project-1", name: "Example" }] }, calls })
  });
  assert.equal(result.state, "completed");
  assert.equal(result.provider, "open-seo");
  assert.equal(result.structuredContent.projects[0].id, "project-1");
  assert.ok(calls.some(call => call.method === "tools/list"));
  assert.ok(calls.some(call => call.method === "tools/call" && call.params.name === "list_projects"));
  assert.equal(JSON.stringify(result).includes(readyEnv.OPENSEO_API_KEY), false);
});

test("OpenSEO paid keyword lookup is blocked before network until explicit approval and ceiling", async () => {
  let calls = 0;
  const args = { projectId: "project-1", seeds: [{ seed: "running shoes" }] };
  const result = await runOpenSeoTool({
    env: readyEnv, userId: owner, operation: "research_keywords", args,
    fetchImpl: async () => { calls++; throw new Error("must not be called"); }
  });
  assert.equal(result.state, "approval_required");
  assert.equal(result.estimatedCredits, 95);
  assert.equal(calls, 0);
});

test("OpenSEO spend ceiling blocks over-budget lookups before network access", async () => {
  let calls = 0;
  const result = await runOpenSeoTool({
    env: readyEnv, userId: owner, operation: "research_keywords",
    args: { projectId: "project-1", seeds: [{ seed: "running shoes" }] },
    approvePaidLookup: true, maxEstimatedCredits: 50,
    fetchImpl: async () => { calls++; throw new Error("must not be called"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "OPENSEO_SPEND_CEILING_EXCEEDED");
  assert.equal(calls, 0);
});

test("OpenSEO paid lookup requires the current upstream tool to exist", async () => {
  let calls = 0;
  const result = await runOpenSeoTool({
    env: readyEnv, userId: owner, operation: "get_domain_overview",
    args: { projectId: "project-1", domain: "example.com" },
    approvePaidLookup: true, maxEstimatedCredits: 300,
    fetchImpl: async (_url, options) => {
      const req = JSON.parse(options.body); calls++;
      if (req.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } } }), { status: 200, headers: { "content-type": "application/json" } });
      if (req.method === "notifications/initialized") return new Response(null,{status:202});
      if (req.method === "tools/list") return new Response(JSON.stringify({jsonrpc:"2.0",id:req.id,result:{tools:[{name:"list_projects"}]}}),{status:200,headers:{"content-type":"application/json"}});
      throw new Error("tools/call must not be issued");
    }
  });
  assert.equal(result.state, "failed");
  assert.equal(result.error.code, "OPENSEO_TOOL_UNAVAILABLE");
  assert.equal(calls, 3);
});

test("OpenSEO blocks invalid operations, arguments and unsafe endpoints", async () => {
  const badOperation = await runOpenSeoTool({ env: readyEnv, userId: owner, operation: "delete_project", fetchImpl: async () => { throw new Error("unexpected"); } });
  const badArgs = await runOpenSeoTool({ env: readyEnv, userId: owner, operation: "get_project_context", args: {}, fetchImpl: async () => { throw new Error("unexpected"); } });
  const badUrl = getOpenSeoReadiness({ ...readyEnv, OPENSEO_MCP_URL: "http://192.168.1.2/mcp" }, owner);
  assert.equal(badOperation.error.code, "OPENSEO_OPERATION_NOT_SUPPORTED");
  assert.equal(badArgs.state, "blocked");
  assert.equal(badUrl.configured, false);
});
