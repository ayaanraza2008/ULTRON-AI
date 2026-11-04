import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createCompanionRouter } from "../system/companion-router.js";
import { desktopCompanionManager } from "../system/desktop-companion-manager.js";

describe("Desktop Companion API Route Suite", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use("/api/companion", createCompanionRouter({ logger: { error: () => {} } }));

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/companion`;
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test("GET /status returns companion state and registered shortcuts", async () => {
    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.status.state);
    assert.ok(Array.isArray(body.status.registeredShortcuts));
  });

  test("POST /position updates and clamps orb position", async () => {
    const res = await fetch(`${baseUrl}/position`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 300, y: 400 })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.position.x, 300);
    assert.equal(body.position.y, 400);
  });

  test("POST /position rejects invalid payload", async () => {
    const res = await fetch(`${baseUrl}/position`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: "invalid" })
    });
    assert.equal(res.status, 400);
  });

  test("GET /anchor returns window position anchored to orb", async () => {
    const res = await fetch(`${baseUrl}/anchor?width=800&height=600`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.anchor.anchoredToOrb, true);
    assert.equal(body.anchor.width, 800);
    assert.equal(body.anchor.height, 600);
  });

  test("POST /tray-action handles toggle, show, hide", async () => {
    const res1 = await fetch(`${baseUrl}/tray-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hide" })
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.outcome.visible, false);

    const res2 = await fetch(`${baseUrl}/tray-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "show" })
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.outcome.visible, true);
  });

  test("GET /hardware returns host telemetry", async () => {
    const res = await fetch(`${baseUrl}/hardware`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.hardware.battery);
    assert.ok(typeof body.hardware.ramUsagePercent === "number");
  });

  test("GET & POST /brightness queries and updates display brightness", async () => {
    const getRes = await fetch(`${baseUrl}/brightness`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);

    const setRes = await fetch(`${baseUrl}/brightness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: getBody.brightness || 100 })
    });
    assert.equal(setRes.status, 200);
    const setBody = await setRes.json();
    assert.equal(setBody.success, true);
  });

  test("POST /media dispatches media keys", async () => {
    const res = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "play_pause" })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  test("POST /window handles window state changes", async () => {
    const res = await fetch(`${baseUrl}/window`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore" })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });
});
