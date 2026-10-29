import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGatewayServer } from "../rea-gateway/server.js";

const token = "unit-test-token_" + "x".repeat(48);

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise(resolve => server.close(() => resolve()));
}

async function withGateway(run, { maxRequestBytes = 1024, isReady } = {}) {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        sessionId: req.headers["mcp-session-id"],
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": "rea-session-test",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }));
    });
  });
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({ token, upstreamPort, maxRequestBytes, isReady });
  const gatewayPort = await listen(gateway);
  try {
    await run({ base: "http://127.0.0.1:" + gatewayPort, seen });
  } finally {
    await close(gateway);
    await close(upstream);
  }
}

test("gateway remains unavailable until its live REA protocol check succeeds", async () => {
  await withGateway(async ({ base, seen }) => {
    const health = await fetch(base + "/healthz");
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: "starting" });

    const mcp = await fetch(base + "/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(mcp.status, 503);
    assert.equal(seen.length, 0);
  }, { isReady: () => false });
});

test("REA gateway exposes readiness without disclosing secrets or target data", async () => {
  await withGateway(async ({ base }) => {
    const response = await fetch(base + "/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("REA gateway refuses missing and incorrect bearer tokens before upstream access", async () => {
  await withGateway(async ({ base, seen }) => {
    const noToken = await fetch(base + "/mcp", { method: "POST", body: "{}" });
    const wrongToken = await fetch(base + "/mcp", {
      method: "POST", headers: { Authorization: "Bearer wrong-token" }, body: "{}"
    });
    assert.equal(noToken.status, 401);
    assert.equal(wrongToken.status, 401);
    assert.equal(seen.length, 0);
    assert.equal(JSON.stringify(await noToken.json()).includes(token), false);
  });
});

test("REA gateway forwards MCP session headers and body but never forwards the gateway token", async () => {
  await withGateway(async ({ base, seen }) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" });
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": "rea-session-client"
      },
      body
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("mcp-session-id"), "rea-session-test");
    assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 7, result: { ok: true } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/mcp");
    assert.equal(seen[0].authorization, undefined);
    assert.equal(seen[0].sessionId, "rea-session-client");
    assert.equal(seen[0].body, body);
  });
});

test("REA gateway only proxies the exact MCP path and supported methods", async () => {
  await withGateway(async ({ base, seen }) => {
    const route = await fetch(base + "/other", { headers: { Authorization: "Bearer " + token } });
    const query = await fetch(base + "/mcp?target=http://127.0.0.1", { headers: { Authorization: "Bearer " + token } });
    const method = await fetch(base + "/mcp", {
      method: "PUT", headers: { Authorization: "Bearer " + token }, body: "{}"
    });
    assert.equal(route.status, 404);
    assert.equal(query.status, 404);
    assert.equal(method.status, 405);
    assert.equal(seen.length, 0);
  });
});

test("REA gateway rejects oversized bodies before forwarding them", async () => {
  await withGateway(async ({ base, seen }) => {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(80) })
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "request_too_large" });
    assert.equal(seen.length, 0);
  }, { maxRequestBytes: 24 });
});
