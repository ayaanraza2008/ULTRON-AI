import test from "node:test";
import assert from "node:assert/strict";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";

function createSocket() {
  return {
    writes: [],
    destroyed: false,
    write(value) { this.writes.push(String(value)); },
    destroy() { this.destroyed = true; }
  };
}

test("WebSocket gateway rejects device tokens in URL query strings", async () => {
  let authenticationCalls = 0;
  const gateway = new DeviceWebSocketGateway({
    deviceHub: {
      pairedDevices: new Map(),
      registerEventListener() { return () => {}; }
    },
    authenticateDeviceToken() {
      authenticationCalls += 1;
      return { id: "device-1", ownerUserId: "owner-1" };
    },
    logger: { warn() {}, info() {}, error() {} }
  });
  const socket = createSocket();

  try {
    await gateway.handleUpgrade({
      url: "/ws/devices?token=ultron_dev_sensitive_value",
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        connection: "keep-alive, Upgrade",
        upgrade: "websocket"
      }
    }, socket, Buffer.alloc(0));

    assert.equal(authenticationCalls, 0, "URL credentials must not reach the authenticator");
    assert.equal(socket.destroyed, true, "the connection must be closed");
    assert.match(socket.writes.join(""), /^HTTP\/1\.1 400 Bad Request/);
  } finally {
    gateway.close();
  }
});


test("WebSocket gateway rejects unsupported protocol versions", async () => {
  const gateway = new DeviceWebSocketGateway({
    deviceHub: { pairedDevices: new Map(), registerEventListener() { return () => {}; } },
    logger: { warn() {}, info() {}, error() {} }
  });
  const socket = createSocket();
  try {
    await gateway.handleUpgrade({
      url: "/ws/devices",
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "12",
        connection: "Upgrade",
        upgrade: "websocket"
      }
    }, socket, Buffer.alloc(0));
    assert.equal(socket.destroyed, true);
    assert.match(socket.writes.join(""), /^HTTP\/1\.1 426 Upgrade Required/);
    assert.match(socket.writes.join(""), /Sec-WebSocket-Version: 13/);
  } finally {
    gateway.close();
  }
});
