import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluateNotificationWindow,
  loadNotificationPolicy,
  NOTIFICATION_PRIORITIES
} from "../system/notification-policy.js";
import { createJarvisRouter } from "../jarvis-router.js";
import { DeviceHub } from "../integrations/device-hub.js";

const QUIET_POLICY = {
  ULTRON_NOTIFICATION_POLICY_JSON: JSON.stringify({
    quietHours: { enabled: true, startHHMM: "23:00", endHHMM: "07:00", allowUrgent: true }
  })
};

test("Notification policy: urgent bypasses an overnight quiet window; normal dispatch blocked", () => {
  // 23:05 local — inside the 23:00–07:00 overnight window.
  const atNight = new Date(2026, 10, 4, 23, 5);
  const atNightEarly = new Date(2026, 10, 5, 6, 30);

  const normalNight = evaluateNotificationWindow({
    policy: loadNotificationPolicy(QUIET_POLICY),
    at: atNight,
    priority: "NORMAL"
  });
  assert.equal(normalNight.allowed, false);
  assert.equal(normalNight.reason, "QUIET_HOURS_ACTIVE");
  assert.equal(normalNight.quietWindow.overnight, true);

  const normalDawn = evaluateNotificationWindow({
    policy: loadNotificationPolicy(QUIET_POLICY),
    at: atNightEarly,
    priority: "NORMAL"
  });
  assert.equal(normalDawn.allowed, false);

  const urgentNight = evaluateNotificationWindow({
    policy: loadNotificationPolicy(QUIET_POLICY),
    at: atNight,
    priority: "URGENT"
  });
  assert.equal(urgentNight.allowed, true);
  assert.equal(urgentNight.urgentBypass, true);
});

test("Notification policy: same-day window, boundaries, and fail-open malformed configs", () => {
  // 09:00–17:00 same-day window.
  const policy = loadNotificationPolicy({
    ULTRON_NOTIFICATION_POLICY_JSON: JSON.stringify({
      quietHours: { enabled: true, startHHMM: "09:00", endHHMM: "17:00", allowUrgent: false }
    })
  });
  assert.equal(evaluateNotificationWindow({ policy, at: new Date(2026, 10, 4, 12, 0) }).allowed, false);
  assert.equal(evaluateNotificationWindow({ policy, at: new Date(2026, 10, 4, 8, 59) }).allowed, true);
  assert.equal(evaluateNotificationWindow({ policy, at: new Date(2026, 10, 4, 17, 0) }).allowed, true);
  // Boundary: start is inclusive.
  assert.equal(evaluateNotificationWindow({ policy, at: new Date(2026, 10, 4, 9, 0) }).allowed, false);
  // allowUrgent:false really blocks urgent during quiet hours.
  assert.equal(evaluateNotificationWindow({ policy, at: new Date(2026, 10, 4, 12, 0), priority: "CRITICAL" }).allowed, false);

  // Fail-open: absent policy, malformed JSON, invalid minutes, disabled window.
  assert.equal(loadNotificationPolicy({}).quietHours.enabled, false);
  assert.equal(loadNotificationPolicy({ ULTRON_NOTIFICATION_POLICY_JSON: "{not json" }).policyError, "MALFORMED_NOTIFICATION_POLICY");
  const badWindow = loadNotificationPolicy({
    ULTRON_NOTIFICATION_POLICY_JSON: JSON.stringify({ quietHours: { enabled: true, startHHMM: "9am", endHHMM: "17:00" } })
  });
  const failOpen = evaluateNotificationWindow({ policy: badWindow });
  assert.equal(failOpen.allowed, true);
  assert.equal(failOpen.policyError, "INVALID_QUIET_WINDOW");

  const disabled = evaluateNotificationWindow({
    policy: loadNotificationPolicy({
      ULTRON_NOTIFICATION_POLICY_JSON: JSON.stringify({ quietHours: { enabled: false, startHHMM: "23:00", endHHMM: "07:00" } })
    }),
    at: new Date(2026, 10, 4, 23, 5)
  });
  assert.equal(disabled.allowed, true);
  assert.equal(disabled.policyActive, false);

  // Unknown priorities degrade to NORMAL (respecting quiet hours), never to urgent.
  const unknown = evaluateNotificationWindow({ policy: loadNotificationPolicy(QUIET_POLICY), at: new Date(2026, 10, 4, 23, 5), priority: "MISC" });
  assert.equal(unknown.allowed, false);
  assert.ok(Array.isArray(NOTIFICATION_PRIORITIES));
});

test("Notification route honors quiet hours deterministically (full-day window) with urgent bypass", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-quiet-hours-test-"));

  const fullDayQuietEnv = {
    NODE_ENV: "test",
    ULTRON_ALLOW_LEGACY_DEVICEHUB_AUTH: "true",
    ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user",
    ULTRON_DEVICE_PAIRING_ENABLED: "true",
    // A 00:00–23:59 window is active at any wall-clock time, which makes the
    // route gate deterministic without a clock injection point.
    ULTRON_NOTIFICATION_POLICY_JSON: JSON.stringify({
      quietHours: { enabled: true, startHHMM: "00:00", endHHMM: "23:59", allowUrgent: true }
    })
  };

  const configuredHub = new DeviceHub({
    durableStoragePath: path.join(tmpDir, "paired-devices-quiet.json"),
    env: { ULTRON_DEVICE_SIGNING_SECRET: "unit-test-device-signing-secret-at-least-32-chars" }
  });

  const requireSupabaseUser = (req, res, next) => {
    req.supabaseUser = { id: "owner-user" };
    return next();
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env: fullDayQuietEnv, requireSupabaseUser, deviceHub: configuredHub }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const base = "http://127.0.0.1:" + address.port;

  try {
    // Pair one device so the route reaches the policy gate rather than the
    // DEVICE_NOT_CONNECTED short circuit.
    const reqRes = await fetch(base + "/api/jarvis/devices/pair/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "Quiet Hours Test Companion", platform: "windows" })
    });
    const { pairingCode } = await reqRes.json();
    const approveRes = await fetch(base + "/api/jarvis/devices/pair/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode })
    });
    assert.equal(approveRes.status, 200);

    // Normal priority during the quiet window → explicit 409, not silent drop.
    const deferredRes = await fetch(base + "/api/jarvis/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Report ready", body: "Daily synthesis finished.", priority: "NORMAL" })
    });
    const deferredBody = await deferredRes.json();
    assert.equal(deferredRes.status, 409);
    assert.equal(deferredBody.error.code, "QUIET_HOURS_ACTIVE");

    // Urgent priority bypasses the window.
    const urgentRes = await fetch(base + "/api/jarvis/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Emergency", body: "Security alert acknowledged.", priority: "URGENT" })
    });
    const urgentBody = await urgentRes.json();
    assert.equal(urgentRes.status, 200);
    assert.equal(urgentBody.success, true);
    assert.equal(urgentBody.windowDecision.urgentBypass, true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
