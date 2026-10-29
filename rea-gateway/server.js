import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const DEFAULT_CHILD_PORT = 49321;
const REQUEST_HEADERS = ["accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const RESPONSE_HEADERS = ["content-type", "content-length", "mcp-session-id", "cache-control", "retry-after"];

function validToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,3000}$/.test(token);
}

function bearerMatches(header, expectedToken) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function json(res, status, body, extraHeaders = {}) {
  if (res.headersSent || res.destroyed) return;
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(payload.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders
  });
  res.end(payload);
}

function tcpReady(port, timeoutMs = 350) {
  return new Promise((resolveReady) => {
    let settled = false;
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveReady(ready);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const MCP_PROBE_MAX_BYTES = 8 * 1024 * 1024;

function parseMcpEnvelope(raw, contentType) {
  const candidates = [];
  if (String(contentType || "").includes("text/event-stream")) {
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim())
        .join("\n");
      if (data && data !== "[DONE]") candidates.push(data);
    }
  } else if (raw.trim()) {
    candidates.push(raw.trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed || "id" in parsed)) {
        return parsed;
      }
    } catch {}
  }
  throw new Error("REA MCP probe received an invalid protocol response.");
}

function mcpExchange({ port, method = "POST", payload, sessionId, protocolVersion, timeoutMs = 25000 }) {
  return new Promise((resolveExchange, rejectExchange) => {
    const headers = {
      accept: "application/json, text/event-stream",
      "accept-encoding": "identity"
    };
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (sessionId) headers["mcp-session-id"] = sessionId;
    if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;

    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/mcp",
      method,
      headers,
      agent: false,
      timeout: timeoutMs
    }, response => {
      const responseSessionId = response.headers["mcp-session-id"] || sessionId || null;
      const expectsRpc = method === "POST" && payload?.id !== undefined;
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        const error = new Error("REA MCP probe request was refused.");
        error.probeCode = "http_status_" + response.statusCode;
        rejectExchange(error);
        return;
      }
      if (!expectsRpc) {
        response.resume();
        response.once("end", () => resolveExchange({ status: response.statusCode, sessionId: responseSessionId, rpc: null }));
        return;
      }

      let bytes = 0;
      const chunks = [];
      let rejected = false;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MCP_PROBE_MAX_BYTES) {
          rejected = true;
          response.destroy();
          rejectExchange(Object.assign(new Error("REA MCP probe response exceeded the size limit."), {
            probeCode: "response_too_large"
          }));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        if (rejected) return;
        try {
          const rpc = parseMcpEnvelope(Buffer.concat(chunks).toString("utf8"), response.headers["content-type"]);
          resolveExchange({ status: response.statusCode, sessionId: responseSessionId, rpc });
        } catch {
          const error = new Error("REA MCP probe response could not be parsed.");
          error.probeCode = "invalid_rpc_response";
          rejectExchange(error);
        }
      });
      response.once("error", () => {
        if (!rejected) {
          rejectExchange(Object.assign(new Error("REA MCP probe response failed."), {
            probeCode: "response_failed"
          }));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      const error = new Error("REA MCP probe timed out.");
      error.probeCode = "timeout";
      request.destroy(error);
    });
    request.once("error", error => {
      rejectExchange(Object.assign(new Error("REA MCP probe request failed."), {
        probeCode: error?.message === "REA MCP probe timed out." ? "timeout" : "connection_failed"
      }));
    });
    if (payload !== undefined) request.write(JSON.stringify(payload));
    request.end();
  });
}

function getStructuredToolOutput(result) {
  if (!result || typeof result !== "object" || result.isError === true) {
    throw new Error("REA MCP probe tool call failed.");
  }
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const textItems = Array.isArray(result.content)
    ? result.content.filter(item => item?.type === "text" && typeof item.text === "string").map(item => item.text)
    : [];
  for (const item of textItems) {
    try {
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  if (textItems.length) return { text: textItems.join("\n\n") };
  throw new Error("REA MCP probe tool output was empty.");
}

/**
 * Execute a small, benign live protocol test against the loopback MCP service.
 * It never executes the target application; it opens and statically analyzes a
 * checked-in demo target, traces the "search results" feature, then closes the
 * REA session and active target before marking the public gateway ready.
 */
export async function runReaMcpSelfTest({ upstreamPort, analysisRoot } = {}) {
  if (!Number.isInteger(upstreamPort) || typeof analysisRoot !== "string" || !analysisRoot.startsWith("/")) {
    return { ok: false, stage: "configuration" };
  }

  const root = resolve(analysisRoot);
  const targetPath = resolve(root, "demo-app");
  if (targetPath === root || !targetPath.startsWith(root + "/")) {
    return { ok: false, stage: "target_path" };
  }

  let sessionId = null;
  let protocolVersion = null;
  let activeTarget = false;
  let initialized = false;
  let nextId = 0;
  let stage = "initialize";

  const call = async (method, params = {}, notification = false) => {
    const payload = {
      jsonrpc: "2.0",
      ...(notification ? {} : { id: ++nextId }),
      method,
      ...(Object.keys(params).length ? { params } : {})
    };
    const reply = await mcpExchange({ port: upstreamPort, payload, sessionId, protocolVersion });
    sessionId = reply.sessionId;
    if (notification) return reply.rpc;
    if (!reply.rpc) {
      throw Object.assign(new Error("REA MCP probe received no RPC envelope."), { probeCode: "missing_rpc_envelope" });
    }
    if (reply.rpc.id !== payload.id) {
      throw Object.assign(new Error("REA MCP probe response ID did not match."), { probeCode: "rpc_id_mismatch" });
    }
    if (reply.rpc.error) {
      throw Object.assign(new Error("REA MCP probe returned an RPC error."), { probeCode: "rpc_error" });
    }
    const result = reply.rpc.result;
    if (method === "initialize" && typeof result?.protocolVersion === "string") {
      protocolVersion = result.protocolVersion;
    }
    return result;
  };

  try {
    const initialization = await call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "ultron-rea-live-smoke", version: "1.0.0" }
    });
    initialized = Boolean(sessionId);
    if (!initialization || typeof initialization !== "object" || !sessionId) {
      return { ok: false, stage: "initialize", reason: "missing_initialize_result" };
    }

    stage = "initialize_notification";
    await call("notifications/initialized", {}, true);

    stage = "tools_list";
    const catalog = await call("tools/list");
    const toolNames = Array.isArray(catalog?.tools) ? catalog.tools.map(tool => tool?.name) : [];
    for (const required of ["open_binary", "analyze_javascript_application", "trace_application_feature", "close_binary"]) {
      if (!toolNames.includes(required)) return { ok: false, stage: "tools_list", reason: "required_tool_missing" };
    }

    stage = "open_demo_target";
    getStructuredToolOutput(await call("tools/call", {
      name: "open_binary",
      arguments: { path: targetPath }
    }));
    activeTarget = true;

    stage = "analyze_demo_target";
    const evidence = getStructuredToolOutput(await call("tools/call", {
      name: "analyze_javascript_application",
      arguments: { input_path: targetPath, format: "auto", integrity_policy: "fail", detail: "complete" }
    }));
    if (typeof evidence.evidence_id !== "string" || !evidence.normalized_result) {
      return { ok: false, stage: "analyze_demo_target", reason: "evidence_missing" };
    }

    stage = "trace_demo_feature";
    const trace = getStructuredToolOutput(await call("tools/call", {
      name: "trace_application_feature",
      arguments: { application: evidence, seed: { kind: "string", value: "search results" }, direction: "both" }
    }));
    if (!trace || typeof trace !== "object") return { ok: false, stage: "trace_demo_feature", reason: "trace_empty" };

    return { ok: true, stage: "complete" };
  } catch (error) {
    const knownReasons = new Set([
      "http_status_400", "http_status_401", "http_status_404", "http_status_405",
      "http_status_406", "http_status_415", "http_status_429", "http_status_500",
      "http_status_503", "connection_failed", "timeout", "invalid_rpc_response",
      "missing_rpc_envelope", "rpc_id_mismatch", "rpc_error", "response_failed",
      "response_too_large"
    ]);
    return { ok: false, stage, reason: knownReasons.has(error?.probeCode) ? error.probeCode : "tool_check_failed" };
  } finally {
    if (sessionId && initialized) {
      if (activeTarget) {
        try { await call("tools/call", { name: "close_binary", arguments: {} }); } catch {}
      }
      try {
        await mcpExchange({ port: upstreamPort, method: "DELETE", sessionId, protocolVersion, timeoutMs: 5000 });
      } catch {}
    }
  }
}

/**
 * Authenticated HTTPS-edge-to-loopback MCP gateway.
 * The upstream REA listener must bind only to 127.0.0.1; this gateway is
 * the only component that listens on Render's public PORT.
 */
export function createGatewayServer({ token, upstreamPort, maxRequestBytes = MAX_REQUEST_BYTES, isReady = null }) {
  if (!validToken(token)) throw new TypeError("REA_MCP_TOKEN must be a random URL-safe token with at least 32 characters.");
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new TypeError("The REA child port must be a valid TCP port.");
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new TypeError("maxRequestBytes must be a positive safe integer.");
  }

  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      Promise.resolve(typeof isReady === "function" ? isReady() : tcpReady(upstreamPort)).then(ready => {
        json(res, ready ? 200 : 503, { status: ready ? "ok" : "starting" });
      }).catch(() => json(res, 503, { status: "starting" }));
      return;
    }

    // No query parameters, path aliases, proxy destinations, or other routes.
    if (req.url !== "/mcp") {
      json(res, 404, { error: "not_found" });
      return;
    }
    if (!["GET", "POST", "DELETE"].includes(req.method)) {
      json(res, 405, { error: "method_not_allowed" }, { allow: "GET, POST, DELETE" });
      return;
    }
    if (!bearerMatches(req.headers.authorization, token)) {
      json(res, 401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="rea-mcp"' });
      return;
    }

    if (typeof isReady === "function" && !isReady()) {
      json(res, 503, { error: "rea_unavailable" });
      req.resume();
      return;
    }

    const declaredLength = req.headers["content-length"];
    if (declaredLength !== undefined) {
      const declared = Number(declaredLength);
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxRequestBytes) {
        json(res, 413, { error: "request_too_large" });
        req.resume();
        return;
      }
    }

    const headers = { host: "127.0.0.1:" + upstreamPort, "accept-encoding": "identity" };
    for (const key of REQUEST_HEADERS) {
      const value = req.headers[key];
      if (typeof value === "string") headers[key] = value;
    }

    const upstream = http.request({
      host: "127.0.0.1",
      port: upstreamPort,
      path: "/mcp",
      method: req.method,
      headers,
      agent: false,
      timeout: 15000
    });

    let oversized = false;
    let requestBytes = 0;
    req.on("data", chunk => {
      requestBytes += chunk.length;
      if (!oversized && requestBytes > maxRequestBytes) {
        oversized = true;
        req.unpipe(upstream);
        upstream.destroy();
        json(res, 413, { error: "request_too_large" });
        req.resume();
      }
    });

    upstream.on("response", upstreamRes => {
      const safeHeaders = {};
      for (const key of RESPONSE_HEADERS) {
        const value = upstreamRes.headers[key];
        if (typeof value === "string") safeHeaders[key] = value;
      }
      safeHeaders["x-content-type-options"] = "nosniff";
      res.writeHead(upstreamRes.statusCode || 502, safeHeaders);
      upstreamRes.pipe(res);
    });

    upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
    upstream.on("error", () => {
      if (oversized) return;
      json(res, 503, { error: "rea_unavailable" });
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  });
}

function positivePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}


function safeDiagnosticCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function observeReaChildStderr(child) {
  let pending = "";
  child.stderr?.on("data", chunk => {
    pending += chunk.toString("utf8");
    // Logs are line-delimited. Keep only a small tail in case a provider emits
    // one unusually large record; never forward the raw content to Render logs.
    if (pending.length > 8192) pending = pending.slice(-8192);
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch {}
      if (event?.msg === "MCP transport listening") {
        console.log("REA child reports its MCP listener started.");
        continue;
      }
      const level = event?.level;
      const isError = level === "error" || (typeof level === "number" && level >= 50);
      if (isError || (!event && /\b(?:error|failed|exception|unable to|cannot)\b/i.test(line))) {
        const code = safeDiagnosticCode(event?.code ?? event?.err?.code ?? event?.error?.code);
        console.error("REA child emitted a startup error diagnostic" + (code ? "; code=" + code : "") + "; details withheld.");
      }
    }
  });
  child.on("error", error => {
    const code = safeDiagnosticCode(error?.code);
    console.error("REA child could not start" + (code ? "; code=" + code : "") + ".");
  });
}

export async function startGateway(env = process.env) {
  const token = env.REA_MCP_TOKEN;
  if (!validToken(token)) {
    throw new Error("Set REA_MCP_TOKEN to a random URL-safe secret of at least 32 characters.");
  }

  const publicPort = positivePort(env.PORT, 10000);
  const childPort = positivePort(env.REA_CHILD_PORT, DEFAULT_CHILD_PORT);
  if (publicPort === childPort) throw new Error("PORT and REA_CHILD_PORT must be different.");

  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const cli = resolve(packageRoot, "node_modules", "rea-agents", "scripts", "rea.mjs");
  let mcpReady = false;
  const child = spawn(process.execPath, [
    cli, "mcp", "--http", "--host", "127.0.0.1", "--port", String(childPort)
  ], {
    cwd: packageRoot,
    env: { ...env, MCP_HOST: "127.0.0.1", MCP_PORT: String(childPort) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });

  // Retain only safe startup signals and diagnostic codes; never write raw
  // target-derived content or upstream error messages into Render logs.
  observeReaChildStderr(child);
  child.on("exit", (code, signal) => {
    mcpReady = false;
    const exitCode = Number.isInteger(code) && code >= 0 ? String(code) : null;
    const safeSignal = safeDiagnosticCode(signal);
    console.error("REA child process stopped; gateway readiness is degraded." +
      (exitCode ? " exit_code=" + exitCode : "") +
      (safeSignal ? " signal=" + safeSignal : ""));
  });

  const server = createGatewayServer({ token, upstreamPort: childPort, isReady: () => mcpReady });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(publicPort, "0.0.0.0", resolveListen);
  });
  console.log("REA authenticated gateway listening on configured port.");

  let shuttingDown = false;
  const monitorReadiness = async () => {
    let attempts = 0;
    while (!shuttingDown && child.exitCode === null && !mcpReady) {
      let result;
      if (!(await tcpReady(childPort, 1000))) {
        result = { ok: false, stage: "upstream_not_listening", reason: "tcp_not_ready" };
      } else {
        result = await runReaMcpSelfTest({ upstreamPort: childPort, analysisRoot: env.REA_ANALYSIS_ROOT });
      }
      if (result.ok) {
        mcpReady = true;
        console.log("REA MCP live smoke test passed: catalog, static demo analysis, and feature trace verified.");
        return;
      }
      attempts += 1;
      if (attempts === 1 || attempts % 10 === 0) {
        console.error("REA MCP readiness probe pending; stage=" + result.stage + ", reason=" + result.reason + ".");
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1500));
    }
  };
  void monitorReadiness();

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    if (child.exitCode === null) child.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 7000);
    killTimer.unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return { server, child, shutdown };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  startGateway().catch(() => {
    console.error("REA gateway startup failed; verify runtime version, installed package, and required configuration.");
    process.exitCode = 1;
  });
}
