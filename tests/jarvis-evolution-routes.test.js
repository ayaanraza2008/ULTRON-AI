import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";
import { DeviceHub } from "../integrations/device-hub.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function withRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user", deviceHub } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, res, next) => {
    if (req.headers["authorization"] || userId) {
      req.supabaseUser = { id: userId || "owner-user" };
      return next();
    }
    return res.status(401).json({ error: { message: "Unauthorized" } });
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser, deviceHub }));
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

test("JARVIS Self-Evolution Routes: POST /api/jarvis/evolution/audit runs self-audit", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/evolution/audit", { method: "POST" });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.audit.id.startsWith("audit-"));
    assert.ok(body.audit.healthScore >= 0);
  });
});

test("JARVIS Self-Evolution Routes: POST /api/jarvis/evolution/command handles natural language intent", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/evolution/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "Ultron, audit yourself" })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.result.intent, "SELF_AUDIT");
    assert.ok(body.result.audit);
  });
});

test("JARVIS Self-Evolution Routes: GET /api/jarvis/evolution/history returns history records", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/evolution/history");
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.history.audits));
    assert.ok(Array.isArray(body.history.plans));
    assert.ok(Array.isArray(body.history.changes));
  });
});

test("JARVIS Self-Evolution Routes: POST /api/jarvis/evolution/apply enforces server-side security", async () => {
  await withRouter({}, async base => {
    // Attempt to modify restricted file without operator confirmation token
    const res = await fetch(base + "/api/jarvis/evolution/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planItemId: "plan-restricted-test",
        modificationSpec: {
          targetFile: "render.yaml",
          newContent: "services: []\n"
        },
        operatorContext: { authorized: true } // Attempting client-side bypass!
      })
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error.code, "REQUIRES_OPERATOR_CONFIRMATION_TOKEN");
  });
});

test("JARVIS Voice & HUD Routes: POST /api/jarvis/voice/process-command and HUD state sync", async () => {
  await withRouter({}, async base => {
    // 1. Test voice command processing for evolution command
    const voiceRes = await fetch(base + "/api/jarvis/voice/process-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "Ultron, upgrade yourself",
        language: "en"
      })
    });
    const voiceBody = await voiceRes.json();

    assert.equal(voiceRes.status, 200);
    assert.equal(voiceBody.success, true);
    assert.equal(voiceBody.intent, "EVOLVE_CYCLE");
    assert.ok(voiceBody.textResponse);

    // 2. Test HUD state GET
    const hudGetRes = await fetch(base + "/api/jarvis/hud/state");
    const hudGetBody = await hudGetRes.json();
    assert.equal(hudGetRes.status, 200);
    assert.equal(hudGetBody.success, true);
    assert.equal(hudGetBody.hud.state, "STANDBY");

    // 3. Test HUD state POST
    const hudPostRes = await fetch(base + "/api/jarvis/hud/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: "LISTENING",
        activeTask: "VOICE_INTERACTION"
      })
    });
    const hudPostBody = await hudPostRes.json();
    assert.equal(hudPostRes.status, 200);
    assert.equal(hudPostBody.success, true);
    assert.equal(hudPostBody.hud.state, "LISTENING");
  });
});


test("JARVIS Self-Evolution Routes: approval is bound to exact newContent and cannot authorize a modified payload", async () => {
  await withRouter({}, async base => {
    const approvedContent = "services: []\\n";
    const challengeRes = await fetch(base + "/api/jarvis/evolution/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetFile: "render.yaml",
        newContent: approvedContent,
        modificationDigest: "attacker-controlled-digest-is-ignored"
      })
    });
    const challengeBody = await challengeRes.json();
    assert.equal(challengeRes.status, 200);
    assert.equal(challengeBody.success, true);
    assert.ok(challengeBody.challenge.approvalToken);
    const expectedDigest = crypto.createHash("sha256").update(approvedContent, "utf8").digest("hex");
    assert.equal(challengeBody.challenge.modificationDigest, expectedDigest);

    // A missing preview is not allowed to create an approval.
    const missingContent = await fetch(base + "/api/jarvis/evolution/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetFile: "render.yaml", modificationDigest: expectedDigest })
    });
    assert.equal(missingContent.status, 400);
    assert.equal((await missingContent.json()).error.code, "APPROVED_CONTENT_REQUIRED");

    // A token for content A must not authorize payload B, even when the client repeats the old digest.
    const tamperedRes = await fetch(base + "/api/jarvis/evolution/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planItemId: "plan-tampered-content",
        modificationSpec: {
          targetFile: "render.yaml",
          newContent: "services:\\n  - type: web\\n    name: attacker-payload\\n",
          modificationDigest: expectedDigest
        },
        approvalToken: challengeBody.challenge.approvalToken
      })
    });
    assert.equal(tamperedRes.status, 403);
    assert.equal((await tamperedRes.json()).error.code, "INVALID_SIGNATURE");

    // Immutable paths remain blocked before any write attempt.
    const immRes = await fetch(base + "/api/jarvis/evolution/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planItemId: "plan-imm",
        modificationSpec: { targetFile: ".env", newContent: "SECRET=bad" },
        approvalToken: challengeBody.challenge.approvalToken
      })
    });
    assert.equal(immRes.status, 403);
    assert.equal((await immRes.json()).error.code, "IMMUTABLE_SYSTEM_PATH_REJECTED");
  });
});

test("JARVIS Multi-Device Hub: pairing fails closed without durable encrypted storage", async () => {
  const deviceHub = new DeviceHub({ env: {} });
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user", ULTRON_DEVICE_PAIRING_ENABLED: "true" },
    deviceHub
  }, async base => {
    const response = await fetch(base + "/api/jarvis/devices/pair/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "Unconfigured companion", platform: "windows" })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "DEVICE_PAIRING_NOT_CONFIGURED");
  });
});

test("JARVIS Multi-Device Hub: full pairing lifecycle and x-device-token authorization", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-router-device-hub-"));
  const deviceHub = new DeviceHub({
    durableStoragePath: path.join(tmpDir, "paired-devices.json"),
    env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" }
  });
  try {
  await withRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user", ULTRON_DEVICE_PAIRING_ENABLED: "true" },
    deviceHub
  }, async base => {
    // 1. Request pairing code (companion side)
    const reqRes = await fetch(base + "/api/jarvis/devices/pair/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "Windows Companion PC-LENOVO", platform: "windows" })
    });
    const reqBody = await reqRes.json();
    assert.equal(reqRes.status, 200);
    assert.equal(reqBody.success, true);
    assert.ok(reqBody.pairingCode);
    const code = reqBody.pairingCode;

    // 2. Claim before approval should be rejected (409 Conflict)
    const prematureClaim = await fetch(base + "/api/jarvis/devices/pair/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: code })
    });
    assert.equal(prematureClaim.status, 409);

    // 3. Approve pairing code (owner side)
    const approveRes = await fetch(base + "/api/jarvis/devices/pair/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: code })
    });
    const approveBody = await approveRes.json();
    assert.equal(approveRes.status, 200);
    assert.equal(approveBody.success, true);
    assert.ok(approveBody.deviceToken);

    // 4. Claim approved pairing code (companion side)
    const claimRes = await fetch(base + "/api/jarvis/devices/pair/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: code })
    });
    const claimBody = await claimRes.json();
    assert.equal(claimRes.status, 200);
    assert.equal(claimBody.success, true);
    assert.ok(claimBody.deviceToken);
    const deviceToken = claimBody.deviceToken;

    // 5. Access voice/process-command using x-device-token without Supabase JWT
    const voiceRes = await fetch(base + "/api/jarvis/voice/process-command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-token": deviceToken
      },
      body: JSON.stringify({ command: "Ultron, what is your status?" })
    });
    const voiceBody = await voiceRes.json();
    assert.equal(voiceRes.status, 200);
    assert.equal(voiceBody.success, true);

    // 6. Access hud/state using x-device-token
    const hudRes = await fetch(base + "/api/jarvis/hud/state", {
      headers: { "x-device-token": deviceToken }
    });
    const hudBody = await hudRes.json();
    assert.equal(hudRes.status, 200);
    assert.equal(hudBody.success, true);

    // 7. Invalid x-device-token returns 401
    const invalidRes = await fetch(base + "/api/jarvis/hud/state", {
      headers: { "x-device-token": "invalid_token_999" }
    });
    assert.equal(invalidRes.status, 401);
  });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});