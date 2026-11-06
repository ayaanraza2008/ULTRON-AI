import test from "node:test";
import assert from "node:assert/strict";
import { DeviceHub } from "../integrations/device-hub.js";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";

for (const eventType of ["DEVICE_CREDENTIALS_ROTATED", "DEVICE_REVOKED"]) {
  test(`WebSocket and SSE sessions close immediately after ${eventType}`, () => {
    const hub = new DeviceHub({ env: {} });
    const deviceId = "00000000-0000-4000-8000-000000000010";
    const ownerUserId = "00000000-0000-4000-8000-000000000001";
    hub.pairedDevices.set(deviceId, {
      id: deviceId,
      ownerUserId,
      status: "active",
      online: true,
      lastSeenAt: new Date().toISOString()
    });

    const gateway = new DeviceWebSocketGateway({
      deviceHub: hub,
      logger: { warn() {}, error() {} }
    });
    let socketEnded = false;
    let sseEnded = false;
    gateway.clients.set(deviceId, {
      device: { id: deviceId, ownerUserId },
      socket: { write() {}, end() { socketEnded = true; } },
      pingTimer: null,
      authTimeout: null
    });
    gateway.sseClients.set(deviceId, new Set([{
      write() {},
      end() { sseEnded = true; }
    }]));

    const mutation = eventType === "DEVICE_REVOKED"
      ? hub.revokeDevice(deviceId, ownerUserId)
      : hub.rotateDeviceToken(deviceId, ownerUserId);
    assert.equal(mutation.success, true);

    assert.equal(socketEnded, true);
    assert.equal(sseEnded, true);
    assert.equal(gateway.clients.has(deviceId), false);
    assert.equal(gateway.sseClients.has(deviceId), false);
    assert.equal(hub.pairedDevices.get(deviceId).online, false);
    gateway.close();
  });
}

test("credential invalidation event cannot disconnect a different owner's session", () => {
  const hub = new DeviceHub({ env: {} });
  const deviceId = "00000000-0000-4000-8000-000000000011";
  const ownerUserId = "00000000-0000-4000-8000-000000000001";
  hub.pairedDevices.set(deviceId, { id: deviceId, ownerUserId, status: "active", online: true });
  const gateway = new DeviceWebSocketGateway({ deviceHub: hub, logger: { warn() {}, error() {} } });
  let socketEnded = false;
  gateway.clients.set(deviceId, {
    device: { id: deviceId, ownerUserId: "another-owner" },
    socket: { write() {}, end() { socketEnded = true; } },
    pingTimer: null,
    authTimeout: null
  });

  hub.emitEvent({ type: "DEVICE_REVOKED", deviceId, ownerUserId });
  assert.equal(socketEnded, false);
  assert.equal(gateway.clients.has(deviceId), true);
  gateway.close();
});
