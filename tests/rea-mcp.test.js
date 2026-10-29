import test from "node:test";
import assert from "node:assert/strict";
import { getReaReadiness, runReaTool } from "../integrations/rea-mcp.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
function readyEnv(overrides = {}) {
  return {
    REA_MCP_ENABLED: "true", REA_MCP_URL: "https://rea.example.com/mcp",
    REA_MCP_TOKEN: "synthetic-rea-token", REA_ANALYSIS_ROOT: "/srv/rea/targets",
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, ...overrides
  };
}
function fakeReaFetch({ output, calls = [], failTool = false } = {}) {
  return async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push({ url, options, payload });
    if (options.redirect !== "error") throw new Error("redirects must be disabled");
    if (payload.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {
        protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "rea", version: "test" }
      } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "rea-session-test" } });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "rea-session-test" } });
    if (payload.method === "tools/call") {
      const result = failTool && !["open_binary", "close_binary"].includes(payload.params.name)
        ? { isError: true, content: [{ type: "text", text: "sensitive internal detail" }] }
        : { structuredContent: output || { evidence: { operation: payload.params.name } }, content: [{ type: "text", text: "REA analysis completed." }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), { status: 200, headers: {
        "Content-Type": "application/json", "Mcp-Session-Id": "rea-session-test"
      } });
    }
    throw new Error("Unexpected MCP method " + payload.method);
  };
}

test("REA is disabled by default and readiness never contacts upstream", () => {
  const result = getReaReadiness({});
  assert.equal(result.state, "disabled");
  assert.equal(result.configured, false);
  assert.equal(JSON.stringify(result).includes("synthetic-rea-token"), false);
});
test("REA readiness requires endpoint, root, owner, and remote gateway token", () => {
  assert.equal(getReaReadiness(readyEnv()).state, "configured_unverified");
  assert.equal(getReaReadiness(readyEnv({ REA_MCP_TOKEN: "" })).configured, false);
  assert.equal(getReaReadiness(readyEnv({ REA_ANALYSIS_ROOT: "targets" })).configured, false);
  assert.equal(getReaReadiness(readyEnv({ REA_MCP_URL: "http://rea.example.com/mcp" })).configured, false);
  assert.equal(getReaReadiness(readyEnv({ REA_MCP_URL: "https://rea.example.com:8080/mcp" })).configured, false);
  assert.equal(getReaReadiness(readyEnv({ REA_MCP_URL: "https://rea.example.com/not-mcp" })).configured, false);
});
test("REA allows loopback HTTP without a remote gateway token", () => {
  const result = getReaReadiness(readyEnv({ REA_MCP_URL: "http://127.0.0.1:8765/mcp", REA_MCP_TOKEN: "" }));
  assert.equal(result.configured, true);
  assert.equal(result.remoteGatewayTokenConfigured, null);
});
test("REA blocks non-owner calls before opening an MCP session", async () => {
  let called = false;
  const result = await runReaTool({
    env: readyEnv(), userId: "00000000-0000-4000-8000-000000000002",
    toolName: "rea_analyze_application", path: "demo.asar",
    fetchImpl: async () => { called = true; throw new Error("must not be called"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_OWNER_ONLY");
  assert.equal(called, false);
});
test("REA refuses traversal, absolute paths, and backslashes before calling MCP", async () => {
  for (const path of ["../outside", "app/../../outside", "/etc/passwd", "C:/Windows/win.ini", "app\\main.js", "./app"]) {
    let called = false;
    const result = await runReaTool({ env: readyEnv(), userId: ownerId, toolName: "rea_analyze_application", path,
      fetchImpl: async () => { called = true; throw new Error("must not be called"); } });
    assert.equal(result.state, "blocked", path);
    assert.equal(result.error.code, "REA_PATH_OUTSIDE_ROOT", path);
    assert.equal(called, false, path);
  }
});
test("REA calls the allowlisted analysis tool with a rooted relative path", async () => {
  const calls = [];
  const result = await runReaTool({
    env: readyEnv(), userId: ownerId, toolName: "rea_analyze_application", path: "demo-app/app.asar",
    fetchImpl: fakeReaFetch({ calls, output: { normalized_result: { graph: { nodes: [] } }, evidence_id: "ev_test" } })
  });
  assert.equal(result.state, "completed");
  assert.equal(result.upstreamTool, "analyze_javascript_application");
  assert.equal(result.contentUntrusted, true);
  const openCall = calls.find(call => call.payload.method === "tools/call" && call.payload.params.name === "open_binary");
  const toolCall = calls.find(call => call.payload.method === "tools/call" && call.payload.params.name === "analyze_javascript_application");
  assert.deepEqual(openCall.payload.params.arguments, { path: "/srv/rea/targets/demo-app/app.asar" });
  assert.deepEqual(toolCall.payload.params.arguments, { input_path: "/srv/rea/targets/demo-app/app.asar", format: "auto", integrity_policy: "fail", detail: "complete" });
  assert.deepEqual(calls.filter(call => call.payload.method === "tools/call").map(call => call.payload.params.name), ["open_binary", "analyze_javascript_application", "close_binary"]);
  assert.equal(toolCall.options.headers.Authorization, "Bearer synthetic-rea-token");
  assert.equal(toolCall.options.headers["Mcp-Session-Id"], "rea-session-test");
  assert.equal(toolCall.options.headers["Mcp-Protocol-Version"], "2025-03-26");
  assert.equal(JSON.stringify(result).includes("synthetic-rea-token"), false);
});
test("REA routes static ELF, WASM and firmware tools to their specific upstream operations", async () => {
  const cases = [
    ["rea_inspect_binary_layout", "app/program.elf", "inspect_binary_layout", { path: "/srv/rea/targets/app/program.elf", detail: "complete" }],
    ["rea_inspect_artifact", "app/package.zip", "inspect_artifact", { detail: "complete" }],
    ["rea_inspect_wasm_artifact", "app/module.wasm", "inspect_wasm_artifact", { path: "/srv/rea/targets/app/module.wasm", glue_paths: [], candidate_paths: [], detail: "complete" }],
    ["rea_inspect_firmware_regions", "firmware/router.bin", "inspect_firmware_regions", { path: "/srv/rea/targets/firmware/router.bin" }]
  ];
  for (const [toolName, path, upstreamName, expectedArgs] of cases) {
    const calls = [];
    const result = await runReaTool({ env: readyEnv(), userId: ownerId, toolName, path, fetchImpl: fakeReaFetch({ calls }) });
    assert.equal(result.state, "completed", toolName);
    const toolCall = calls.find(call => call.payload.method === "tools/call" && call.payload.params.name === upstreamName);
    assert.ok(toolCall, toolName);
    if (["rea_inspect_artifact", "rea_inspect_wasm_artifact"].includes(toolName)) {
      assert.equal(calls.some(call => call.payload.method === "tools/call" && call.payload.params.name === "open_binary"), true, toolName);
    }
    if (["rea_inspect_artifact", "rea_inspect_wasm_artifact"].includes(toolName)) {
      assert.equal(calls.some(call => call.payload.method === "tools/call" && call.payload.params.name === "close_binary"), true, toolName);
    }
    assert.deepEqual(toolCall.payload.params.arguments, expectedArgs, toolName);
  }
});

test("REA network capture inspection is offline, bounded and validates format and redactions", async () => {
  const calls = [];
  const result = await runReaTool({
    env: readyEnv(), userId: ownerId, toolName: "rea_inspect_web_network_capture",
    path: "captures/session.har", format: "har", recordOrdinals: [0, 2], sensitiveValues: ["session-secret"],
    fetchImpl: fakeReaFetch({ calls, output: { records: [], notice: "offline capture inspection" } })
  });
  assert.equal(result.state, "completed");
  const toolCall = calls.find(call => call.payload.method === "tools/call");
  assert.equal(toolCall.payload.params.name, "inspect_web_network_capture");
  assert.deepEqual(toolCall.payload.params.arguments, {
    capture_path: "/srv/rea/targets/captures/session.har", format: "har", detail: "complete",
    sensitive_values: ["session-secret"], record_ordinals: [0, 2]
  });
  for (const bad of [
    { format: "pcap" }, { format: "har", recordOrdinals: [] }, { format: "har", sensitiveValues: Array(21).fill("x") }
  ]) {
    const denied = await runReaTool({ env: readyEnv(), userId: ownerId, toolName: "rea_inspect_web_network_capture",
      path: "captures/session.har", ...bad, fetchImpl: async () => { throw new Error("must not reach upstream"); } });
    assert.equal(denied.state, "blocked");
  }
});

test("REA sends only guidance arguments for non-filesystem guidance tools", async () => {
  const calls = [];
  const result = await runReaTool({ env: readyEnv(), userId: ownerId, toolName: "rea_search_guidance",
    query: "JavaScript module graph", fetchImpl: fakeReaFetch({ calls, output: { sections: [{ title: "JS graph" }] } }) });
  assert.equal(result.state, "completed");
  const toolCall = calls.find(call => call.payload.method === "tools/call");
  assert.equal(toolCall.payload.params.name, "search_guidance");
  assert.deepEqual(toolCall.payload.params.arguments, { query: "JavaScript module graph" });
});
test("REA never forwards an unknown MCP tool name", async () => {
  let called = false;
  const result = await runReaTool({ env: readyEnv(), userId: ownerId, toolName: "execute_shell_command",
    fetchImpl: async () => { called = true; throw new Error("must not be called"); } });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "REA_TOOL_NOT_ALLOWED");
  assert.equal(called, false);
});
test("REA tool errors are sanitized", async () => {
  const result = await runReaTool({ env: readyEnv(), userId: ownerId, toolName: "rea_inspect_artifact",
    path: "bundle.zip", fetchImpl: fakeReaFetch({ failTool: true }) });
  assert.equal(result.state, "failed");
  assert.equal(result.error.code, "REA_MCP_TOOL_ERROR");
  assert.equal(JSON.stringify(result).includes("sensitive internal detail"), false);
});


test("REA analyzes and traces a requested application feature within one MCP session", async () => {
  const calls = [];
  const applicationEvidence = {
    evidence_id: "ev_app_test",
    normalized_result: { application_graph: { nodes: [{ id: "search", label: "search-result" }] } }
  };
  const result = await runReaTool({
    env: readyEnv(), userId: ownerId, toolName: "rea_investigate_application_feature",
    path: "demo-app/app.asar", seed: "search results",
    fetchImpl: fakeReaFetch({ calls, output: applicationEvidence })
  });
  assert.equal(result.state, "completed");
  assert.equal(result.upstreamTool, "trace_application_feature");
  assert.equal(result.result.applicationEvidenceId, "ev_app_test");
  const toolCalls = calls.filter(call => call.payload.method === "tools/call");
  assert.deepEqual(toolCalls.map(call => call.payload.params.name), [
    "open_binary", "analyze_javascript_application", "trace_application_feature", "close_binary"
  ]);
  const analyze = toolCalls.find(call => call.payload.params.name === "analyze_javascript_application");
  assert.deepEqual(analyze.payload.params.arguments, {
    input_path: "/srv/rea/targets/demo-app/app.asar", format: "auto", integrity_policy: "fail", detail: "complete"
  });
  const trace = toolCalls.find(call => call.payload.params.name === "trace_application_feature");
  assert.deepEqual(trace.payload.params.arguments, {
    application: applicationEvidence, seed: { kind: "string", value: "search results" }, direction: "both"
  });
});

test("REA feature tracing requires a meaningful feature seed before contacting upstream", async () => {
  let called = false;
  const result = await runReaTool({
    env: readyEnv(), userId: ownerId, toolName: "rea_investigate_application_feature",
    path: "demo-app/app.asar", seed: " ",
    fetchImpl: async () => { called = true; throw new Error("must not be called"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "REA_FEATURE_SEED_REQUIRED");
  assert.equal(called, false);
});

test("REA native-code inspection allows only explicit read-only objdump operations", async () => {
  const calls = [];
  const result = await runReaTool({
    env: readyEnv(), userId: ownerId, toolName: "rea_inspect_native_code",
    path: "app/program.elf", operation: "disassemble", symbol: "main",
    fetchImpl: fakeReaFetch({ calls, output: { operation: "disassemble", output: "main: ..." } })
  });
  assert.equal(result.state, "completed");
  const toolCalls = calls.filter(call => call.payload.method === "tools/call");
  assert.deepEqual(toolCalls.map(call => call.payload.params.name), ["inspect_with_objdump"]);
  assert.deepEqual(toolCalls[0].payload.params.arguments, {
    path: "/srv/rea/targets/app/program.elf", operation: "disassemble", symbol: "main"
  });
});

test("REA native-code inspection rejects arbitrary operations and invalid symbol selectors", async () => {
  for (const input of [
    { operation: "execute_shell_command" },
    { operation: "symbols", symbol: "main" },
    { operation: "disassemble", symbol: "bad\u0000symbol" }
  ]) {
    let called = false;
    const result = await runReaTool({
      env: readyEnv(), userId: ownerId, toolName: "rea_inspect_native_code",
      path: "app/program.elf", ...input,
      fetchImpl: async () => { called = true; throw new Error("must not be called"); }
    });
    assert.equal(result.state, "blocked");
    assert.equal(called, false);
  }
});
