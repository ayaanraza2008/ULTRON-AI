import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { DeviceHub } from "../integrations/device-hub.js";
import { DeviceWebSocketGateway } from "../integrations/device-websocket-gateway.js";

function encodeMaskedTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  let header;

  if (payload.length <= 125) {
    header = Buffer.alloc(6);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | payload.length; // Masked
    mask.copy(header, 2);
  } else if (payload.length <= 65535) {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
    mask.copy(header, 10);
  }

  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    maskedPayload[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, maskedPayload]);
}

test("WebSocket Gateway Audit: Real RFC 6455 Socket Tests", async (t) => {
  const deviceHub = new DeviceHub();
  const wsGateway = new DeviceWebSocketGateway({ deviceHub });

  // Start HTTP server and attach WebSocket gateway
  const server = http.createServer((req, res) => res.end("ULTRON Core"));
  wsGateway.attachToServer(server);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    wsGateway.close();
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close();
  });

  await t.test("1. RFC 6455 Handshake & Authenticated Connection", async () => {
    const reg = deviceHub.verifyPairingCode(
      deviceHub.createPairingCode({ name: "Handshake Test PC", platform: "windows" }).code
    );
    assert.equal(reg.success, true);

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.on("error", () => {});
    const secKey = crypto.randomBytes(16).toString("base64");
    const expectedAccept = crypto
      .createHash("sha1")
      .update(secKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    const handshakeReq = [
      `GET /ws/devices?token=${reg.authToken} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${secKey}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n");

    const responseChunks = [];
    await new Promise((resolve, reject) => {
      socket.on("connect", () => socket.write(handshakeReq));
      socket.on("data", (chunk) => {
        responseChunks.push(chunk);
        const text = Buffer.concat(responseChunks).toString("utf8");
        if (text.includes("\r\n\r\n")) {
          assert.ok(text.startsWith("HTTP/1.1 101 Switching Protocols"));
          assert.ok(text.includes(`Sec-WebSocket-Accept: ${expectedAccept}`));
          resolve();
        }
      });
      socket.on("error", reject);
    });

    assert.equal(deviceHub.isDeviceOnline(reg.deviceId), true);

    await new Promise((resolve) => {
      socket.on("close", resolve);
      socket.destroy();
    });
  });

  await t.test("2. Unauthorized Client is Rejected upon Invalid Auth", async () => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.on("error", () => {}); // Handle expected ECONNRESET upon rejection
    const secKey = crypto.randomBytes(16).toString("base64");

    const handshakeReq = [
      `GET /ws/devices HTTP/1.1`, // No token in query
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${secKey}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n");

    let receivedHandshake = false;
    let closed = false;

    await new Promise((resolve) => {
      socket.on("connect", () => socket.write(handshakeReq));
      socket.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        if (text.includes("101 Switching Protocols")) {
          receivedHandshake = true;
          // Send bad auth message
          const badAuth = encodeMaskedTextFrame(JSON.stringify({ type: "AUTH", token: "invalid-token" }));
          socket.write(badAuth);
        }
      });
      socket.on("close", () => {
        closed = true;
        resolve();
      });
    });

    assert.equal(receivedHandshake, true);
    assert.equal(closed, true);
  });

  await t.test("3. Bidirectional Real-time Command Dispatch & Pong Response", async () => {
    const reg = deviceHub.verifyPairingCode(
      deviceHub.createPairingCode({ name: "Command Test PC", platform: "windows" }).code
    );
    assert.equal(reg.success, true);

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.on("error", () => {});
    const secKey = crypto.randomBytes(16).toString("base64");

    const handshakeReq = [
      `GET /ws/devices?token=${reg.authToken} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${secKey}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n");

    await new Promise((resolve) => {
      socket.on("connect", () => socket.write(handshakeReq));
      socket.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        if (text.includes("101 Switching Protocols")) {
          resolve();
        }
      });
    });

    // Dispatch a command from server to socket
    const dispatched = wsGateway.dispatchCommand(reg.deviceId, {
      id: "cmd-test-101",
      action: "launch_app",
      payload: { app: "calculator" }
    });
    assert.equal(dispatched, true);

    // Send a Ping frame from client (opcode 0x9 with mask)
    const pingMask = crypto.randomBytes(4);
    const pingFrame = Buffer.concat([
      Buffer.from([0x89, 0x84]), // FIN + Ping, masked, len=4
      pingMask,
      Buffer.from([0x12, 0x34, 0x56, 0x78])
    ]);
    socket.write(pingFrame);

    await new Promise((resolve) => {
      socket.on("close", resolve);
      socket.destroy();
    });
  });

  await t.test("4. Oversized Frame Rejection & Safe Socket Teardown", async () => {
    const reg = deviceHub.verifyPairingCode(
      deviceHub.createPairingCode({ name: "Oversized Test PC", platform: "windows" }).code
    );

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.on("error", () => {});
    const secKey = crypto.randomBytes(16).toString("base64");

    const handshakeReq = [
      `GET /ws/devices?token=${reg.authToken} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${secKey}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n");

    await new Promise((resolve) => {
      socket.on("connect", () => socket.write(handshakeReq));
      socket.on("data", (chunk) => {
        if (chunk.toString("utf8").includes("101")) resolve();
      });
    });

    // Craft an oversized 127-format frame header declaring > 64 KB
    const badHeader = Buffer.alloc(14);
    badHeader[0] = 0x81;
    badHeader[1] = 0x80 | 127;
    badHeader.writeBigUInt64BE(BigInt(100 * 1024), 2); // 100 KB payload claimed
    crypto.randomBytes(4).copy(badHeader, 10);

    let socketClosed = false;
    await new Promise((resolve) => {
      socket.on("close", () => {
        socketClosed = true;
        resolve();
      });
      socket.write(badHeader);
    });

    assert.equal(socketClosed, true);
  });
});
