import test from "node:test";
import assert from "node:assert/strict";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";

function makeGateway() {
  const deviceId = "00000000-0000-4000-8000-000000000021";
  const device = {
    id: deviceId,
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    status: "active",
    online: false
  };
  const deviceHub = {
    pairedDevices: new Map([[deviceId, device]]),
    registerEventListener() { return () => {}; }
  };
  const gateway = new DeviceWebSocketGateway({
    deviceHub,
    logger: { warn() {}, error() {} }
  });
  const makeSocket = () => ({
    destroyed: false,
    writes: [],
    write(data) { this.writes.push(data); },
    destroy() { this.destroyed = true; },
    end() {}
  });
  return { gateway, device, deviceId, makeSocket };
}

test("a replaced WebSocket closing cannot remove its successor or mark the device offline", () => {
  const { gateway, device, deviceId, makeSocket } = makeGateway();
  const oldSession = { socket: makeSocket(), pingTimer: null, authTimeout: null };
  const newSession = { socket: makeSocket(), pingTimer: null, authTimeout: null };

  gateway.registerConnectedClient(deviceId, oldSession);
  gateway.registerConnectedClient(deviceId, newSession);

  assert.equal(oldSession.socket.destroyed, true);
  assert.equal(gateway.clients.get(deviceId), newSession);
  assert.equal(device.online, true);

  // This is the delayed close callback from the replaced socket.
  assert.equal(gateway.disconnectClient(deviceId, 1000, "", oldSession), false);
  assert.equal(gateway.clients.get(deviceId), newSession);
  assert.equal(device.online, true);

  gateway.close();
});

test("the current WebSocket session can still disconnect normally", () => {
  const { gateway, device, deviceId, makeSocket } = makeGateway();
  const session = { socket: makeSocket(), pingTimer: null, authTimeout: null };

  gateway.registerConnectedClient(deviceId, session);
  assert.equal(gateway.disconnectClient(deviceId, 1000, "", session), true);
  assert.equal(gateway.clients.has(deviceId), false);
  assert.equal(device.online, false);

  gateway.close();
});
