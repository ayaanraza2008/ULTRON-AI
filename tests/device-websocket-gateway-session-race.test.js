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

test("an authenticated WebSocket cannot rebind itself with a second device AUTH token", async () => {
  const { gateway, deviceId, makeSocket } = makeGateway();
  let authenticationAttempted = false;
  gateway.authenticateToken = async () => {
    authenticationAttempted = true;
    return { id: "another-device", ownerUserId: "another-owner", authToken: "token" };
  };
  const session = {
    socket: makeSocket(),
    device: { id: deviceId, ownerUserId: "00000000-0000-4000-8000-000000000001" },
    deviceId,
    authenticated: true,
    buffer: Buffer.alloc(0),
    pingTimer: null,
    authTimeout: null
  };
  gateway.clients.set(deviceId, session);

  await gateway.handleClientMessage(session, JSON.stringify({
    type: "AUTH",
    token: "another-valid-device-token"
  }));

  assert.equal(authenticationAttempted, false);
  assert.equal(session.socket.destroyed, true);
  assert.equal(gateway.clients.get(deviceId), session);
  gateway.close();
});

test("production WebSocket authentication rejects a paired device outside the configured owner", async () => {
  const hub = {
    pairedDevices: new Map(),
    registerEventListener() { return () => {}; },
    importPairedDevice(record) { this.imported = record; return record; }
  };
  const gateway = new DeviceWebSocketGateway({
    deviceHub: hub,
    env: { NODE_ENV: "production", ULTRON_OWNER_USER_ID: "owner-a" },
    authenticateDeviceToken: async () => ({
      id: "device-b",
      ownerUserId: "owner-b",
      status: "active"
    }),
    logger: { warn() {}, error() {} }
  });

  const result = await gateway.authenticateToken("ultron_dev_" + "a".repeat(64));
  assert.equal(result, null);
  assert.equal(hub.imported, undefined);
  gateway.close();
});

test("production WebSocket authentication accepts a device belonging to the configured owner", async () => {
  const hub = {
    pairedDevices: new Map(),
    registerEventListener() { return () => {}; },
    importPairedDevice(record) { this.imported = record; return record; }
  };
  const gateway = new DeviceWebSocketGateway({
    deviceHub: hub,
    env: { NODE_ENV: "production", ULTRON_OWNER_USER_ID: "owner-a" },
    authenticateDeviceToken: async () => ({
      id: "device-a",
      ownerUserId: "owner-a",
      status: "active"
    }),
    logger: { warn() {}, error() {} }
  });

  const result = await gateway.authenticateToken("ultron_dev_" + "a".repeat(64));
  assert.equal(result.ownerUserId, "owner-a");
  assert.equal(hub.imported.ownerUserId, "owner-a");
  gateway.close();
});
