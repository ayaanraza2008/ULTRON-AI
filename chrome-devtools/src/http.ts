import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createChromeController } from "./controller.js";
import { ChromeActionError } from "./security.js";

const MAX_BODY_BYTES = 16 * 1024;
const MIN_TOKEN_LENGTH = 32;
const env = process.env;
const token = (env.CHROME_BRIDGE_TOKEN || "").trim();
const remoteAllowed = env.CHROME_BRIDGE_ALLOW_REMOTE === "true";
const host = remoteAllowed ? (env.CHROME_BRIDGE_HOST || "0.0.0.0") : "127.0.0.1";
const portValue = Number(env.CHROME_BRIDGE_PORT || 4783);
const port = Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535 ? portValue : 4783;
const allowedHosts = (env.CHROME_BRIDGE_ALLOWED_HOSTS || "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

if (token.length < MIN_TOKEN_LENGTH) {
  throw new Error("Set CHROME_BRIDGE_TOKEN to a random secret of at least 32 characters before starting the HTTP bridge.");
}
if (remoteAllowed && allowedHosts.length === 0) {
  throw new Error("Remote binding requires CHROME_BRIDGE_ALLOWED_HOSTS with exact gateway hostnames; terminate HTTPS at a trusted gateway.");
}
if (!remoteAllowed && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  throw new Error("The Chrome bridge binds to loopback unless CHROME_BRIDGE_ALLOW_REMOTE=true is explicitly set.");
}

const controller = createChromeController(env);

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  res.end(body);
}

function safeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostAllowed(req: IncomingMessage): boolean {
  const value = String(req.headers.host || "");
  let hostname = "";
  try { hostname = new URL("http://" + value).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""); }
  catch { return false; }
  if (remoteAllowed) return allowedHosts.includes(hostname);
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (remoteAllowed) return allowedHosts.includes(hostname);
    return ["127.0.0.1", "localhost", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new ChromeActionError("BODY_TOO_LARGE", "Request body exceeds 16 KB.", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    throw new ChromeActionError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}

const server = createServer(async (req, res) => {
  if (!hostAllowed(req)) {
    writeJson(res, 403, { ok: false, error: { code: "HOST_NOT_ALLOWED", message: "Host header is not allowed." } });
    return;
  }
  if (!originAllowed(req)) {
    writeJson(res, 403, { ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin header is not allowed." } });
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") {
    writeJson(res, 200, { ok: true, component: "ultron-chrome-devtools-bridge", transport: "authenticated-local-http" });
    return;
  }
  if (req.method !== "POST" || req.url !== "/action") {
    writeJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Route not found." } });
    return;
  }
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const headerToken = String(req.headers["x-ultron-chrome-token"] || "");
  if (!safeEqual(bearer || headerToken, token)) {
    writeJson(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "A valid bridge token is required." } });
    return;
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    writeJson(res, 415, { ok: false, error: { code: "JSON_REQUIRED", message: "Use application/json." } });
    return;
  }
  try {
    const input = await readJson(req);
    const result = await controller.execute(input);
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    if (error instanceof ChromeActionError) {
      writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
      return;
    }
    writeJson(res, 502, { ok: false, error: { code: "CHROME_ACTION_FAILED", message: "Chrome DevTools action could not complete. Verify that the local browser is running and debuggable." } });
  }
});

server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(port, host, () => {
  process.stderr.write("ULTRON Chrome DevTools bridge listening on " + host + ":" + port + "\n");
  if (remoteAllowed) {
    process.stderr.write("WARNING: Remote binding is enabled; place this service behind a trusted HTTPS gateway and keep the token secret.\n");
  }
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
