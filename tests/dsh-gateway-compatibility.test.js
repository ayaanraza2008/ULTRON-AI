import test from "node:test";
import assert from "node:assert/strict";
import {
  startGatewayServer,
  stopGatewayServer,
  getGatewayStatus,
} from "../integrations/dsh-god/gateway-manager.js";
import { DSH_CONFIG } from "../integrations/dsh-god/config.js";

test("DSH Universal Gateway: lifecycle start, health, and stop", async () => {
  const testPort = 18080;
  const started = await startGatewayServer({ port: testPort, host: "127.0.0.1" });
  assert.equal(started.status, "started");
  assert.equal(started.port, testPort);

  const status = getGatewayStatus();
  assert.equal(status.isRunning, true);
  assert.equal(status.port, testPort);

  // Health endpoint test
  const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.status, "online");
  assert.equal(healthData.service, "ULTRON DSH-GOD Gateway");

  // Models list endpoint test with valid key
  const modelsRes = await fetch(`http://127.0.0.1:${testPort}/v1/models`, {
    headers: { "Authorization": `Bearer ${DSH_CONFIG.gateway.apiKey}` }
  });
  assert.equal(modelsRes.status, 200);
  const modelsData = await modelsRes.json();
  assert.equal(modelsData.object, "list");
  assert.ok(Array.isArray(modelsData.data));
  assert.ok(modelsData.data.length > 0);

  // Unauthorized test
  const unauthRes = await fetch(`http://127.0.0.1:${testPort}/v1/models`, {
    headers: { "Authorization": "Bearer wrong-key" }
  });
  assert.equal(unauthRes.status, 401);

  // Local fast-path completion test
  const compRes = await fetch(`http://127.0.0.1:${testPort}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DSH_CONFIG.gateway.apiKey}`
    },
    body: JSON.stringify({
      model: "local",
      messages: [{ role: "user", content: "ping" }]
    })
  });
  assert.equal(compRes.status, 200);
  const compData = await compRes.json();
  assert.equal(compData.choices?.[0]?.message?.content, "pong");

  // Anthropic messages translation test
  const msgRes = await fetch(`http://127.0.0.1:${testPort}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": DSH_CONFIG.gateway.apiKey
    },
    body: JSON.stringify({
      model: "local",
      messages: [{ role: "user", content: "ping" }]
    })
  });
  assert.equal(msgRes.status, 200);
  const msgData = await msgRes.json();
  assert.equal(msgData.type, "message");
  assert.equal(msgData.role, "assistant");
  assert.equal(msgData.content?.[0]?.text, "pong");

  // Anthropic count_tokens endpoint test
  const countRes = await fetch(`http://127.0.0.1:${testPort}/v1/messages/count_tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": DSH_CONFIG.gateway.apiKey
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "1234567890123456" }]
    })
  });
  assert.equal(countRes.status, 200);
  const countData = await countRes.json();
  assert.ok(countData.input_tokens > 0);

  // Stop server
  const stopped = await stopGatewayServer();
  assert.equal(stopped.status, "stopped");
});
