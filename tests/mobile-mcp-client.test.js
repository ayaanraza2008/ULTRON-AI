import test from "node:test";
import assert from "node:assert/strict";
import { MobileMcpClient } from "../mobile/mobile-mcp-client.js";

test("MobileMcpClient: enforces telemetry disabled environment variable", () => {
  const client = new MobileMcpClient();
  const env = client.buildEnvironment({ CUSTOM_TEST: "true" });

  assert.equal(env.MOBILEMCP_DISABLE_TELEMETRY, "1", "Telemetry must be explicitly disabled");
  assert.equal(env.MOBILEMCP_LEGACY_ROBOT, "1", "Legacy robot must be set for Windows stability");
  assert.equal(env.CUSTOM_TEST, "true");
});

test("MobileMcpClient: formats JSON-RPC 2.0 requests correctly", () => {
  const client = new MobileMcpClient();

  const req1 = client.buildJsonRpcRequest("initialize", { protocolVersion: "2024-11-05" }, 1);
  assert.equal(req1.jsonrpc, "2.0");
  assert.equal(req1.id, 1);
  assert.equal(req1.method, "initialize");
  assert.equal(req1.params.protocolVersion, "2024-11-05");

  const req2 = client.buildJsonRpcRequest("tools/call", { name: "mobile_list_available_devices", arguments: {} }, 2);
  assert.equal(req2.jsonrpc, "2.0");
  assert.equal(req2.id, 2);
  assert.equal(req2.method, "tools/call");
  assert.equal(req2.params.name, "mobile_list_available_devices");
});

test("MobileMcpClient: unpackages tool responses for both text and base64 image content", () => {
  const client = new MobileMcpClient();

  // 1. Text response
  const textRpcResult = {
    content: [
      { type: "text", text: "emulator-5554 (device)" }
    ]
  };
  const unwrappedText = client.unwrapToolResponse(textRpcResult);
  assert.equal(unwrappedText.success, true);
  assert.equal(unwrappedText.text, "emulator-5554 (device)");

  // 2. Image response (PNG base64)
  const imageRpcResult = {
    content: [
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
    ]
  };
  const unwrappedImage = client.unwrapToolResponse(imageRpcResult);
  assert.equal(unwrappedImage.success, true);
  assert.equal(unwrappedImage.mimeType, "image/png");
  assert.ok(unwrappedImage.data.startsWith("iVBORw0KGgo"));

  // 3. Error response
  const errRpcResult = {
    isError: true,
    content: [{ type: "text", text: "Device not found" }]
  };
  const unwrappedErr = client.unwrapToolResponse(errRpcResult);
  assert.equal(unwrappedErr.success, false);
  assert.equal(unwrappedErr.error, "Device not found");
});

test("MobileMcpClient: switches between STDIO and Streamable HTTP transports", () => {
  const stdioClient = new MobileMcpClient({ transport: "stdio" });
  assert.equal(stdioClient.transport, "stdio");

  const httpClient = new MobileMcpClient({
    transport: "http",
    httpUrl: "http://127.0.0.1:8080/mcp",
    authToken: "secret-token-xyz"
  });
  assert.equal(httpClient.transport, "http");
  assert.equal(httpClient.httpUrl, "http://127.0.0.1:8080/mcp");
  assert.equal(httpClient.authToken, "secret-token-xyz");
});

test("MobileMcpClient: graceful fallback to AdbBridge when MCP subprocess is inactive", async () => {
  const fakeAdbBridge = {
    listDevices: async () => ({ success: true, devices: [{ id: "mock-android-device", state: "device" }] })
  };
  const client = new MobileMcpClient({
    adbBridge: fakeAdbBridge,
    enableFallbackToAdb: true
  });

  const res = await client.listDevices();
  assert.ok(res, "Result must not be null");
  assert.equal(res.success, true);
  assert.equal(res.fallback, true);
  assert.ok(res.text.includes("devices"));
});
