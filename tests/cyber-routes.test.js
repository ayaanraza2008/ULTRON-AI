import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

async function withCyberRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("Cyber Routes: GET /api/jarvis/cyber/status reports 13 active cyber agents", async () => {
  await withCyberRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/cyber/status");
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.agentsCount, 13);
    assert.ok(body.activeScopesCount >= 1);
  });
});

test("Cyber Routes: Scope registration, audit, and mission execution on authorized target", async () => {
  await withCyberRouter({}, async base => {
    // 1. Run SAST scan
    const sastRes = await fetch(base + "/api/jarvis/cyber/sast/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "localhost",
        sourceCode: "const exec = require('child_process').exec; exec('ls ' + input);"
      })
    });
    const sastBody = await sastRes.json();
    assert.equal(sastRes.status, 200);
    assert.equal(sastBody.success, true);
    assert.equal(sastBody.isSecure, false);

    // 2. Run Comprehensive Mission on localhost (authorized by default)
    const missionRes = await fetch(base + "/api/jarvis/cyber/mission/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "localhost",
        options: {
          webHeaders: { "server": "Express" },
          includeAiRedTeam: true
        }
      })
    });
    const missionBody = await missionRes.json();
    assert.equal(missionRes.status, 200);
    assert.equal(missionBody.success, true);
    assert.equal(missionBody.status, "COMPLETED");
    assert.ok(missionBody.reports.markdown);

    // 3. Attempt mission on unauthorized target -> 403 Forbidden
    const unauthRes = await fetch(base + "/api/jarvis/cyber/mission/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "unauthorized-external-server.com" })
    });
    const unauthBody = await unauthRes.json();
    assert.equal(unauthRes.status, 403);
    assert.ok(unauthBody.error.message.includes("TARGET_OUT_OF_SCOPE"));
  });
});

test("Cyber Routes: AI Red-Team endpoint runs evaluation suite", async () => {
  await withCyberRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/cyber/ai/redteam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "localhost" })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.status, "SECURE_AI_DEFENSE");
    assert.equal(body.resistanceScore, 100);
  });
});
