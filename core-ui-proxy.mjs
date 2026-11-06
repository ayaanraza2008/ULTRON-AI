import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const CORE_API_ORIGIN = process.env.CORE_API_ORIGIN || "https://ultron-ai-core.onrender.com";
const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const STATIC_ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/particle-swarm-engine.js", ["particle-swarm-engine.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml; charset=utf-8"]]
]);
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const LEGACY_SERVICE_WORKER_RETIREMENT_SCRIPT = "self.addEventListener(\"install\", event => event.waitUntil(self.skipWaiting()));\nself.addEventListener(\"activate\", event => {\n  event.waitUntil((async () => {\n    const openClients = await self.clients.matchAll({ type: \"window\", includeUncontrolled: true });\n    await self.registration.unregister();\n    const cacheKeys = await caches.keys();\n    await Promise.all(cacheKeys.filter(key => key.startsWith(\"ultron-core-shell-\")).map(key => caches.delete(key)));\n    await Promise.all(openClients.map(client => client.navigate(client.url).catch(() => null)));\n  })());\n});\n";
const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const RESPONSE_HEADERS = [
  "cache-control", "content-type", "content-disposition", "location",
  "retry-after", "www-authenticate", "vary", "x-ultron-model", "x-ultron-fallback"
];

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=(self)");
  // The hand tracker loads a version-pinned MediaPipe module and its WASM/model
  // assets. Camera frames remain local; only these static runtime assets are
  // fetched from the explicitly allow-listed origins.
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; frame-src 'self' https://ultron-world-intelligence.onrender.com; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'");
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
    bytes = await readFile(path.join(PUBLIC_ROOT, filename));
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

export function createUltronCoreProxy({ fetchImpl = fetch, logger = console, gatewayRetryDelaysMs = [1500, 3000, 5000, 7000, 9000, 10000, 12000, 12000, 12000] } = {}) {
  return createServer(async (req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://ultron-api-proxy.local");
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_URL", message: "Request URL is invalid." } });
      return;
    }

    const staticAsset = STATIC_ASSETS.get(requestUrl.pathname);
    if (staticAsset && (req.method === "GET" || req.method === "HEAD")) {
      await serveAsset(req, res, staticAsset);
      return;
    }

    if (requestUrl.pathname === "/service-worker.js" && (req.method === "GET" || req.method === "HEAD")) {
      securityHeaders(res);
      const body = Buffer.from(LEGACY_SERVICE_WORKER_RETIREMENT_SCRIPT);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Content-Length", String(body.length));
      if (req.method === "HEAD") res.end();
      else res.end(body);
      return;
    }

    if (requestUrl.pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      sendJson(res, 200, { status: "ok", service: "ultron-api-proxy" });
      return;
    }

    const isApiPath = requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/");
    const isJarvisPath = requestUrl.pathname === "/jarvis" || requestUrl.pathname.startsWith("/jarvis/");
    if (!isApiPath && !isJarvisPath) {
      sendJson(res, 404, {
        error: {
          code: requestUrl.pathname === "/" || requestUrl.pathname === "/index.html" ||
            /\.(?:html?|js|css|svg|png|webmanifest|ico)$/i.test(requestUrl.pathname)
            ? "NOT_FOUND" : "NOT_FOUND",
          message: "No ULTRON interface or API route matches this path."
        }
      });
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
      const forwardOptions = {
        method: req.method,
        headers: forwardedRequestHeaders(req),
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
        signal: controller.signal
      };
      let upstream = await fetchImpl(target, forwardOptions);
      const isJsonResponse = response => {
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        return contentType.includes("application/json") || contentType.includes("+json");
      };

      // Render's free instances can take about a minute to resume after idle.
      // Retry only non-JSON gateway 502/503s, with bounded backoff. Never retry a
      // structured API error, because a POST may already have reached the app.
      const retryDelays = Array.isArray(gatewayRetryDelaysMs)
        ? gatewayRetryDelaysMs.slice(0, 9).map(value => Number.isFinite(Number(value))
          ? Math.min(12000, Math.max(0, Number(value)))
          : 0)
        : [1500, 2500, 4000, 6000, 8000, 10000, 12000];
      let gatewayRetries = 0;
      if ([502, 503].includes(upstream.status) && !isJsonResponse(upstream)) {
        logger.warn?.("ULTRON upstream returned a non-JSON gateway response", {
          status: upstream.status,
          contentType: String(upstream.headers.get("content-type") || "unknown").slice(0, 100)
        });
        while (gatewayRetries < retryDelays.length && !controller.signal.aborted &&
          [502, 503].includes(upstream.status) && !isJsonResponse(upstream)) {
          try { await upstream.body?.cancel?.(); } catch {}
          const waitMs = retryDelays[gatewayRetries];
          gatewayRetries += 1;
          if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
          if (controller.signal.aborted) break;
          try {
            upstream = await fetchImpl(target, forwardOptions);
          } catch (retryError) {
            logger.warn?.("ULTRON gateway retry could not connect", {
              retry: gatewayRetries,
              name: retryError?.name || "Error"
            });
            if (gatewayRetries >= retryDelays.length) {
              sendJson(res, 502, {
                error: {
                  code: "CORE_BACKEND_UNAVAILABLE",
                  message: "ULTRON Core could not reconnect after " + gatewayRetries + " retries. Its free service may still be waking up. Please retry shortly."
                }
              });
              return;
            }
            // Continue bounded retries for a transient transport failure following a gateway error.
            upstream = new Response("<html>Upstream connection unavailable</html>", {
              status: 502,
              headers: { "Content-Type": "text/html; charset=utf-8" }
            });
          }
        }
      }

      if ([502, 503].includes(upstream.status) && !isJsonResponse(upstream)) {
        const status = upstream.status;
        try { await upstream.body?.cancel?.(); } catch {}
        sendJson(res, status, {
          error: {
            code: status === 502 ? "CORE_GATEWAY_502" : "CORE_BACKEND_UNAVAILABLE",
            message: "ULTRON Core returned an upstream " + status + " gateway response after " + gatewayRetries + " retries (" + (gatewayRetries + 1) + " attempts). This can happen while the free backend wakes from idle; please retry shortly."
          }
        });
        return;
      }

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
  const port = Number(process.env.UI_PORT || (process.env.PORT && process.env.PORT !== "10000" ? process.env.PORT : null)) || 3000;
  const server = createUltronCoreProxy();
  server.listen(port, "0.0.0.0", () => console.log("ULTRON CORE interface listening on port " + port));
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
