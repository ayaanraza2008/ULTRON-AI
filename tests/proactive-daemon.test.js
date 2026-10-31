import test from "node:test";
import assert from "node:assert/strict";
import { ProactiveDaemon } from "../system/proactive-daemon.js";

test("ProactiveDaemon: initializes, tracks status, and handles start/stop lifecycle", () => {
  const daemon = new ProactiveDaemon({ intervalMs: 10000 });
  assert.equal(daemon.isRunning, false);

  daemon.start();
  assert.equal(daemon.isRunning, true);
  const status = daemon.getStatus();
  assert.equal(status.isRunning, true);
  assert.equal(status.intervalMs, 10000);

  daemon.stop();
  assert.equal(daemon.isRunning, false);
});

test("ProactiveDaemon: tick evaluates system state and generates structured alerts", async () => {
  const daemon = new ProactiveDaemon({ enableSpokenAlerts: false });
  const result = await daemon.tick();

  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.alerts));
  assert.equal(typeof result.alertsGenerated, "number");

  const recent = daemon.getRecentAlerts();
  assert.ok(Array.isArray(recent));
});
