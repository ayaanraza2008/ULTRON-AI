import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJarvisRouter } from "../jarvis-router.js";
import { DeviceHub } from "../integrations/device-hub.js";

async function withDeviceRouter({ env = {
  NODE_ENV: "test",
  ULTRON_ALLOW_LEGACY_DEVICEHUB_AUTH: "true",
  ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user",
  ULTRON_DEVICE_PAIRING_ENABLED: "true"
}, userId = "owner-user", deviceHub } = {}, run) {
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

test("JARVIS DeviceHub Endpoints: Full Command, Telemetry, Rotation, Notification, and Revocation Lifecycle", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-device-routes-test-"));
  const storePath = path.join(tmpDir, "paired-devices.json");
  const deviceHub = new DeviceHub({
    durableStoragePath: storePath,
    env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" }
  });

  try {
    await withDeviceRouter({ deviceHub }, async (base) => {
      // 1. Initial listing: empty
      const initList = await fetch(base + "/api/jarvis/devices");
      const initListBody = await initList.json();
      assert.equal(initList.status, 200);
      assert.equal(initListBody.devices.length, 0);

      // 2. Pair device
      const reqRes = await fetch(base + "/api/jarvis/devices/pair/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: "Ayaan Windows Companion", platform: "windows" })
      });
      const reqBody = await reqRes.json();
      assert.equal(reqRes.status, 200);
      assert.ok(reqBody.pairingCode);
      const code = reqBody.pairingCode;

      // 3. Approve pairing
      const appRes = await fetch(base + "/api/jarvis/devices/pair/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingCode: code })
      });
      const appBody = await appRes.json();
      assert.equal(appRes.status, 200);
      assert.ok(appBody.deviceId);
      assert.ok(appBody.deviceToken);
      const deviceId = appBody.deviceId;
      let deviceToken = appBody.deviceToken;

      // 4. Claim pairing
      const claimRes = await fetch(base + "/api/jarvis/devices/pair/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingCode: code })
      });
      const claimBody = await claimRes.json();
      assert.equal(claimRes.status, 200);
      assert.equal(claimBody.deviceId, deviceId);

      // 5. Verify device in listing
      const listRes = await fetch(base + "/api/jarvis/devices");
      const listBody = await listRes.json();
      assert.equal(listRes.status, 200);
      assert.equal(listBody.devices.length, 1);
      assert.equal(listBody.devices[0].id, deviceId);
      assert.equal(listBody.devices[0].status, "active");

      // 6. Device updates telemetry
      const telRes = await fetch(base + `/api/jarvis/devices/${deviceId}/telemetry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": deviceToken
        },
        body: JSON.stringify({ batteryPercent: 92, isCharging: true, online: true })
      });
      const telBody = await telRes.json();
      assert.equal(telRes.status, 200);
      assert.equal(telBody.success, true);

      // 7. Owner enqueues command for companion device
      const cmdRes = await fetch(base + `/api/jarvis/devices/${deviceId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "capture_desktop_screenshot", payload: { display: 1 } })
      });
      const cmdBody = await cmdRes.json();
      assert.equal(cmdRes.status, 200);
      assert.equal(cmdBody.success, true);
      assert.ok(cmdBody.command.id);
      assert.ok(cmdBody.command.signature);
      assert.equal(cmdBody.command.action, "capture_desktop_screenshot");
      const cmdId = cmdBody.command.id;

      // 8. Companion polls pending commands using Bearer header
      const pollRes = await fetch(base + `/api/jarvis/devices/${deviceId}/commands/pending`, {
        headers: { "Authorization": `Bearer ${deviceToken}` }
      });
      const pollBody = await pollRes.json();
      assert.equal(pollRes.status, 200);
      assert.equal(pollBody.success, true);
      assert.equal(pollBody.commands.length, 1);
      assert.equal(pollBody.commands[0].id, cmdId);
      assert.equal(pollBody.commands[0].status, "dispatched");

      // 9. Companion completes the command
      const compRes = await fetch(base + `/api/jarvis/devices/${deviceId}/commands/${cmdId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-token": deviceToken
        },
        body: JSON.stringify({ status: "success", output: "Screenshot taken" })
      });
      const compBody = await compRes.json();
      assert.equal(compRes.status, 200);
      assert.equal(compBody.success, true);
      assert.equal(compBody.status, "completed");

      // 10. Owner sends notification to paired companion
      const notifRes = await fetch(base + "/api/jarvis/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          title: "System Update",
          body: "Verification scan 100% complete."
        })
      });
      const notifBody = await notifRes.json();
      assert.equal(notifRes.status, 200);
      assert.equal(notifBody.success, true);
      assert.equal(notifBody.notification.title, "System Update");

      // Notification history retrieval
      const getNotif = await fetch(base + "/api/jarvis/notifications");
      const getNotifBody = await getNotif.json();
      assert.equal(getNotif.status, 200);
      assert.ok(getNotifBody.notifications.length >= 1);

      // 11. Rotate device token
      const rotRes = await fetch(base + `/api/jarvis/devices/${deviceId}/rotate-token`, { method: "POST" });
      const rotBody = await rotRes.json();
      assert.equal(rotRes.status, 200);
      assert.equal(rotBody.success, true);
      assert.ok(rotBody.newDeviceToken);
      const oldToken = deviceToken;
      deviceToken = rotBody.newDeviceToken;

      // Old token MUST now be rejected (401)
      const rejectedPoll = await fetch(base + `/api/jarvis/devices/${deviceId}/commands/pending`, {
        headers: { "x-device-token": oldToken }
      });
      assert.equal(rejectedPoll.status, 401);

      // New token MUST be accepted (200)
      const acceptedPoll = await fetch(base + `/api/jarvis/devices/${deviceId}/commands/pending`, {
        headers: { "x-device-token": deviceToken }
      });
      assert.equal(acceptedPoll.status, 200);

      // 12. Revoke device
      const revRes = await fetch(base + `/api/jarvis/devices/${deviceId}/revoke`, { method: "POST" });
      const revBody = await revRes.json();
      assert.equal(revRes.status, 200);
      assert.equal(revBody.success, true);
      assert.equal(revBody.status, "revoked");

      // Once revoked, polling with device token MUST be rejected (401)
      const pollAfterRevoke = await fetch(base + `/api/jarvis/devices/${deviceId}/commands/pending`, {
        headers: { "x-device-token": deviceToken }
      });
      assert.equal(pollAfterRevoke.status, 401);

      // 13. Unpair / Delete device
      const delRes = await fetch(base + `/api/jarvis/devices/${deviceId}`, { method: "DELETE" });
      const delBody = await delRes.json();
      assert.equal(delRes.status, 200);
      assert.equal(delBody.success, true);

      // Subsequent delete returns 404
      const delRes404 = await fetch(base + `/api/jarvis/devices/${deviceId}`, { method: "DELETE" });
      assert.equal(delRes404.status, 404);
    });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
