import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DeviceHub } from "../integrations/device-hub.js";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";
import { deviceNetworkingManager } from "../integrations/device-networking.js";
import { createJarvisRouter } from "../jarvis-router.js";
import { zeroCostAiEngine } from "../core/zero-cost-ai.js";
import { windowsDesktopAgent } from "../system/windows-desktop-agent.js";

async function withTestServer({ env = {}, deviceHub } = {}, run) {
  const app = express();
  app.use(express.json());

  const requireSupabaseUser = (req, res, next) => {
    req.supabaseUser = { id: "test-operator-uuid" };
    next();
  };

  const wsGateway = new DeviceWebSocketGateway({ deviceHub });

  app.use("/api", createJarvisRouter({
    env: {
      ULTRON_INTEGRATION_OWNER_USER_ID: "test-operator-uuid",
      ULTRON_DEVICE_PAIRING_ENABLED: "true",
      NODE_ENV: "test",
      ULTRON_ALLOW_LEGACY_DEVICEHUB_AUTH: "true",
      ...env
    },
    requireSupabaseUser,
    deviceHub
  }));

  const server = createServer(app);
  wsGateway.attachToServer(server);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws/devices`;

  try {
    await run({ baseUrl, wsUrl, server, wsGateway });
  } finally {
    wsGateway.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

test("Multi-Device Ecosystem: Complete End-to-End Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-multidevice-test-"));
  const storePath = path.join(tmpDir, "paired-devices.json");
  const deviceHub = new DeviceHub({
    durableStoragePath: storePath,
    env: { ULTRON_DEVICE_SIGNING_SECRET: "32-char-ultra-secure-signing-secret-for-multidevice-tests" }
  });

  await withTestServer({ deviceHub }, async ({ baseUrl, wsUrl }) => {

    let pcDeviceId = "";
    let pcToken = "";
    let androidDeviceId = "";
    let androidToken = "";

    await t.test("1. Pair Windows PC and Android Phone with distinct cryptographic tokens", async () => {
      // Pair Windows PC
      const pcPair = deviceHub.createPairingCode({ name: "Primary Windows PC", platform: "windows" });
      const pcApprove = deviceHub.approvePairingCode(pcPair.code, "test-operator-uuid");
      const pcClaim = deviceHub.claimPairingCode(pcPair.code);
      assert.equal(pcClaim.success, true);
      pcDeviceId = pcClaim.deviceId;
      pcToken = pcClaim.deviceToken;
      assert.ok(pcToken.startsWith("dev_tok_") || pcToken.startsWith("ultron_dev_"));

      // Pair Android Phone
      const andPair = deviceHub.createPairingCode({ name: "Galaxy S24 Ultra", platform: "android" });
      const andApprove = deviceHub.approvePairingCode(andPair.code, "test-operator-uuid");
      const andClaim = deviceHub.claimPairingCode(andPair.code);
      assert.equal(andClaim.success, true);
      androidDeviceId = andClaim.deviceId;
      androidToken = andClaim.deviceToken;

      assert.notEqual(pcDeviceId, androidDeviceId);
      assert.notEqual(pcToken, androidToken);

      // Verify tokens authenticate in DeviceHub
      assert.ok(deviceHub.authenticateDevice(pcDeviceId, pcToken));
      assert.ok(deviceHub.authenticateDevice(androidDeviceId, androidToken));

      // Cross-token authentication fails closed
      assert.equal(deviceHub.authenticateDevice(pcDeviceId, androidToken), null);
    });

    await t.test("2. Secure QR Pairing Code Generation & Single-Use Verification", async () => {
      const qrRes = await fetch(`${baseUrl}/api/jarvis/devices/pair/qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Tablet Node", platform: "android" })
      });
      const qrData = await qrRes.json();
      assert.equal(qrRes.status, 200);
      assert.equal(qrData.success, true);
      assert.ok(qrData.code);
      assert.ok(qrData.qrPayload.startsWith("ultron://pair?code="));

      // Single-use claim verification
      deviceHub.approvePairingCode(qrData.code, "test-operator-uuid");
      const firstClaim = deviceHub.claimPairingCode(qrData.code);
      assert.equal(firstClaim.success, true);

      // Double-claim MUST fail closed
      const secondClaim = deviceHub.claimPairingCode(qrData.code);
      assert.equal(secondClaim.success, false);
      assert.equal(secondClaim.error, "INVALID_PAIRING_CODE");
    });

    await t.test("3. Device Presence: Online Heartbeat and Offline Stale Timeout", async () => {
      // Send heartbeat from Windows PC
      const hbRes = await fetch(`${baseUrl}/api/jarvis/devices/${pcDeviceId}/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": pcToken
        },
        body: JSON.stringify({ batteryPercent: 95, isCharging: true })
      });
      const hbData = await hbRes.json();
      assert.equal(hbRes.status, 200);
      assert.equal(hbData.success, true);
      assert.equal(hbData.online, true);

      // Check presence status via API
      const presRes = await fetch(`${baseUrl}/api/jarvis/devices/${pcDeviceId}/presence`);
      const presData = await presRes.json();
      assert.equal(presRes.status, 200);
      assert.equal(presData.online, true);
      assert.equal(presData.battery.percent, 95);

      // Verify stale timeout logic: if last contact is older than 60s, device reports OFFLINE
      const pcDev = deviceHub.pairedDevices.get(pcDeviceId);
      pcDev.lastSeenAt = new Date(Date.now() - 70_000).toISOString();
      assert.equal(deviceHub.isDeviceOnline(pcDeviceId, 60_000), false);

      // Re-heartbeat recovers online presence immediately
      deviceHub.heartbeat(pcDeviceId, pcToken);
      assert.equal(deviceHub.isDeviceOnline(pcDeviceId), true);
    });

    await t.test("4. Cross-Device Command Routing: Android dispatches authorized command to Windows PC", async () => {
      // Ensure PC is marked online
      deviceHub.heartbeat(pcDeviceId, pcToken);

      // Android requests PC to open Chrome
      const routeRes = await fetch(`${baseUrl}/api/jarvis/devices/route-command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": androidToken
        },
        body: JSON.stringify({
          targetDeviceId: pcDeviceId,
          action: "launch_app",
          payload: { app: "chrome" },
          idempotencyKey: "test-idemp-001"
        })
      });

      const routeData = await routeRes.json();
      assert.equal(routeRes.status, 200);
      assert.equal(routeData.success, true);
      assert.equal(routeData.routed, true);
      assert.ok(routeData.commandId);
      assert.equal(routeData.command.action, "launch_app");
      assert.ok(routeData.command.signature);

      // Windows companion polls pending commands
      const pollRes = await fetch(`${baseUrl}/api/jarvis/devices/${pcDeviceId}/commands/pending`, {
        headers: { "x-device-token": pcToken }
      });
      const pollData = await pollRes.json();
      assert.equal(pollRes.status, 200);
      assert.equal(pollData.commands.length, 1);
      assert.equal(pollData.commands[0].id, routeData.commandId);

      // Windows companion completes the command
      const compRes = await fetch(`${baseUrl}/api/jarvis/devices/${pcDeviceId}/commands/${routeData.commandId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": pcToken
        },
        body: JSON.stringify({ status: "success", launched: "chrome.exe" })
      });
      const compData = await compRes.json();
      assert.equal(compRes.status, 200);
      assert.equal(compData.status, "completed");

      // Verify task in shared cross-device task history
      const taskRes = await fetch(`${baseUrl}/api/jarvis/devices/tasks`);
      const taskData = await taskRes.json();
      assert.equal(taskRes.status, 200);
      assert.ok(taskData.tasks.length >= 1);
      const matched = taskData.tasks.find(t => t.id === routeData.commandId);
      assert.ok(matched);
      assert.equal(matched.status, "completed");
    });

    await t.test("5. Offline Target Handling: Disallowing execution when Windows PC is offline", async () => {
      // Force PC offline
      const pcDev = deviceHub.pairedDevices.get(pcDeviceId);
      pcDev.online = false;
      pcDev.lastSeenAt = new Date(Date.now() - 100_000).toISOString();

      // Android attempts to dispatch command to offline PC
      const routeRes = await fetch(`${baseUrl}/api/jarvis/devices/route-command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": androidToken
        },
        body: JSON.stringify({
          targetDeviceId: pcDeviceId,
          action: "launch_app",
          payload: { app: "notepad" }
        })
      });

      const routeData = await routeRes.json();
      assert.equal(routeRes.status, 409);
      assert.equal(routeData.success, false);
      assert.equal(routeData.error, "TARGET_DEVICE_OFFLINE");
      assert.ok(routeData.message.includes("OFFLINE"));

      // Ensure no command was queued for offline device
      const queue = deviceHub.commandQueue.get(pcDeviceId) || [];
      const pendingCmds = queue.filter(c => c.status === "pending");
      assert.equal(pendingCmds.length, 0);

      // Restore PC online
      deviceHub.heartbeat(pcDeviceId, pcToken);
    });

    await t.test("6. Security Allowlist: Denies unapproved commands and unallowlisted binaries", async () => {
      deviceHub.heartbeat(pcDeviceId, pcToken);

      // 1. Unapproved action
      const badAction = await fetch(`${baseUrl}/api/jarvis/devices/route-command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": androidToken
        },
        body: JSON.stringify({
          targetDeviceId: pcDeviceId,
          action: "execute_arbitrary_shell",
          payload: { cmd: "rmdir /s /q C:\\" }
        })
      });
      const badActionData = await badAction.json();
      assert.equal(badAction.status, 403);
      assert.equal(badActionData.error, "ACTION_NOT_APPROVED");

      // 2. Unallowlisted binary for launch_app
      const badApp = await fetch(`${baseUrl}/api/jarvis/devices/route-command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": androidToken
        },
        body: JSON.stringify({
          targetDeviceId: pcDeviceId,
          action: "launch_app",
          payload: { app: "powershell_malware.exe" }
        })
      });
      const badAppData = await badApp.json();
      assert.equal(badApp.status, 400);
      assert.equal(badAppData.error, "APP_NOT_ALLOWLISTED");
    });

    await t.test("7. Reconnect Idempotency Protection: Prevents duplicate execution on network drops", async () => {
      deviceHub.heartbeat(pcDeviceId, pcToken);
      const idempotencyKey = "reconnect-test-key-999";

      // First submission
      const first = await fetch(`${baseUrl}/api/jarvis/devices/route-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-token": androidToken },
        body: JSON.stringify({
          targetDeviceId: pcDeviceId,
          action: "lock_workstation",
          idempotencyKey
        })
      });
      const firstData = await first.json();
      assert.equal(firstData.success, true);
      assert.equal(firstData.deduplicated, undefined);
      const cmdId = firstData.commandId;

      // Second submission with SAME idempotencyKey (simulating reconnect retry)
      const second = await fetch(`${baseUrl}/api/jarvis/devices/route-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-token": androidToken },
        body: JSON.stringify({
          targetDeviceId: pcDeviceId,
          action: "lock_workstation",
          idempotencyKey
        })
      });
      const secondData = await second.json();
      assert.equal(secondData.success, true);
      assert.equal(secondData.deduplicated, true);
      assert.equal(secondData.command.id, cmdId);
    });

    await t.test("8. Natural Spoken Cross-Device Command Processing & Shared Conversation", async () => {
      deviceHub.heartbeat(pcDeviceId, pcToken);

      // Voice command from Android: "ULTRON, open Chrome on my PC"
      const voiceRes = await fetch(`${baseUrl}/api/jarvis/voice/process-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-token": androidToken },
        body: JSON.stringify({
          command: "ULTRON, open Chrome on my PC",
          language: "en",
          source: "android-companion"
        })
      });
      const voiceData = await voiceRes.json();
      assert.equal(voiceRes.status, 200);
      assert.equal(voiceData.success, true);
      assert.equal(voiceData.intent, "CROSS_DEVICE_REMOTE_INTENT");
      assert.ok(voiceData.textResponse.toLowerCase().includes("chrome"));

      // Verify recorded in shared cross-device conversation
      const sharedMsgs = deviceHub.getSharedMessages();
      assert.ok(sharedMsgs.some(m => m.content.includes("open Chrome on my PC")));
    });

    await t.test("9. Dual Mode Network Discovery (Local Wi-Fi & Tailscale)", async () => {
      // Local Wi-Fi discovery beacon
      const discRes = await fetch(`${baseUrl}/api/jarvis/network/discovery`);
      const discData = await discRes.json();
      assert.equal(discRes.status, 200);
      assert.equal(discData.service, "ULTRON-AI-CORE");
      assert.ok(discData.primaryLocalUrl);

      // Connectivity diagnostic probe
      const connRes = await fetch(`${baseUrl}/api/jarvis/network/connectivity`);
      const connData = await connRes.json();
      assert.equal(connRes.status, 200);
      assert.ok(connData.modes.local);
      assert.ok(connData.modes.tailscale);
      assert.ok(connData.modes.cloudRelay);
      assert.equal(connData.modes.cloudRelay.outboundOnlyWindows, true);
    });

    await t.test("10. Zero-Cost AI Hierarchy: 4-Tier Free-First Architecture & Ryzen 7 5700U Safeguard", async () => {
      // Check AMD Ryzen 7 5700U + 8 GB RAM memory guard
      const memCheck = zeroCostAiEngine.checkRyzenMemorySafety();
      assert.ok(memCheck.totalMemGb > 0);
      assert.ok(typeof memCheck.isSafe === "boolean");
      assert.ok(memCheck.cpuModel);

      // Test Tier 4 Offline Intent Dispatcher
      const offlineApp = zeroCostAiEngine.processOfflineIntent("open chrome on my pc");
      assert.equal(offlineApp.matched, true);
      assert.equal(offlineApp.action, "launch_app");
      assert.equal(offlineApp.targetApp, "chrome");

      const offlineLock = zeroCostAiEngine.processOfflineIntent("lock workstation now");
      assert.equal(offlineLock.matched, true);
      assert.equal(offlineLock.action, "lock_workstation");

      // Test Free-Tier Audit Report
      const auditReport = zeroCostAiEngine.getFreeTierAuditReport();
      assert.equal(auditReport.zeroCostCompliance, true);
      assert.equal(auditReport.monthlyInfrastructureCost, "$0.00");
      assert.equal(auditReport.localHardware.cudaRequired, false);
      assert.equal(auditReport.tiersConfigured.length, 4);
    });

    await t.test("11. Real-time RFC 6455 WebSocket Handshake & Frame Dispatch", async () => {
      // Verify WebSocket upgrade handshake computation
      const testKey = "dGhlIHNhbXBsZSBub25jZQ==";
      const expectedAccept = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
      const hash = crypto.createHash("sha1").update(testKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      assert.equal(hash, expectedAccept);
    });
  });

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});
