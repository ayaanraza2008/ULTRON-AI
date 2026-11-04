import test from "node:test";
import assert from "node:assert/strict";
import { DeviceHub } from "../integrations/device-hub.js";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";

const SECRET = "device-hub-owner-isolation-test-secret-at-least-32-chars";

function pair(hub, ownerUserId, name, platform) {
  const pending = hub.createPairingCode({ name, platform });
  const paired = hub.verifyPairingCode(pending.code, null, ownerUserId);
  assert.equal(paired.success, true);
  assert.equal(hub.heartbeat(paired.deviceId, paired.authToken).success, true);
  return paired;
}

test("WebSocket presence, task results, and messages are isolated per owner", () => {
  const hub = new DeviceHub({ env: { ULTRON_DEVICE_SIGNING_SECRET: SECRET } });
  const ownerATarget = pair(hub, "owner-a", "Owner A PC", "windows");
  const ownerAClient = pair(hub, "owner-a", "Owner A Phone", "android");
  const ownerBClient = pair(hub, "owner-b", "Owner B Phone", "android");
  const gateway = new DeviceWebSocketGateway({ deviceHub: hub, pingIntervalMs: 60_000 });

  const received = new Map();
  for (const paired of [ownerAClient, ownerBClient]) {
    const frames = [];
    received.set(paired.deviceId, frames);
    gateway.clients.set(paired.deviceId, {
      device: hub.pairedDevices.get(paired.deviceId),
      socket: {
        write(frame) { frames.push(Buffer.from(frame)); return true; },
        end() { return true; },
        destroy() { return true; }
      },
      pingTimer: null
    });
  }

  const frameCount = id => received.get(id).length;
  gateway.broadcastPresence(ownerATarget.deviceId, true);
  assert.equal(frameCount(ownerAClient.deviceId), 1);
  assert.equal(frameCount(ownerBClient.deviceId), 0);

  received.get(ownerAClient.deviceId).length = 0;
  gateway.handleDeviceHubEvent({
    type: "COMMAND_COMPLETE",
    deviceId: ownerATarget.deviceId,
    commandId: "cmd-owner-a",
    status: "completed",
    result: { ok: true }
  });
  assert.equal(frameCount(ownerAClient.deviceId), 1);
  assert.equal(frameCount(ownerBClient.deviceId), 0);

  received.get(ownerAClient.deviceId).length = 0;
  hub.recordSharedMessage({
    ownerUserId: "owner-a",
    source: "ULTRON",
    platform: "android",
    content: "private message for owner A"
  });
  assert.equal(frameCount(ownerAClient.deviceId), 1);
  assert.equal(frameCount(ownerBClient.deviceId), 0);

  gateway.close();
});
