import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable, Transform } from "node:stream";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { isPublicNetworkHost, safeServiceBase } from "./network-safety.js";

const MAX_URL_LENGTH = 8192;
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const DNS_TIMEOUT_MS = 5000;
const NO_BODY_STATUSES = new Set([204, 205, 304]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function cleanHost(host) {
  return String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isLoopback(host) {
  return LOOPBACK_HOSTS.has(cleanHost(host));
}

function safeError(message, code = "UNSAFE_OUTBOUND_TARGET") {
  return Object.assign(new Error(message), { code });
}

async function lookupBounded(lookupImpl, host) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => lookupImpl(host, { all: true, verbatim: true })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(safeError("DNS lookup timed out.", "OUTBOUND_DNS_TIMEOUT")), DNS_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    throw safeError(
      error?.code === "OUTBOUND_DNS_TIMEOUT" ? "DNS lookup timed out." : "Could not safely resolve outbound hostname.",
      error?.code === "OUTBOUND_DNS_TIMEOUT" ? error.code : "OUTBOUND_DNS_FAILED"
    );
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePinnedAddress(url, lookupImpl) {
  const host = cleanHost(url.hostname);
  const local = isLoopback(host);
  // Validate the origin, not the full path/query: research APIs legitimately use query strings.
  if (url.username || url.password || !safeServiceBase(url.origin)) {
    throw safeError("Outbound URL origin is not permitted.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw safeError("Outbound HTTP is permitted only for explicit loopback development services.");
  }

  const literalFamily = isIP(host);
  if (literalFamily) {
    if (local && url.protocol === "http:") return { address: host, family: literalFamily };
    if (!isPublicNetworkHost(host)) throw safeError("Outbound IP literal is not public.");
    return { address: host, family: literalFamily };
  }
  if (!isPublicNetworkHost(host) && !local) throw safeError("Outbound hostname is not public.");

  const results = await lookupBounded(lookupImpl, host);
  if (!Array.isArray(results) || results.length === 0) {
    throw safeError("Outbound hostname did not resolve to an address.", "OUTBOUND_DNS_FAILED");
  }
  // Reject mixed public/private answer sets rather than leaving a private address
  // eligible for a later connection attempt.
  for (const result of results) {
    const address = cleanHost(result?.address);
    const family = Number(result?.family) || isIP(address);
    if (!address || !family) throw safeError("DNS returned an invalid address.", "OUTBOUND_DNS_FAILED");
    if (local ? !isLoopback(address) : !isPublicNetworkHost(address)) {
      throw safeError("DNS resolved outbound hostname to a non-public address.");
    }
  }
  const selected = results[0];
  return { address: selected.address, family: Number(selected.family) || isIP(selected.address) };
}

function pinnedLookup(expectedHost, pinned) {
  const expected = cleanHost(expectedHost);
  return (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (cleanHost(hostname) !== expected) {
      return callback(safeError("Unexpected hostname passed to pinned DNS lookup."));
    }
    const result = { address: pinned.address, family: pinned.family };
    if (options && typeof options === "object" && options.all) return callback(null, [result]);
    return callback(null, result.address, result.family);
  };
}

function buildHeaders(input) {
  const source = new Headers(input || {});
  for (const key of ["host", "connection", "transfer-encoding", "content-length"]) source.delete(key);
  // Do not request transport compression; expose upstream bytes as a Fetch Response.
  if (!source.has("accept-encoding")) source.set("accept-encoding", "identity");
  return source;
}

function escapeQuoted(value) {
  return String(value).replace(/[\r\n"]/g, ch => ch === "\"" ? "%22" : " ");
}

function boundedBuffer(buffer, maxBytes = MAX_REQUEST_BODY_BYTES) {
  if (buffer.byteLength > maxBytes) {
    throw safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE");
  }
  return { buffer, stream: null };
}

function boundedStream(stream, maxBytes = MAX_REQUEST_BODY_BYTES) {
  let totalBytes = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        callback(safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE"));
        return;
      }
      callback(null, buffer);
    }
  });
  stream.once("error", error => limiter.destroy(error));
  limiter.once("error", () => {
    // Stop upstream production immediately when the byte cap rejects a chunk.
    if (!stream.destroyed) stream.destroy();
  });
  return stream.pipe(limiter);
}

async function encodeBody(body, headers, maxBytes = MAX_REQUEST_BODY_BYTES) {
  if (body === undefined || body === null) return { buffer: null, stream: null };
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > maxBytes) {
      throw safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE");
    }
    return boundedBuffer(Buffer.from(body), maxBytes);
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    const serialized = body.toString();
    if (Buffer.byteLength(serialized) > maxBytes) {
      throw safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE");
    }
    return boundedBuffer(Buffer.from(serialized), maxBytes);
  }
  if (body instanceof ArrayBuffer) return boundedBuffer(Buffer.from(body), maxBytes);
  if (ArrayBuffer.isView(body)) return boundedBuffer(Buffer.from(body.buffer, body.byteOffset, body.byteLength), maxBytes);
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    if (Number.isFinite(Number(body.size)) && Number(body.size) > maxBytes) {
      throw safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE");
    }
    return boundedBuffer(Buffer.from(await body.arrayBuffer()), maxBytes);
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const boundary = "----ultron-" + randomBytes(18).toString("hex");
    headers.set("content-type", "multipart/form-data; boundary=" + boundary);
    const chunks = [];
    let total = 0;
    const add = value => {
      const byteLength = Buffer.isBuffer(value) ? value.byteLength : Buffer.byteLength(value);
      if (total + byteLength > maxBytes) {
        throw safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE");
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.byteLength;
      chunks.push(chunk);
    };
    for (const [name, value] of body.entries()) {
      add("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + escapeQuoted(name) + "\"");
      if (typeof value !== "string" && value && typeof value.arrayBuffer === "function") {
        add("; filename=\"" + escapeQuoted(value.name || "blob") + "\"\r\nContent-Type: " + (value.type || "application/octet-stream") + "\r\n\r\n");
        if (Number.isFinite(Number(value.size)) && Number(value.size) > maxBytes - total) {
          throw safeError("Outbound request body exceeded the size limit.", "OUTBOUND_BODY_TOO_LARGE");
        }
        add(Buffer.from(await value.arrayBuffer()));
      } else {
        add("\r\n\r\n" + String(value));
      }
      add("\r\n");
    }
    add("--" + boundary + "--\r\n");
    return boundedBuffer(Buffer.concat(chunks), maxBytes);
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { buffer: null, stream: boundedStream(Readable.fromWeb(body), maxBytes) };
  }
  if (body instanceof Readable) return { buffer: null, stream: boundedStream(body, maxBytes) };
  if (typeof body?.pipe === "function") return { buffer: null, stream: boundedStream(body, maxBytes) };
  throw safeError("Outbound request body type is not supported.", "OUTBOUND_BODY_UNSUPPORTED");
}

function responseHeader(response, wantedName) {
  const direct = response.headers?.[wantedName];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;
  const raw = response.rawHeaders || [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (String(raw[i]).toLowerCase() === wantedName) return raw[i + 1];
  }
  return undefined;
}

function toResponse(response, { maxResponseBodyBytes = MAX_RESPONSE_BODY_BYTES, onBodyDone = () => {} } = {}) {
  const status = Number(response.statusCode) || 502;
  const headers = new Headers();
  const raw = response.rawHeaders || [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    try {
      headers.append(raw[i], raw[i + 1]);
    } catch {
      // Ignore malformed upstream headers.
    }
  }
  let body = null;
  if (NO_BODY_STATUSES.has(status)) {
    response.once?.("end", onBodyDone);
    response.once?.("close", onBodyDone);
    response.resume?.();
  } else {
    const declaredLength = Number(responseHeader(response, "content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBodyBytes) {
      response.destroy?.();
      onBodyDone();
      throw safeError("Outbound response body exceeded the size limit.", "OUTBOUND_RESPONSE_TOO_LARGE");
    }

    let totalBytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        totalBytes += buffer.byteLength;
        if (totalBytes > maxResponseBodyBytes) {
          callback(safeError("Outbound response body exceeded the size limit.", "OUTBOUND_RESPONSE_TOO_LARGE"));
          return;
        }
        callback(null, buffer);
      }
    });
    const finish = () => onBodyDone();
    limiter.once("end", finish);
    limiter.once("close", finish);
    limiter.once("error", () => {
      response.destroy?.();
      finish();
    });
    response.pipe(limiter);
    body = Readable.toWeb(limiter);
  }
  return new Response(body, { status, statusText: String(response.statusMessage || ""), headers });
}

/**
 * Fetch-compatible outbound transport that resolves DNS once, rejects private or
 * reserved targets, and pins the socket lookup to the exact validated address.
 * Redirects fail closed unless the caller explicitly asks to inspect them manually.
 * A custom fetchImpl can still be injected by tests.
 */
export function createSafeFetch({
  lookupImpl = dnsLookup,
  httpRequest = http.request,
  httpsRequest = https.request,
  maxRequestBodyBytes = MAX_REQUEST_BODY_BYTES,
  maxResponseBodyBytes = MAX_RESPONSE_BODY_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const bodyLimit = Number.isFinite(Number(maxRequestBodyBytes)) && Number(maxRequestBodyBytes) > 0
    ? Math.min(MAX_REQUEST_BODY_BYTES, Math.trunc(Number(maxRequestBodyBytes)))
    : MAX_REQUEST_BODY_BYTES;
  const responseBodyLimit = Number.isFinite(Number(maxResponseBodyBytes)) && Number(maxResponseBodyBytes) > 0
    ? Math.min(32 * 1024 * 1024, Math.trunc(Number(maxResponseBodyBytes)))
    : MAX_RESPONSE_BODY_BYTES;
  const requestTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(120_000, Math.max(1000, Math.trunc(Number(timeoutMs))))
    : DEFAULT_TIMEOUT_MS;
  return async function safeFetch(input, init = {}) {
    let rawUrl;
    let requestInit = { ...init };
    if (typeof Request !== "undefined" && input instanceof Request) {
      rawUrl = input.url;
      requestInit = {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
        redirect: input.redirect,
        ...init
      };
    } else {
      rawUrl = input instanceof URL ? input.toString() : input;
    }
    if (typeof rawUrl !== "string" || rawUrl.length > MAX_URL_LENGTH) {
      throw safeError("Outbound URL is invalid or too long.");
    }
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw safeError("Outbound URL is invalid.");
    }
    if (url.hash) throw safeError("Outbound URL fragments are not allowed.");
    const pinned = await resolvePinnedAddress(url, lookupImpl);
    if (requestInit.signal?.aborted) {
      throw requestInit.signal.reason || safeError("Outbound request was aborted.", "ABORT_ERR");
    }

    const method = String(requestInit.method || "GET").toUpperCase();
    const headers = buildHeaders(requestInit.headers);
    const encoded = await encodeBody(requestInit.body, headers, bodyLimit);
    if (requestInit.signal?.aborted) {
      if (encoded.stream && !encoded.stream.destroyed) encoded.stream.destroy();
      throw requestInit.signal.reason || safeError("Outbound request was aborted.", "ABORT_ERR");
    }

    // Avoid AbortSignal.any so the declared Node >=20 engine also covers early Node 20 releases.
    const signalController = new AbortController();
    const callerSignal = requestInit.signal;
    let timeoutTimer;
    let timeoutCleaned = false;
    const abortFromCaller = () => {
      if (!signalController.signal.aborted) {
        signalController.abort(callerSignal?.reason || safeError("Outbound request was aborted.", "ABORT_ERR"));
      }
    };
    const cleanupTimeout = () => {
      if (timeoutCleaned) return;
      timeoutCleaned = true;
      clearTimeout(timeoutTimer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    };
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    timeoutTimer = setTimeout(() => {
      if (!signalController.signal.aborted) {
        signalController.abort(safeError("Outbound request timed out.", "OUTBOUND_TIMEOUT"));
      }
    }, requestTimeoutMs);
    if (callerSignal?.aborted) abortFromCaller();
    if (signalController.signal.aborted) {
      cleanupTimeout();
      if (encoded.stream && !encoded.stream.destroyed) encoded.stream.destroy();
      throw signalController.signal.reason || safeError("Outbound request was aborted.", "ABORT_ERR");
    }
    const signal = signalController.signal;

    const outboundHeaders = {};
    for (const [key, value] of headers) outboundHeaders[key] = value;
    // Never accept upstream compression: byte caps should reflect the response users parse.
    outboundHeaders["accept-encoding"] = "identity";
    // Preserve the original hostname for Host/SNI while pinning socket resolution.
    outboundHeaders.host = url.host;
    if (encoded.buffer) {
      outboundHeaders["content-length"] = String(encoded.buffer.byteLength);
    }

    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanupTimeout();
        reject(error);
      };
      const requestOptions = {
        method,
        headers: outboundHeaders,
        lookup: pinnedLookup(url.hostname, pinned),
        signal
      };
      const transportRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
      let req;
      try {
        req = transportRequest(url, requestOptions, response => {
          const status = Number(response.statusCode) || 502;
          if (REDIRECT_STATUSES.has(status) && requestInit.redirect !== "manual") {
            response.destroy?.();
            fail(safeError("Outbound redirects are blocked; validate and request the destination explicitly.", "OUTBOUND_REDIRECT_BLOCKED"));
            return;
          }
          settled = true;
          try {
            resolve(toResponse(response, {
              maxResponseBodyBytes: responseBodyLimit,
              onBodyDone: cleanupTimeout
            }));
          } catch (error) {
            cleanupTimeout();
            reject(error);
          }
        });
      } catch (error) {
        fail(error);
        return;
      }
      req.once("error", fail);
      if (encoded.stream) {
        encoded.stream.once("error", error => req.destroy(error));
        req.once("close", () => {
          if (!encoded.stream.destroyed) encoded.stream.destroy();
        });
        encoded.stream.pipe(req);
      } else if (encoded.buffer) {
        req.end(encoded.buffer);
      } else {
        req.end();
      }
    });
  };
}

export const safeFetch = createSafeFetch();
