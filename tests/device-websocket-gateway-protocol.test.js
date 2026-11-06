import test from "node:test";
import assert from "node:assert/strict";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";

function makeGateway() {
  return new DeviceWebSocketGateway({
    deviceHub: { registerEventListener() { return () => {}; } },
    logger: { warn() {}, error() {} }
  });
}

function clientFrame(payload, {
  opcode = 0x1,
  masked = true,
  fin = true,
  reserved = 0
} = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const first = (fin ? 0x80 : 0) | reserved | opcode;
  const maskBit = masked ? 0x80 : 0;
  let header;
  if (body.length <= 125) {
    header = Buffer.from([first, maskBit | body.length]);
  } else if (body.length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = maskBit | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    throw new Error("test helper payload too large");
  }
  if (!masked) return Buffer.concat([header, body]);
  const maskedBody = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) maskedBody[i] = body[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, maskedBody]);
}

async function assertRejected(frame) {
  const gateway = makeGateway();
  const socket = {
    destroyed: false,
    destroy() { this.destroyed = true; },
    write() {}
  };
  const session = { socket, buffer: Buffer.alloc(0), authenticated: false, deviceId: null };
  await gateway.handleSocketData(session, frame);
  assert.equal(socket.destroyed, true);
  gateway.close();
}

test("WebSocket gateway rejects unmasked client frames", async () => {
  await assertRejected(clientFrame("{}", { masked: false }));
});

test("WebSocket gateway rejects reserved bits and fragmented messages", async () => {
  await assertRejected(clientFrame("{}", { reserved: 0x40 }));
  await assertRejected(clientFrame("{}", { fin: false }));
});

test("WebSocket gateway rejects unsupported opcodes", async () => {
  await assertRejected(clientFrame("binary", { opcode: 0x2 }));
  await assertRejected(clientFrame("continuation", { opcode: 0x0 }));
});

test("WebSocket gateway rejects oversized control frames", async () => {
  await assertRejected(clientFrame(Buffer.alloc(126), { opcode: 0x9 }));
});

test("WebSocket gateway accepts a correctly masked text frame", async () => {
  const gateway = makeGateway();
  const writes = [];
  const socket = {
    destroyed: false,
    destroy() { this.destroyed = true; },
    write(data) { writes.push(data); }
  };
  const session = { socket, buffer: Buffer.alloc(0), authenticated: false, deviceId: null };
  await gateway.handleSocketData(session, clientFrame(JSON.stringify({ type: "HEARTBEAT" })));
  assert.equal(socket.destroyed, false);
  assert.equal(writes.length, 1);
  gateway.close();
});
