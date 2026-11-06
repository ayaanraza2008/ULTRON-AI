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
  return { gateway, device, deviceHub, deviceId, makeSocket };
}


function maskedTextFrame(value) {
  const payload = Buffer.from(value, "utf8");
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  if (payload.length > 125) throw new Error("test frame too large");
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
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

test("configured owner policy also protects the development-only legacy token path", async () => {
  const hub = {
    pairedDevices: new Map(),
    registerEventListener() { return () => {}; },
    findDeviceByToken() {
      return { id: "legacy-device", ownerUserId: "owner-b", status: "active" };
    }
  };
  const gateway = new DeviceWebSocketGateway({
    deviceHub: hub,
    env: { NODE_ENV: "development", ULTRON_OWNER_USER_ID: "owner-a" },
    logger: { warn() {}, error() {} }
  });

  assert.equal(await gateway.authenticateToken("legacy-token"), null);
  gateway.close();
});

test("a replaced WebSocket cannot execute commands from bytes already buffered by the runtime", async () => {
  const { gateway, deviceId, deviceHub, makeSocket } = makeGateway();
  let heartbeatCount = 0;
  deviceHub.heartbeat = () => { heartbeatCount += 1; return { success: true }; };
  const oldSession = {
    socket: makeSocket(),
    device: { id: deviceId, authToken: "old-device-token" },
    deviceId,
    authenticated: true,
    buffer: Buffer.alloc(0),
    pingTimer: null,
    authTimeout: null
  };
  const newSession = { socket: makeSocket(), pingTimer: null, authTimeout: null };
  gateway.registerConnectedClient(deviceId, oldSession);
  gateway.registerConnectedClient(deviceId, newSession);

  await gateway.handleSocketData(oldSession, maskedTextFrame(JSON.stringify({ type: "HEARTBEAT" })));
  assert.equal(heartbeatCount, 0);
  assert.equal(gateway.clients.get(deviceId), newSession);
  gateway.close();
});

test("a revoked WebSocket cannot execute frames after its close frame is sent", async () => {
  const { gateway, device, deviceId, deviceHub, makeSocket } = makeGateway();
  let heartbeatCount = 0;
  deviceHub.heartbeat = () => { heartbeatCount += 1; return { success: true }; };
  const session = {
    socket: makeSocket(),
    device: { id: deviceId, ownerUserId: device.ownerUserId, authToken: "device-token" },
    deviceId,
    authenticated: true,
    buffer: Buffer.alloc(0),
    pingTimer: null,
    authTimeout: null
  };
  gateway.registerConnectedClient(deviceId, session);

  // Revocation ends the socket, but a half-closed TCP socket may not yet
  // report destroyed; the session-level closed flag must block new frames.
  assert.equal(gateway.disconnectClient(deviceId, 1008, "Device access revoked", session), true);
  assert.equal(session.socket.destroyed, false);
  assert.equal(session.closed, true);

  await gateway.handleSocketData(session, maskedTextFrame(JSON.stringify({ type: "HEARTBEAT" })));
  assert.equal(heartbeatCount, 0);
  assert.equal(gateway.clients.has(deviceId), false);
  gateway.close();
});


test("a rejected device heartbeat is not acknowledged as success and closes the stale session", async () => {
  const { gateway, device, deviceId, deviceHub, makeSocket } = makeGateway();
  let heartbeatCount = 0;
  deviceHub.heartbeat = () => {
    heartbeatCount += 1;
    return { success: false, error: "AUTHENTICATION_FAILED" };
  };
  const socket = makeSocket();
  let socketEnded = false;
  socket.end = () => { socketEnded = true; };
  const session = {
    socket,
    device: { id: deviceId, ownerUserId: device.ownerUserId, authToken: "revoked-token" },
    deviceId,
    authenticated: true,
    buffer: Buffer.alloc(0),
    pingTimer: null,
    authTimeout: null
  };
  gateway.registerConnectedClient(deviceId, session);

  await gateway.handleSocketData(session, maskedTextFrame(JSON.stringify({ type: "HEARTBEAT" })));

  assert.equal(heartbeatCount, 1);
  assert.equal(session.closed, true);
  assert.equal(socketEnded, true);
  assert.equal(gateway.clients.has(deviceId), false);
  assert.equal(device.online, false);
  // AUTH_OK is written during registration; HEARTBEAT_ACK is followed by the close frame.
  const ackFrame = socket.writes[socket.writes.length - 2];
  assert.ok(ackFrame);
  assert.equal(ackFrame[0] & 0x0f, 0x1);
  const ackLength = ackFrame[1] & 0x7f;
  const ackJson = JSON.parse(ackFrame.subarray(2, 2 + ackLength).toString("utf8"));
  assert.equal(ackJson.type, "HEARTBEAT_ACK");
  assert.equal(ackJson.success, false);
  assert.equal(ackJson.error, "AUTHENTICATION_FAILED");
  gateway.close();
});

test("late WebSocket token verification cannot register a session after socket closure", async () => {
  const { gateway, deviceId, makeSocket } = makeGateway();
  let resolveAuthentication;
  gateway.authenticateToken = () => new Promise(resolve => { resolveAuthentication = resolve; });
  const session = {
    socket: makeSocket(),
    authenticated: false,
    deviceId: null,
    buffer: Buffer.alloc(0),
    pingTimer: null,
    authTimeout: null
  };

  const pending = gateway.handleClientMessage(session, JSON.stringify({
    type: "AUTH",
    token: "ultron_dev_test_token"
  }));
  await Promise.resolve();
  session.closed = true;
  resolveAuthentication({
    id: deviceId,
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    authToken: "ultron_dev_test_token",
    status: "active"
  });
  await pending;

  assert.equal(gateway.clients.has(deviceId), false);
  assert.equal(session.authenticated, false);
  gateway.close();
});
