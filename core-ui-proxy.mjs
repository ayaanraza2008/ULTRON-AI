import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const CORE_API_ORIGIN = "https://ultron-ai-core.onrender.com";
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const STATIC_ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml; charset=utf-8"]]
]);
const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const RESPONSE_HEADERS = [
  "cache-control", "content-type", "content-disposition", "location",
  "retry-after", "www-authenticate", "vary", "x-ultron-model", "x-ultron-fallback"
];

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' https://ultron-world-intelligence.onrender.com; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return size ? Buffer.concat(chunks, size) : undefined;
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  securityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(body.length));
  res.end(body);
}

async function serveAsset(req, res, asset) {
  const [filename, contentType] = asset;
  let bytes;
  try {
    bytes = await readFile(path.join(ROOT, filename));
  } catch {
    sendJson(res, 404, { error: { code: "ASSET_NOT_FOUND", message: "This interface asset is missing." } });
    return;
  }
  securityHeaders(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", filename === "index.html" ? "no-store" : "public, max-age=300");
  res.setHeader("Content-Length", String(bytes.length));
  if (req.method === "HEAD") res.end();
  else res.end(bytes);
}

function forwardedRequestHeaders(req) {
  const headers = new Headers();
  const input = req.headers;
  for (const key of ["accept", "accept-language", "authorization", "cookie", "content-type", "user-agent"]) {
    const value = input[key];
    if (typeof value === "string" && value) headers.set(key, value);
  }
  // The browser talks only to this UI origin. Normalize the upstream origin so
  // the backend sees a same-origin request, while session cookies stay HttpOnly.
  headers.set("origin", CORE_API_ORIGIN);
  headers.set("referer", CORE_API_ORIGIN + "/");
  return headers;
}

function forwardResponseHeaders(upstream, res) {
  securityHeaders(res);
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  let cookies = [];
  if (typeof upstream.headers.getSetCookie === "function") {
    cookies = upstream.headers.getSetCookie();
  } else {
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) cookies = [cookie];
  }
  if (cookies.length) {
    // A proxy response sets cookies for the public UI host, then forwards the
    // same cookie to the private backend on the next request.
    res.setHeader("Set-Cookie", cookies.map(cookie => cookie.replace(/;\s*Domain=[^;]+/ig, "")));
  }
}

export function createUltronCoreProxy({ fetchImpl = fetch, logger = console } = {}) {
  return createServer(async (req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://ultron-core-interface.local");
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_URL", message: "Request URL is invalid." } });
      return;
    }

    if (requestUrl.pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      sendJson(res, 200, { status: "ok", service: "ultron-core-interface" });
      return;
    }

    const asset = STATIC_ASSETS.get(requestUrl.pathname);
    if (asset && (req.method === "GET" || req.method === "HEAD")) {
      await serveAsset(req, res, asset);
      return;
    }

    const isApiPath = requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/");
    const isWorldIntelligencePath = requestUrl.pathname === "/world-intelligence" || requestUrl.pathname.startsWith("/world-intelligence/");
    if (!isApiPath && !isWorldIntelligencePath) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "No interface route matches this path." } });
      return;
    }
    if (!ALLOWED_PROXY_METHODS.has(req.method || "")) {
      res.setHeader("Allow", "GET, HEAD, POST, PUT, PATCH, DELETE");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "This request method is not supported." } });
      return;
    }

    let body;
    try {
      if (!["GET", "HEAD", "DELETE"].includes(req.method || "")) body = await readRequestBody(req);
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: { code: "INVALID_REQUEST_BODY", message: error.message || "Could not read request body." } });
      return;
    }

    const target = new URL(requestUrl.pathname + requestUrl.search, CORE_API_ORIGIN);
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    req.once("aborted", abortRequest);
    res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const upstream = await fetchImpl(target, {
        method: req.method,
        headers: forwardedRequestHeaders(req),
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
        signal: controller.signal
      });
      res.statusCode = upstream.status;
      forwardResponseHeaders(upstream, res);
      if (req.method === "HEAD" || upstream.status === 204 || upstream.status === 304 || !upstream.body) {
        res.end();
        return;
      }
      const stream = Readable.fromWeb(upstream.body);
      stream.on("error", (error) => {
        logger.warn?.("ULTRON upstream response stream ended unexpectedly", { name: error?.name || "Error" });
        if (!res.headersSent) sendJson(res, 502, { error: { code: "UPSTREAM_STREAM_FAILED", message: "The backend response stream was interrupted." } });
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      if (controller.signal.aborted && (req.aborted || res.destroyed)) return;
      logger.warn?.("ULTRON CORE API proxy request failed", { name: error?.name || "Error" });
      sendJson(res, 502, { error: { code: "UPSTREAM_UNAVAILABLE", message: "Could not connect to the ULTRON CORE backend. Try again shortly." } });
    } finally {
      req.off("aborted", abortRequest);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT) || 10000;
  const server = createUltronCoreProxy();
  server.listen(port, "0.0.0.0", () => console.log("ULTRON CORE interface listening on port " + port));
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
