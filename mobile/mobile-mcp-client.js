/**
 * ULTRON AI — Mobile MCP Client & Subprocess Lifecycle Manager
 *
 * Manages the lifecycle of the `@mobilenext/mobile-mcp` official MCP server,
 * providing JSON-RPC 2.0 communication over both STDIO and authenticated Streamable HTTP.
 *
 * Enforces mandatory privacy and security invariants:
 * - MOBILEMCP_DISABLE_TELEMETRY=1 is always enforced.
 * - MOBILEMCP_LEGACY_ROBOT=1 is set for direct ADB robot execution.
 * - Bound exclusively to loopback 127.0.0.1 with Bearer token authentication when HTTP mode is used.
 * - Dynamic tool discovery without hardcoding tool schemas.
 * - Resilient fallback to AdbBridge if the MCP server process is unavailable.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { adbBridge } from "./adb-bridge.js";

export const MCP_TRANSPORT_MODES = {
  STDIO: "stdio",
  HTTP: "http"
};

export const MCP_CLIENT_STATUS = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  ERROR: "ERROR"
};

export class MobileMcpClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.transport = options.transport || MCP_TRANSPORT_MODES.STDIO;
    this.packageSpec = options.packageSpec || "@mobilenext/mobile-mcp@1.0.16";
    this.customCommand = options.customCommand || null; // e.g. ["node", "path/to/lib/index.js"]
    this.port = options.port || (49152 + Math.floor(Math.random() * 1000));
    this.host = options.host || "127.0.0.1";
    this.httpUrl = options.httpUrl || `http://${this.host}:${this.port}/mcp`;
    this.authToken = options.authToken || crypto.randomBytes(24).toString("hex");
    this.requestTimeoutMs = options.requestTimeoutMs || 30000;
    this.enableFallbackToAdb = options.enableFallbackToAdb !== false;

    this.process = null;
    this.status = MCP_CLIENT_STATUS.DISCONNECTED;
    this.discoveredTools = new Map();
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
    this.stdoutBuffer = "";
    this.serverVersion = null;
    this.sdkVersion = null;
    this.lastError = null;
    this.lastActivity = null;
  }

  /**
   * Build subprocess environment enforcing telemetry & legacy robot invariants.
   */
  buildEnvironment(custom = {}) {
    return {
      ...process.env,
      MOBILEMCP_DISABLE_TELEMETRY: "1",
      MOBILEMCP_LEGACY_ROBOT: "1",
      ...(this.authToken ? { MOBILEMCP_AUTH: this.authToken } : {}),
      ...custom
    };
  }

  /**
   * Build standard JSON-RPC 2.0 request payload.
   */
  buildJsonRpcRequest(method, params = {}, id = null) {
    const reqId = id !== null && id !== undefined ? id : this.nextRequestId++;
    return {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params
    };
  }

  /**
   * Unwraps MCP tool responses handling text, images (base64 PNG), and error flags.
   */
  unwrapToolResponse(res) {
    if (!res || !Array.isArray(res.content)) {
      return { success: !res?.isError, text: "", raw: res };
    }

    let textOut = "";
    let imageItem = null;

    for (const item of res.content) {
      if (item.type === "text") {
        textOut += item.text;
      } else if (item.type === "image") {
        imageItem = item;
      }
    }

    if (res.isError) {
      return { success: false, error: textOut || "Tool execution error", raw: res };
    }

    if (imageItem) {
      return {
        success: true,
        text: textOut,
        mimeType: imageItem.mimeType || "image/png",
        data: imageItem.data,
        raw: res
      };
    }

    return {
      success: true,
      text: textOut,
      raw: res
    };
  }

  /**
   * Convenience helper to discover or query connected devices.
   */
  async listDevices() {
    return this.callTool("mobile_list_available_devices", {});
  }

  /**
   * Start the Mobile MCP server process and establish JSON-RPC session.
   */
  async start() {
    if (this.status === MCP_CLIENT_STATUS.CONNECTED) {
      return { success: true, status: this.status, toolsCount: this.discoveredTools.size };
    }

    this.status = MCP_CLIENT_STATUS.CONNECTING;
    this.emit("status_change", { status: this.status });

    try {
      if (this.transport === MCP_TRANSPORT_MODES.STDIO) {
        await this._startStdio();
      } else {
        await this._startHttp();
      }

      // Perform MCP initialization handshake
      await this._initializeSession();

      // Discover registered MCP tools dynamically
      await this.refreshTools();

      this.status = MCP_CLIENT_STATUS.CONNECTED;
      this.lastActivity = Date.now();
      this.emit("status_change", { status: this.status, tools: Array.from(this.discoveredTools.keys()) });

      return {
        success: true,
        status: this.status,
        transport: this.transport,
        toolsCount: this.discoveredTools.size,
        serverVersion: this.serverVersion
      };
    } catch (err) {
      this.status = MCP_CLIENT_STATUS.ERROR;
      this.lastError = err.message;
      this.emit("status_change", { status: this.status, error: err.message });
      await this.stop();
      throw err;
    }
  }

  /**
   * Internal: Launch subprocess with STDIO transport.
   */
  async _startStdio() {
    const env = {
      ...process.env,
      MOBILEMCP_DISABLE_TELEMETRY: "1",
      MOBILEMCP_LEGACY_ROBOT: "1"
    };

    let cmd = "npx.cmd";
    let args = ["-y", this.packageSpec, "--stdio"];

    if (process.platform !== "win32") {
      cmd = "npx";
    }

    if (this.customCommand) {
      cmd = this.customCommand[0];
      args = [...this.customCommand.slice(1), "--stdio"];
    }

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      this.process = spawn(cmd, args, {
        shell: isWindows,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      let startupTimer = setTimeout(() => {
        reject(new Error(`Timeout waiting for Mobile MCP server process startup (${cmd})`));
      }, 15000);

      this.process.stdout.on("data", (chunk) => {
        this._handleStdoutData(chunk);
      });

      this.process.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        // Server prints startup message to stderr: "mobile-mcp 1.0.16 (mcp sdk 2.4.0) server running on stdio"
        if (text.includes("server running on stdio")) {
          clearTimeout(startupTimer);
          const match = text.match(/mobile-mcp\s+([0-9.]+)/i);
          if (match) this.serverVersion = match[1];
          resolve();
        }
      });

      this.process.on("error", (err) => {
        clearTimeout(startupTimer);
        this.status = MCP_CLIENT_STATUS.ERROR;
        this.lastError = err.message;
        reject(err);
      });

      this.process.on("exit", (code, signal) => {
        clearTimeout(startupTimer);
        this.status = MCP_CLIENT_STATUS.DISCONNECTED;
        this.process = null;
        this._rejectAllPending(new Error(`Mobile MCP server process exited (code=${code}, signal=${signal})`));
        this.emit("exit", { code, signal });
      });
    });
  }

  /**
   * Internal: Launch subprocess with Streamable HTTP transport.
   */
  async _startHttp() {
    const env = {
      ...process.env,
      MOBILEMCP_DISABLE_TELEMETRY: "1",
      MOBILEMCP_LEGACY_ROBOT: "1",
      MOBILEMCP_AUTH: this.authToken
    };

    const isWindows = process.platform === "win32";
    let cmd = isWindows ? "npx.cmd" : "npx";
    let args = ["-y", this.packageSpec, "--listen", `${this.host}:${this.port}`];

    if (this.customCommand) {
      cmd = this.customCommand[0];
      args = [...this.customCommand.slice(1), "--listen", `${this.host}:${this.port}`];
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(cmd, args, {
        shell: isWindows,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      const startupTimer = setTimeout(() => {
        reject(new Error(`Timeout waiting for Mobile MCP HTTP server to listen on ${this.host}:${this.port}`));
      }, 15000);

      this.process.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        if (text.includes("listening on http://")) {
          clearTimeout(startupTimer);
          const match = text.match(/mobile-mcp\s+([0-9.]+)/i);
          if (match) this.serverVersion = match[1];
          resolve();
        }
      });

      this.process.on("error", (err) => {
        clearTimeout(startupTimer);
        this.status = MCP_CLIENT_STATUS.ERROR;
        this.lastError = err.message;
        reject(err);
      });

      this.process.on("exit", (code, signal) => {
        clearTimeout(startupTimer);
        this.status = MCP_CLIENT_STATUS.DISCONNECTED;
        this.process = null;
        this._rejectAllPending(new Error(`Mobile MCP HTTP process exited (code=${code}, signal=${signal})`));
        this.emit("exit", { code, signal });
      });
    });
  }

  /**
   * Internal: Handle incoming JSON-RPC lines from STDIO.
   */
  _handleStdoutData(chunk) {
    this.stdoutBuffer += chunk.toString();
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
          const { resolve, reject, timer } = this.pendingRequests.get(message.id);
          clearTimeout(timer);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            reject(new Error(message.error.message || `MCP Error ${message.error.code}`));
          } else {
            resolve(message.result);
          }
        }
      } catch (parseErr) {
        // Non-JSON debug message ignored
      }
    }
  }

  /**
   * Internal: Send JSON-RPC request over active transport.
   */
  async _sendRequest(method, params = {}) {
    const id = this.nextRequestId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    if (this.transport === MCP_TRANSPORT_MODES.STDIO) {
      if (!this.process || !this.process.stdin.writable) {
        throw new Error("Mobile MCP STDIO process is not writable or not running.");
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request '${method}' timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timer });
        this.process.stdin.write(JSON.stringify(payload) + "\n");
      });
    } else {
      // HTTP Transport
      const url = `http://${this.host}:${this.port}/mcp`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "Authorization": `Bearer ${this.authToken}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Mobile MCP HTTP error ${response.status}: ${errText}`);
      }

      const resJson = await response.json();
      if (resJson.error) {
        throw new Error(resJson.error.message || `MCP Error ${resJson.error.code}`);
      }
      return resJson.result;
    }
  }

  /**
   * Internal: Send JSON-RPC notification (no response expected).
   */
  _sendNotification(method, params = {}) {
    const payload = {
      jsonrpc: "2.0",
      method,
      params
    };

    if (this.transport === MCP_TRANSPORT_MODES.STDIO) {
      if (this.process && this.process.stdin.writable) {
        this.process.stdin.write(JSON.stringify(payload) + "\n");
      }
    }
  }

  /**
   * Complete standard MCP protocol handshake.
   */
  async _initializeSession() {
    const initRes = await this._sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "ultron-mobile-client",
        version: "1.0.0"
      }
    });

    if (initRes && initRes.serverInfo) {
      this.serverVersion = initRes.serverInfo.version || this.serverVersion;
    }

    this._sendNotification("notifications/initialized");
  }

  /**
   * Discover available tools and cache schemas from server.
   */
  async refreshTools() {
    const res = await this._sendRequest("tools/list", {});
    this.discoveredTools.clear();

    if (res && Array.isArray(res.tools)) {
      for (const t of res.tools) {
        this.discoveredTools.set(t.name, {
          name: t.name,
          title: t.title || t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {}
        });
      }
    }

    return Array.from(this.discoveredTools.values());
  }

  /**
   * List all discovered tools.
   */
  listTools() {
    return Array.from(this.discoveredTools.values());
  }

  /**
   * Invoke a discovered MCP tool by name with arguments.
   */
  async callTool(name, args = {}) {
    this.lastActivity = Date.now();

    // If client is connected to MCP server, call it via MCP protocol
    if (this.status === MCP_CLIENT_STATUS.CONNECTED && this.discoveredTools.has(name)) {
      const res = await this._sendRequest("tools/call", {
        name,
        arguments: args
      });

      return this._formatToolResponse(res);
    }

    // Fallback: If MCP server is not connected or tool missing, use AdbBridge fallback if enabled
    if (this.enableFallbackToAdb) {
      return this._executeAdbFallback(name, args);
    }

    throw new Error(`Tool '${name}' is not available (MCP client status: ${this.status})`);
  }

  /**
   * Internal: Format MCP tool response content.
   */
  _formatToolResponse(res) {
    if (!res || !Array.isArray(res.content)) {
      return { success: true, text: "", raw: res };
    }

    let textOut = "";
    let imageOut = null;

    for (const item of res.content) {
      if (item.type === "text") {
        textOut += item.text;
      } else if (item.type === "image") {
        imageOut = {
          data: item.data,
          mimeType: item.mimeType || "image/png"
        };
      }
    }

    return {
      success: !res.isError,
      text: textOut,
      image: imageOut,
      raw: res
    };
  }

  /**
   * Native ADB fallback for key mobile operations when MCP subprocess is absent.
   */
  async _executeAdbFallback(name, args) {
    const deviceId = args.device || args.deviceId;

    switch (name) {
      case "mobile_list_available_devices": {
        const listRes = await adbBridge.listDevices();
        return {
          success: listRes.success,
          text: JSON.stringify({ devices: listRes.devices }),
          fallback: true
        };
      }

      case "mobile_get_screen_size": {
        const det = await adbBridge.getDeviceDetails(deviceId);
        return {
          success: true,
          text: JSON.stringify(det.screenSize),
          fallback: true
        };
      }

      case "mobile_take_screenshot": {
        const buf = await adbBridge.takeScreenshot(deviceId);
        return {
          success: true,
          text: "Screenshot captured via direct ADB",
          image: { data: buf.toString("base64"), mimeType: "image/png" },
          fallback: true
        };
      }

      case "mobile_click_on_screen_at_coordinates": {
        const x = args.x || args.coordinate?.[0] || 0;
        const y = args.y || args.coordinate?.[1] || 0;
        const tapRes = await adbBridge.tap(deviceId, x, y);
        return {
          success: tapRes.success,
          text: tapRes.success ? `Tapped at (${x}, ${y})` : tapRes.error,
          fallback: true
        };
      }

      case "mobile_swipe_on_screen": {
        const x1 = args.startX || args.start_coordinate?.[0] || 500;
        const y1 = args.startY || args.start_coordinate?.[1] || 1500;
        const x2 = args.endX || args.end_coordinate?.[0] || 500;
        const y2 = args.endY || args.end_coordinate?.[1] || 500;
        const dur = args.durationMs || 300;
        const swipeRes = await adbBridge.swipe(deviceId, x1, y1, x2, y2, dur);
        return {
          success: swipeRes.success,
          text: swipeRes.success ? `Swiped from (${x1}, ${y1}) to (${x2}, ${y2})` : swipeRes.error,
          fallback: true
        };
      }

      case "mobile_type_keys": {
        const typeRes = await adbBridge.typeText(deviceId, args.text || args.keys || "");
        return {
          success: typeRes.success,
          text: typeRes.success ? `Typed: ${args.text}` : typeRes.error,
          fallback: true
        };
      }

      case "mobile_press_button": {
        const keyMap = {
          HOME: "KEYCODE_HOME",
          BACK: "KEYCODE_BACK",
          ENTER: "KEYCODE_ENTER",
          VOLUME_UP: "KEYCODE_VOLUME_UP",
          VOLUME_DOWN: "KEYCODE_VOLUME_DOWN"
        };
        const keycode = keyMap[args.button] || args.button || "KEYCODE_HOME";
        const pressRes = await adbBridge.pressKey(deviceId, keycode);
        return {
          success: pressRes.success,
          text: pressRes.success ? `Pressed button ${args.button}` : pressRes.error,
          fallback: true
        };
      }

      case "mobile_launch_app": {
        const pkg = args.package || args.app || args.bundleId;
        const launchRes = await adbBridge.launchApp(deviceId, pkg);
        return {
          success: launchRes.success,
          text: launchRes.success ? `Launched app ${pkg}` : launchRes.error,
          fallback: true
        };
      }

      case "mobile_terminate_app": {
        const pkg = args.package || args.app || args.bundleId;
        const termRes = await adbBridge.terminateApp(deviceId, pkg);
        return {
          success: termRes.success,
          text: termRes.success ? `Terminated app ${pkg}` : termRes.error,
          fallback: true
        };
      }

      case "mobile_open_url": {
        const openRes = await adbBridge.openUrl(deviceId, args.url);
        return {
          success: openRes.success,
          text: openRes.success ? `Opened URL: ${args.url}` : openRes.error,
          fallback: true
        };
      }

      default:
        throw new Error(`Fallback execution for '${name}' is not supported without active MCP server.`);
    }
  }

  /**
   * Cleanly terminate the MCP server subprocess and clear state.
   */
  async stop() {
    this.status = MCP_CLIENT_STATUS.DISCONNECTED;

    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch (e) {
        try { this.process.kill("SIGKILL"); } catch {}
      }
      this.process = null;
    }

    this._rejectAllPending(new Error("Mobile MCP client disconnected."));
    this.discoveredTools.clear();
    this.stdoutBuffer = "";
    this.emit("status_change", { status: this.status });
  }

  /**
   * Internal: Reject all pending in-flight requests.
   */
  _rejectAllPending(err) {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    this.pendingRequests.clear();
  }

  /**
   * Get diagnostics and status telemetry.
   */
  getStatus() {
    return {
      status: this.status,
      transport: this.transport,
      pid: this.process ? this.process.pid : null,
      serverVersion: this.serverVersion,
      toolsCount: this.discoveredTools.size,
      tools: Array.from(this.discoveredTools.keys()),
      lastActivity: this.lastActivity,
      lastError: this.lastError
    };
  }
}

export const mobileMcpClient = new MobileMcpClient();
