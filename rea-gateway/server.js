import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const DEFAULT_CHILD_PORT = 49321;
const REQUEST_HEADERS = ["accept", "content-type", "mcp-session-id", "last-event-id"];
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

/**
 * Authenticated HTTPS-edge-to-loopback MCP gateway.
 * The upstream REA listener must bind only to 127.0.0.1; this gateway is
 * the only component that listens on Render's public PORT.
 */
export function createGatewayServer({ token, upstreamPort, maxRequestBytes = MAX_REQUEST_BYTES }) {
  if (!validToken(token)) throw new TypeError("REA_MCP_TOKEN must be a random URL-safe token with at least 32 characters.");
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new TypeError("The REA child port must be a valid TCP port.");
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new TypeError("maxRequestBytes must be a positive safe integer.");
  }

  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      tcpReady(upstreamPort).then(ready => {
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
  const child = spawn(process.execPath, [
    cli, "mcp", "--http", "--host", "127.0.0.1", "--port", String(childPort)
  ], {
    cwd: packageRoot,
    env: { ...env, MCP_HOST: "127.0.0.1", MCP_PORT: String(childPort) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });

  // Drain provider diagnostics so a full stderr pipe cannot stall REA. Target
  // content and provider output are intentionally not copied to gateway logs.
  child.stderr?.on("data", () => {});
  child.on("error", () => {});
  child.on("exit", () => { console.error("REA child process stopped; gateway readiness is degraded."); });

  const server = createGatewayServer({ token, upstreamPort: childPort });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(publicPort, "0.0.0.0", resolveListen);
  });
  console.log("REA authenticated gateway listening on configured port.");

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    });
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
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
