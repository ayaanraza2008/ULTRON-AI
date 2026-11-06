/**
 * ULTRON AI — Multi-Device Real-Time WebSocket & SSE Gateway
 * 
 * Implements high-performance, zero-external-dependency RFC 6455 WebSocket server
 * and Server-Sent Events (SSE) streaming for Windows and Android companion devices:
 * - Direct bidirectional low-latency communication.
 * - Authenticated device socket management with cryptographic token verification.
 * - Instant command push and completion reporting.
 * - Real-time device presence, heartbeats, and telemetry streaming.
 * - Safe frame framing, unmasking, size limiting (64 KB cap), and connection recovery.
 */

import crypto, { createHash } from "node:crypto";
import { deviceHub as defaultDeviceHub } from "./device-hub.js";
import { verifyPairedDeviceToken } from "./device-pairing-router.js";

const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_PAYLOAD = 64 * 1024; // 64 KB safety limit per frame

function createAcceptKey(key) {
  return createHash("sha1").update(String(key) + WS_MAGIC_STRING).digest("base64");
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f); // FIN + opcode
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function parseFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const isFinal = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) !== 0;

  // This gateway negotiates no extensions and supports complete text/control
  // frames only. Reject malformed or unsupported client frames before parsing
  // their payload so protocol ambiguity cannot reach the command handler.
  if ((firstByte & 0x70) !== 0) throw new Error("WebSocket reserved bits must be zero.");
  if (![0x1, 0x8, 0x9, 0xa].includes(opcode)) throw new Error("Unsupported WebSocket opcode.");
  if (!isMasked) throw new Error("Client WebSocket frames must be masked.");
  if (!isFinal) throw new Error("Fragmented WebSocket frames are not supported.");

  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    if (payloadLength < 126) throw new Error("Non-canonical WebSocket payload length.");
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    const bigLen = buffer.readBigUInt64BE(2);
    if (bigLen < 65536n || bigLen > BigInt(MAX_FRAME_PAYLOAD)) {
      throw new Error("Invalid or oversized WebSocket payload length.");
    }
    payloadLength = Number(bigLen);
    offset = 10;
  }

  if ([0x8, 0x9, 0xa].includes(opcode) && payloadLength > 125) {
    throw new Error("WebSocket control frames cannot exceed 125 bytes.");
  }

  let maskingKey = null;
  if (isMasked) {
    if (buffer.length < offset + 4) return null;
    maskingKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) return null;

  const rawPayload = buffer.slice(offset, offset + payloadLength);
  let payload = rawPayload;

  if (isMasked && maskingKey) {
    payload = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = rawPayload[i] ^ maskingKey[i % 4];
    }
  }

  const totalLength = offset + payloadLength;
  return {
    isFinal,
    opcode,
    payload,
    totalLength
  };
}

export class DeviceWebSocketGateway {
  constructor(options = {}) {
    this.deviceHub = options.deviceHub || defaultDeviceHub;
    this.logger = options.logger || console;
    this.env = options.env || process.env;
    this.authenticateDeviceToken = options.authenticateDeviceToken ||
      (String(this.env.NODE_ENV || "").toLowerCase() === "production"
        ? token => verifyPairedDeviceToken({ token, env: this.env, logger: this.logger })
        : null);
    this.clients = new Map(); // deviceId -> ClientSession
    this.sseClients = new Map(); // deviceId -> Set(res)
    this.pingIntervalMs = options.pingIntervalMs || 30_000;
    this.stateSyncAckHandler = null;
    this.attachedServer = null;
    this.upgradeHandler = null;

    // Listen to DeviceHub events for instant dispatch
    this.unsubscribeHub = this.deviceHub.registerEventListener(event => this.handleDeviceHubEvent(event));
  }

  /**
   * Registers the owner-scoped handler used after an authenticated device
   * acknowledges a queued state-sync delivery.
   */
  setStateSyncAckHandler(handler) {
    this.stateSyncAckHandler = typeof handler === "function" ? handler : null;
  }

  /**
   * Attaches the RFC 6455 WebSocket Upgrade handler to a Node.js http.Server.
   */
  attachToServer(server) {
    if (!server || typeof server.on !== "function") return;
    this.attachedServer = server;

    this.upgradeHandler = (req, socket, head) => {
      this.handleUpgrade(req, socket, head).catch(error => {
        this.logger.warn?.("Device WebSocket authentication failed", { name: error?.name || "Error" });
        try { socket.destroy(); } catch {}
      });
    };

    server.on("upgrade", this.upgradeHandler);
  }

  /**
   * Detaches from the server and closes all active sockets cleanly.
   */
  close() {
    if (this.attachedServer && this.upgradeHandler) {
      this.attachedServer.removeListener("upgrade", this.upgradeHandler);
      this.attachedServer = null;
    }
    if (typeof this.unsubscribeHub === "function") {
      this.unsubscribeHub();
    }
    for (const [deviceId, client] of this.clients.entries()) {
      this.disconnectClient(deviceId, 1001, "Server shutdown");
    }
    for (const [deviceId, set] of this.sseClients.entries()) {
      for (const res of set) {
        try { res.end(); } catch {}
      }
    }
    this.clients.clear();
    this.sseClients.clear();
  }

  /**
   * Resolves a device through the durable registry if the server provides one.
   * A failed durable lookup never falls back to an old process-local token.
   */
  async authenticateToken(token) {
    if (typeof this.authenticateDeviceToken === "function") {
      const verified = await this.authenticateDeviceToken(token);
      if (!verified) return null;

      // The production gateway is an independent WebSocket entry point; it
      // must enforce the same single-owner boundary as the REST pairing routes.
      const configuredOwnerId = String(
        this.env.ULTRON_OWNER_USER_ID || this.env.ULTRON_INTEGRATION_OWNER_USER_ID || ""
      ).trim();
      const verifiedOwnerId = String(verified.ownerUserId || verified.owner_user_id || "").trim();
      const isProduction = String(this.env.NODE_ENV || "").toLowerCase() === "production";
      if ((isProduction && !configuredOwnerId) ||
          (configuredOwnerId && verifiedOwnerId !== configuredOwnerId)) {
        this.logger.warn?.("Device WebSocket authentication rejected by owner policy", {
          code: "ULTRON_OWNER_ONLY"
        });
        return null;
      }

      return this.deviceHub.importPairedDevice({ ...verified, authToken: token });
    }
    // The development-only process-local token path is still subject to an
    // explicitly configured owner boundary; it must not bypass single-owner
    // policy merely because the durable Supabase verifier is disabled.
    const legacyDevice = this.deviceHub.findDeviceByToken(token);
    if (!legacyDevice) return null;
    const configuredOwnerId = String(
      this.env.ULTRON_OWNER_USER_ID || this.env.ULTRON_INTEGRATION_OWNER_USER_ID || ""
    ).trim();
    const isProduction = String(this.env.NODE_ENV || "").toLowerCase() === "production";
    const legacyOwnerId = String(legacyDevice.ownerUserId || legacyDevice.owner_user_id || "").trim();
    if ((isProduction && !configuredOwnerId) ||
        (configuredOwnerId && legacyOwnerId !== configuredOwnerId)) {
      return null;
    }
    return legacyDevice;
  }

  /**
   * Handles HTTP Upgrade request for WebSocket connection.
   */
  async handleUpgrade(req, socket, head) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    // Match supported WebSocket paths
    if (pathname !== "/ws/devices" && pathname !== "/api/devices/ws" && pathname !== "/api/jarvis/ws") {
      return; // Leave for other upgrade handlers if any
    }

    const wsKey = typeof req.headers["sec-websocket-key"] === "string"
      ? req.headers["sec-websocket-key"].trim()
      : "";
    if (req.headers["sec-websocket-version"] !== "13") {
      socket.write("HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const decodedWsKey = Buffer.from(wsKey, "base64");
    const validWsKey = decodedWsKey.length === 16 && decodedWsKey.toString("base64") === wsKey;
    const hasConnectionUpgrade = String(req.headers.connection || "")
      .split(",")
      .some(value => value.trim().toLowerCase() === "upgrade");
    if (!validWsKey || req.headers.upgrade?.toLowerCase() !== "websocket" || !hasConnectionUpgrade) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    // Device credentials must never be accepted in URLs: query strings can be
    // retained by reverse proxies, access logs, browser history, and diagnostics.
    // Companion clients must use the dedicated header or the authenticated AUTH frame.
    if (url.searchParams.has("token")) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate device token from headers only.
    let token = req.headers["x-device-token"];
    if (!token && req.headers.authorization) {
      const match = req.headers.authorization.match(/^Bearer\s+(.+)$/i);
      if (match) token = match[1].trim();
    }

    let device = null;
    if (token) {
      device = await this.authenticateToken(token);
    }

    // Perform RFC 6455 Handshake
    const acceptKey = createAcceptKey(wsKey);
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n"
    ].join("\r\n");

    socket.write(responseHeaders);

    const clientSession = {
      socket,
      closed: false,
      device: device || null,
      deviceId: device?.id || null,
      authenticated: Boolean(device),
      buffer: Buffer.alloc(0),
      pingTimer: null,
      lastPong: Date.now()
    };

    if (device) {
      this.registerConnectedClient(device.id, clientSession);
    } else {
      // Allow unauthenticated connection with a 5-second grace period to send AUTH frame
      clientSession.authTimeout = setTimeout(() => {
        if (!clientSession.authenticated) {
          this.sendFrame(socket, { type: "AUTH_FAILED", error: "AUTH_TIMEOUT" });
          socket.destroy();
        }
      }, 5000);
    }

    socket.on("data", chunk => {
      this.handleSocketData(clientSession, chunk).catch(() => socket.destroy());
    });

    socket.on("close", () => {
      clientSession.closed = true;
      if (clientSession.authTimeout) {
        clearTimeout(clientSession.authTimeout);
        clientSession.authTimeout = null;
      }
      if (clientSession.pingTimer) {
        clearInterval(clientSession.pingTimer);
        clientSession.pingTimer = null;
      }
      if (clientSession.deviceId) {
        // A replaced socket may emit "close" after its successor is already
        // registered. Only the currently registered session may clear presence.
        this.disconnectClient(clientSession.deviceId, 1000, "", clientSession);
      }
    });

    socket.on("error", () => {
      socket.destroy();
    });

    // Start periodic ping keep-alive
    clientSession.pingTimer = setInterval(() => {
      try {
        socket.write(encodeFrame(Buffer.alloc(0), 0x9)); // Ping frame
        // If no pong in 2x ping interval, close connection
        if (Date.now() - clientSession.lastPong > this.pingIntervalMs * 2.5) {
          socket.destroy();
        }
      } catch {
        socket.destroy();
      }
    }, this.pingIntervalMs);

    if (head && head.length > 0) {
      await this.handleSocketData(clientSession, head);
    }
  }

  /**
   * Registers an authenticated WebSocket client session.
   */
  registerConnectedClient(deviceId, clientSession) {
    // If client already connected, clean up previous
    if (this.clients.has(deviceId)) {
      const old = this.clients.get(deviceId);
      old.closed = true;
      try { old.socket.destroy(); } catch {}
      clearInterval(old.pingTimer);
    }

    clientSession.deviceId = deviceId;
    this.clients.set(deviceId, clientSession);

    // Update DeviceHub presence
    const dev = this.deviceHub.pairedDevices.get(deviceId);
    if (dev) {
      dev.online = true;
      dev.lastSeenAt = new Date().toISOString();
    }

    this.sendFrame(clientSession.socket, {
      type: "AUTH_OK",
      deviceId,
      deviceName: dev?.name || "Companion Device",
      platform: dev?.platform || "windows",
      serverTimestamp: new Date().toISOString()
    });

    // Broadcast presence update
    this.broadcastPresence(deviceId, true);
  }

  /**
   * Disconnects a client and cleans up timers.
   */
  disconnectClient(deviceId, code = 1000, reason = "", expectedSession = null) {
    const client = this.clients.get(deviceId);
    if (!client || (expectedSession && client !== expectedSession)) return false;

    client.closed = true;
    clearInterval(client.pingTimer);
    clearTimeout(client.authTimeout);

    try {
      const closePayload = Buffer.alloc(2 + Buffer.byteLength(reason));
      closePayload.writeUInt16BE(code, 0);
      closePayload.write(reason, 2);
      client.socket.write(encodeFrame(closePayload, 0x8));
      client.socket.end();
    } catch {}

    this.clients.delete(deviceId);

    // Update DeviceHub presence
    const dev = this.deviceHub.pairedDevices.get(deviceId);
    if (dev) {
      dev.online = false;
      dev.lastSeenAt = new Date().toISOString();
    }

    this.broadcastPresence(deviceId, false);
    return true;
  }

  /**
   * Processes incoming data chunks from a client socket.
   */
  async handleSocketData(clientSession, chunk) {
    // A superseded or explicitly closed socket must not process bytes that
    // were already queued by the runtime before its close event was delivered.
    if (clientSession.closed || clientSession.socket?.destroyed) return;
    clientSession.buffer = Buffer.concat([clientSession.buffer, chunk]);

    while (clientSession.buffer.length > 0 && !clientSession.closed && !clientSession.socket?.destroyed) {
      let frame;
      try {
        frame = parseFrame(clientSession.buffer);
      } catch (err) {
        clientSession.socket.destroy();
        return;
      }

      if (!frame) break; // Incomplete frame, wait for more data

      clientSession.buffer = clientSession.buffer.slice(frame.totalLength);

      // Handle Ping (opcode 0x9) -> respond with Pong (opcode 0xA)
      if (frame.opcode === 0x9) {
        try { clientSession.socket.write(encodeFrame(frame.payload, 0xa)); } catch {}
        continue;
      }

      // Handle Pong (opcode 0xA)
      if (frame.opcode === 0xa) {
        clientSession.lastPong = Date.now();
        continue;
      }

      // Handle Close (opcode 0x8)
      if (frame.opcode === 0x8) {
        if (clientSession.deviceId) {
          this.disconnectClient(clientSession.deviceId, 1000, "", clientSession);
        } else {
          clientSession.socket.destroy();
        }
        return;
      }

      // Handle Text Frame (opcode 0x1)
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString("utf8");
        await this.handleClientMessage(clientSession, text);
        if (clientSession.socket?.destroyed) return;
      }
    }
  }

  /**
   * Handles incoming JSON messages from a companion client.
   */
  async handleClientMessage(clientSession, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    // 1. Auth Message. Authentication is a one-way state transition: an
    // already authenticated socket must never be rebound to another device.
    if (msg.type === "AUTH" && msg.token) {
      if (clientSession.authenticated || clientSession.deviceId) {
        this.sendFrame(clientSession.socket, { type: "ERROR", error: "REAUTHENTICATION_NOT_ALLOWED" });
        clientSession.socket.destroy();
        return;
      }
      const device = await this.authenticateToken(msg.token);
      if (!device) {
        this.sendFrame(clientSession.socket, { type: "AUTH_FAILED", error: "INVALID_DEVICE_TOKEN" });
        clientSession.socket.destroy();
        return;
      }
      clearTimeout(clientSession.authTimeout);
      clientSession.authenticated = true;
      clientSession.device = device;
      this.registerConnectedClient(device.id, clientSession);
      return;
    }

    if (!clientSession.authenticated || !clientSession.deviceId) {
      this.sendFrame(clientSession.socket, { type: "ERROR", error: "UNAUTHENTICATED" });
      return;
    }

    const deviceId = clientSession.deviceId;
    const token = clientSession.device?.authToken;

    // 2. Heartbeat & Telemetry
    if (msg.type === "HEARTBEAT") {
      this.deviceHub.heartbeat(deviceId, token, msg.telemetry || {});
      this.sendFrame(clientSession.socket, { type: "HEARTBEAT_ACK", timestamp: Date.now() });
      return;
    }

    // 3. Acknowledge owner-scoped state-sync delivery. The paired session
    // supplies device and owner identity; clients cannot ACK another device.
    if (msg.type === "STATE_SYNC_ACK" && msg.deliveryId) {
      const ownerUserId = clientSession.device?.ownerUserId;
      let outcome = { success: false, error: "STATE_SYNC_ACK_NOT_CONFIGURED" };
      if (ownerUserId && typeof this.stateSyncAckHandler === "function") {
        try {
          outcome = await this.stateSyncAckHandler({
            deviceId,
            ownerUserId,
            deliveryId: String(msg.deliveryId)
          });
        } catch {
          outcome = { success: false, error: "STATE_SYNC_ACK_FAILED" };
        }
      }
      this.sendFrame(clientSession.socket, {
        type: "STATE_SYNC_ACK_RESULT",
        deliveryId: msg.deliveryId,
        success: Boolean(outcome?.success && outcome?.acknowledged),
        ...(outcome?.error ? { error: outcome.error } : {})
      });
      return;
    }

    // 4. Command Completion
    if (msg.type === "COMMAND_COMPLETE" && msg.commandId) {
      const outcome = this.deviceHub.completeCommand(deviceId, msg.commandId, token, msg.result || {});
      this.sendFrame(clientSession.socket, { type: "COMMAND_COMPLETE_ACK", commandId: msg.commandId, success: outcome.success });
      return;
    }

    // 4. Client Request to Route Command (e.g. Android requesting Windows action)
    if (msg.type === "ROUTE_COMMAND" && msg.action) {
      const routeResult = this.deviceHub.routeCommand({
        callerDeviceId: deviceId,
        callerToken: token,
        targetDeviceId: msg.targetDeviceId,
        targetPlatform: msg.targetPlatform,
        action: msg.action,
        payload: msg.payload || {},
        idempotencyKey: msg.idempotencyKey || null
      });
      this.sendFrame(clientSession.socket, {
        type: "ROUTE_COMMAND_RESPONSE",
        requestId: msg.requestId || null,
        ...routeResult
      });
    }
  }

  /**
   * Sends a JSON message over a raw WebSocket.
   */
  sendFrame(socket, payload) {
    try {
      const json = typeof payload === "string" ? payload : JSON.stringify(payload);
      socket.write(encodeFrame(json, 0x1));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pushes a command to a connected device in real-time.
   */
  dispatchCommand(deviceId, command) {
    const client = this.clients.get(deviceId);
    if (client && client.socket) {
      return this.sendFrame(client.socket, {
        type: "COMMAND_DISPATCH",
        command
      });
    }

    // If client has SSE subscriber, push via SSE
    const sseSet = this.sseClients.get(deviceId);
    if (sseSet && sseSet.size > 0) {
      for (const res of sseSet) {
        try {
          res.write(`event: command\ndata: ${JSON.stringify(command)}\n\n`);
        } catch {}
      }
      return true;
    }

    return false;
  }

  /**
   * Delivers a state synchronization event only to authenticated, paired
   * sessions belonging to the supplied owner. Returns actual delivery
   * acknowledgements from the local WebSocket/SSE transport.
   */
  dispatchStateSync({ ownerUserId, deviceIds = [], event } = {}) {
    if (typeof ownerUserId !== "string" || !ownerUserId.trim() || !Array.isArray(deviceIds) || !event) {
      return { success: false, error: "STATE_SYNC_ARGUMENTS_INVALID", deliveredDeviceIds: [] };
    }

    const sentDeviceIds = [];
    const uniqueIds = [...new Set(deviceIds.map(id => String(id || "").trim()).filter(Boolean))];
    for (const deviceId of uniqueIds) {
      const paired = this.deviceHub.pairedDevices.get(deviceId);
      if (!paired || paired.status === "revoked" || paired.ownerUserId !== ownerUserId) continue;

      const client = this.clients.get(deviceId);
      if (client?.authenticated && client.device?.ownerUserId === ownerUserId && client.socket) {
        if (this.sendFrame(client.socket, { type: "STATE_SYNC", event })) {
          sentDeviceIds.push(deviceId);
          continue;
        }
      }

      const sseSet = this.sseClients.get(deviceId);
      if (sseSet && sseSet.size > 0) {
        let sent = false;
        for (const res of sseSet) {
          try {
            res.write(`event: state-sync\ndata: ${JSON.stringify({ type: "STATE_SYNC", event })}\n\n`);
            sent = true;
          } catch {}
        }
        if (sent) sentDeviceIds.push(deviceId);
      }
    }

    return { success: true, sentDeviceIds };
  }

  /**
   * Broadcasts presence changes to all connected owner devices.
   */
  broadcastPresence(deviceId, online) {
    const sourceDevice = this.deviceHub.pairedDevices.get(deviceId);
    const ownerUserId = sourceDevice?.ownerUserId;
    if (!ownerUserId) return;

    const payload = {
      type: "DEVICE_PRESENCE",
      deviceId,
      online,
      timestamp: new Date().toISOString()
    };

    for (const [id, client] of this.clients.entries()) {
      if (id !== deviceId && client.device?.ownerUserId === ownerUserId) {
        this.sendFrame(client.socket, payload);
      }
    }

    for (const [id, set] of this.sseClients.entries()) {
      const subscriber = this.deviceHub.pairedDevices.get(id);
      if (id !== deviceId && subscriber?.ownerUserId === ownerUserId) {
        for (const res of set) {
          try { res.write(`event: presence\ndata: ${JSON.stringify(payload)}\n\n`); } catch {}
        }
      }
    }
  }

  /**
   * Handles DeviceHub internal events.
   */
  handleDeviceHubEvent(event) {
    if (!event) return;

    if ((event.type === "DEVICE_REVOKED" || event.type === "DEVICE_CREDENTIALS_ROTATED") &&
        event.deviceId && event.ownerUserId) {
      const client = this.clients.get(event.deviceId);
      if (client?.device?.ownerUserId === event.ownerUserId) {
        this.disconnectClient(
          event.deviceId,
          1008,
          event.type === "DEVICE_REVOKED" ? "Device access revoked" : "Device credentials rotated"
        );
      }

      // SSE streams are authenticated only when opened, so terminate them
      // immediately when the device is revoked or its credential is rotated.
      const streams = this.sseClients.get(event.deviceId);
      if (streams) {
        for (const res of streams) {
          try { res.end(); } catch {}
        }
        this.sseClients.delete(event.deviceId);
      }
      return;
    }

    if (event.type === "COMMAND_DISPATCH" && event.targetDeviceId && event.command) {
      this.dispatchCommand(event.targetDeviceId, event.command);
    } else if (event.type === "COMMAND_COMPLETE" && event.deviceId) {
      // Broadcast completion to all owner clients
      const broadcastMsg = {
        type: "TASK_UPDATE",
        commandId: event.commandId,
        deviceId: event.deviceId,
        status: event.status,
        result: event.result
      };
      const sourceDevice = this.deviceHub.pairedDevices.get(event.deviceId);
      const ownerUserId = sourceDevice?.ownerUserId;
      if (ownerUserId) {
        for (const client of this.clients.values()) {
          if (client.device?.ownerUserId === ownerUserId) {
            this.sendFrame(client.socket, broadcastMsg);
          }
        }
      }
    } else if (event.type === "MESSAGE" && event.message?.ownerUserId) {
      const msgPayload = { type: "MESSAGE_SYNC", message: event.message };
      for (const client of this.clients.values()) {
        if (client.device?.ownerUserId === event.message.ownerUserId) {
          this.sendFrame(client.socket, msgPayload);
        }
      }
    }
  }

  /**
   * Attaches an SSE stream handler to an Express response.
   */
  handleSseConnection(req, res, deviceId, authToken) {
    const device = this.deviceHub.authenticateDevice(deviceId, authToken);
    if (!device) {
      return res.status(401).json({ error: { code: "AUTHENTICATION_FAILED", message: "Invalid device token." } });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    });

    res.write(`event: ready\ndata: ${JSON.stringify({ deviceId, connectedAt: new Date().toISOString() })}\n\n`);

    let set = this.sseClients.get(deviceId);
    if (!set) {
      set = new Set();
      this.sseClients.set(deviceId, set);
    }
    set.add(res);

    device.online = true;
    device.lastSeenAt = new Date().toISOString();
    this.broadcastPresence(deviceId, true);

    const keepAliveTimer = setInterval(() => {
      try { res.write(": keep-alive\n\n"); } catch {}
    }, 25_000);

    req.on("close", () => {
      clearInterval(keepAliveTimer);
      set.delete(res);
      if (set.size === 0) {
        this.sseClients.delete(deviceId);
        device.online = false;
        this.broadcastPresence(deviceId, false);
      }
    });
  }
}

export const deviceWebSocketGateway = new DeviceWebSocketGateway();
