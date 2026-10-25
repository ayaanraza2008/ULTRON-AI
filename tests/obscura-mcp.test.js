import test from "node:test";
import assert from "node:assert/strict";
import { inspectPublicPageWithObscura, capturePublicPageWithObscura, getObscuraReadiness } from "../integrations/obscura-mcp.js";

const ownerId = "00000000-0000-4000-8000-000000000001";

test("Obscura is not called until owner guard and endpoint are configured", async () => {
  let calls = 0;
  const result = await inspectPublicPageWithObscura({
    env: {}, userId: ownerId, url: "https://example.com",
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  assert.equal(calls, 0);
  assert.equal(getObscuraReadiness({}).state, "desktop_companion_required");
});

test("Obscura blocks unsafe URL types and private network targets before network access", async () => {
  let calls = 0;
  const env = { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp" };
  const fetchImpl = async () => { calls++; throw new Error("should not call upstream"); };
  for (const url of [
    "http://example.com", "file:///etc/passwd", "javascript:alert(1)",
    "https://127.0.0.1/admin", "https://192.168.1.1/", "https://metadata.google.internal/"
  ]) {
    const result = await inspectPublicPageWithObscura({ env, userId: ownerId, url, fetchImpl });
    assert.equal(result.state, "blocked", url);
    assert.equal(result.error.code, "OBSCURA_TARGET_NOT_PUBLIC_HTTPS", url);
  }
  assert.equal(calls, 0);
});

test("Obscura remote MCP requires an authenticated gateway token", async () => {
  let calls = 0;
  const result = await inspectPublicPageWithObscura({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, OBSCURA_MCP_URL: "https://obscura.example/mcp" },
    userId: ownerId, url: "https://example.com",
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "OBSCURA_GATEWAY_TOKEN_REQUIRED");
  assert.equal(calls, 0);
  assert.equal(getObscuraReadiness({
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    OBSCURA_MCP_URL: "https://obscura.example/mcp"
  }).configured, false);
});

test("Obscura initializes MCP, navigates a public URL and returns a bounded DOM snapshot only", async () => {
  const requests = [];
  const env = { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp" };
  const fetchImpl = async (url, options) => {
    const payload = JSON.parse(options.body);
    requests.push({ url, options, payload });
    if (payload.method === "initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: payload.id,
        result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "obscura", version: "0.1.0" } }
      }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-test" } });
    }
    if (payload.method === "notifications/initialized") {
      return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "session-test" } });
    }
    assert.equal(options.headers["Mcp-Session-Id"], "session-test");
    if (payload.method === "tools/call" && payload.params.name === "browser_navigate") {
      assert.deepEqual(payload.params.arguments, { url: "https://example.com/articles?q=ai", waitUntil: "domcontentloaded" });
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "Navigated to example.com" }] }
      }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-test" } });
    }
    if (payload.method === "tools/call" && payload.params.name === "browser_snapshot") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "Title: Example\nBody: Public page text." }] }
      }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-test" } });
    }
    throw new Error("unexpected MCP request");
  };
  const result = await inspectPublicPageWithObscura({
    env, userId: ownerId, url: "https://example.com/articles?q=ai", fetchImpl
  });
  assert.equal(result.state, "completed");
  assert.equal(result.provider, "obscura");
  assert.equal(result.readOnly, true);
  assert.equal(result.snapshot, "Title: Example\nBody: Public page text.");
  assert.equal(result.contentUntrusted, true);
  assert.equal(result.published, undefined);
  assert.equal(requests.length, 4);
  assert.equal(requests.every(x => x.options.redirect === "error"), true);
  assert.equal(JSON.stringify(result).includes("Mcp-Session-Id"), false);
});

test("Obscura captures bounded screenshots and PDFs through the advertised MCP tools", async () => {
  const env = { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp" };
  for (const format of ["screenshot", "pdf"]) {
    const calls = [];
    const result = await capturePublicPageWithObscura({
      env, userId: ownerId, url: "https://example.com", format,
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload.method === "tools/call" ? payload.params.name : payload.method);
        if (payload.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "obscura", version: "test" } } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-capture" } });
        }
        if (payload.method === "notifications/initialized") return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "session-capture" } });
        if (payload.params.name === "browser_navigate") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "Navigated" }] } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-capture" } });
        const expectedTool = format === "pdf" ? "browser_pdf" : "browser_screenshot";
        assert.equal(payload.params.name, expectedTool);
        const content = format === "pdf"
          ? [{ type: "resource", resource: { uri: "cactus://test/capture.pdf", mimeType: "application/pdf", blob: Buffer.from("%PDF-test").toString("base64") } }]
          : [{ type: "image", mimeType: "image/png", data: Buffer.from("PNG-test").toString("base64") }];
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-capture" } });
      }
    });
    assert.equal(result.state, "completed");
    assert.equal(result.format, undefined);
    assert.equal(result.artifact.format, format);
    assert.equal(result.artifact.encoding, "base64");
    assert.ok(result.artifact.base64.length < 100);
    assert.ok(calls.includes(format === "pdf" ? "browser_pdf" : "browser_screenshot"));
    assert.ok(calls.includes("browser_navigate"));
  }
});

test("Obscura refuses oversized capture artifacts", async () => {
  const env = { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp" };
  let calls = 0;
  const result = await capturePublicPageWithObscura({
    env, userId: ownerId, url: "https://example.com", format: "screenshot",
    fetchImpl: async (_url, options) => {
      calls++;
      const payload = JSON.parse(options.body);
      if (payload.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { capabilities: {}, protocolVersion: "2025-03-26" } }), { status: 200 });
      if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (payload.params.name === "browser_navigate") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "Navigated" }] } }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "image", mimeType: "image/png", data: "A".repeat(850_001) }] } }), { status: 200 });
    }
  });
  assert.equal(result.state, "failed");
  assert.equal(result.error.code, "OBSCURA_ARTIFACT_TOO_LARGE");
  assert.equal(calls, 4);
});

test("Obscura fails safely on MCP errors without leaking response bodies", async () => {
  const env = { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, OBSCURA_MCP_URL: "http://127.0.0.1:8080/mcp" };
  let calls = 0;
  const result = await inspectPublicPageWithObscura({
    env, userId: ownerId, url: "https://example.com",
    fetchImpl: async (_url, options) => {
      calls++;
      const payload = JSON.parse(options.body);
      if (payload.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { capabilities: {}, protocolVersion: "2025-03-26" } }), { status: 200 });
      }
      if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (payload.method === "tools/call") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32000, message: "secret internal stack path" } }), { status: 200 });
      }
      throw new Error("unexpected MCP request");
    }
  });
  assert.equal(result.state, "failed");
  assert.equal(result.provider, "obscura");
  assert.equal(JSON.stringify(result).includes("secret internal stack path"), false);
  assert.equal(calls, 3);
});


test("Obscura refuses private and metadata MCP service endpoints before sending the gateway token", async () => {
  for (const url of [
    "https://192.168.1.10/mcp",
    "https://169.254.169.254/mcp",
    "https://metadata.google.internal/mcp",
    "https://[fd00::1]/mcp",
    "https://[::1]/mcp"
  ]) {
    let called = false;
    const env = {
      ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
      OBSCURA_MCP_URL: url,
      OBSCURA_MCP_TOKEN: "synthetic-token"
    };
    assert.equal(getObscuraReadiness(env).configured, false, url);
    const result = await inspectPublicPageWithObscura({
      env, userId: ownerId, url: "https://example.com",
      fetchImpl: async () => { called = true; throw new Error("Unsafe URL must not be contacted."); }
    });
    assert.equal(result.state, "blocked", url);
    assert.equal(called, false, url);
  }
});
