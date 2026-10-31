import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createDshGodRouter } from "../integrations/dsh-god/management-api.js";

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/dsh-god", createDshGodRouter());
  const server = http.createServer(app);
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

test("DSH Facade Routes: verifies management REST API endpoints", async () => {
  const { server, port } = await startTestApp();
  const base = `http://127.0.0.1:${port}/api/integrations/dsh-god`;

  try {
    // 1. GET /status
    const statusRes = await fetch(`${base}/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.ok, true);
    assert.ok(statusData.providers.totalProviders >= 70);
    assert.ok(statusData.lanes.openCode);
    assert.ok(statusData.lanes.kilo);

    // 2. GET /providers
    const provRes = await fetch(`${base}/providers`);
    assert.equal(provRes.status, 200);
    const provData = await provRes.json();
    assert.equal(provData.ok, true);
    assert.ok(provData.count >= 70);

    // 3. GET /combos
    const comboRes = await fetch(`${base}/combos`);
    assert.equal(comboRes.status, 200);
    const comboData = await comboRes.json();
    assert.equal(comboData.ok, true);
    assert.ok(comboData.count >= 3);

    // 4. GET /catalog
    const catRes = await fetch(`${base}/catalog`);
    assert.equal(catRes.status, 200);
    const catData = await catRes.json();
    assert.equal(catData.ok, true);
    assert.ok(catData.count > 0);

    // 5. GET /usage
    const useRes = await fetch(`${base}/usage`);
    assert.equal(useRes.status, 200);
    const useData = await useRes.json();
    assert.equal(useData.ok, true);

    // 6. GET /token-saver
    const tsRes = await fetch(`${base}/token-saver`);
    assert.equal(tsRes.status, 200);
    const tsData = await tsRes.json();
    assert.equal(tsData.ok, true);
    assert.ok(tsData.description.includes("Token Optimizer"));

    // 7. GET /channels
    const chRes = await fetch(`${base}/channels`);
    assert.equal(chRes.status, 200);
    const chData = await chRes.json();
    assert.equal(chData.ok, true);
    assert.equal(chData.report.totalChannels, 10);

    // 8. POST /chat (local fast-path)
    const chatRes = await fetch(`${base}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages: [{ role: "user", content: "ping" }]
      })
    });
    assert.equal(chatRes.status, 200);
    const chatData = await chatRes.json();
    assert.equal(chatData.ok, true);
    assert.equal(chatData.result.choices?.[0]?.message?.content, "pong");

  } finally {
    await new Promise(res => server.close(res));
  }
});
