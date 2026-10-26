import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable, Transform } from "node:stream";
import { isPublicNetworkHost, safeServiceBase } from "./network-safety.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;
const INTERNAL_ALLOW_LOOPBACK = Symbol("ultronSafeConfiguredLoopback");

function outboundError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizedHostname(value) {
  return String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
}

function parseIPv6Words(address) {
  const value = normalizedHostname(address);
  if (!value || value.includes("%") || value.includes(".")) return null;
  const splitAt = value.indexOf("::");
  let words;
  if (splitAt >= 0) {
    if (value.indexOf("::", splitAt + 2) >= 0) return null;
    const leftText = value.slice(0, splitAt);
    const rightText = value.slice(splitAt + 2);
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    words = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    words = value.split(":");
    if (words.length !== 8) return null;
  }
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map(word => Number.parseInt(word, 16));
}

/**
 * Conservatively accepts globally routable unicast IPs only. This intentionally
 * rejects transition, documentation, mapped, private, reserved and special-use
 * ranges rather than trying to enumerate only the most common private networks.
 */
export function isPublicDestinationAddress(address) {
  const version = isIP(normalizedHostname(address));
  if (version === 4) {
    const octets = normalizedHostname(address).split(".").map(Number);
    const [a, b, c] = octets;
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a >= 240) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (version !== 6) return false;
  const words = parseIPv6Words(address);
  if (!words) return false;
  // Reject IPv4-mapped IPv6, including its hexadecimal spelling.
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) return false;
  // Global unicast is within 2000::/3; the exclusions below are special-use.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false;
  if (words[0] === 0x2001 && words[1] <= 0x01ff) return false; // IETF special-purpose block.
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false; // Documentation.
  if (words[0] === 0x2002) return false; // 6to4 transition.
  if (words[0] === 0x3fff && words[1] <= 0x0fff) return false; // Documentation.
  return true;
}

function isLoopbackAddress(address) {
  const host = normalizedHostname(address);
  if (isIP(host) === 4) return Number(host.split(".")[0]) === 127;
  const words = parseIPv6Words(host);
  return Boolean(words && words.slice(0, 7).every(word => word === 0) && words[7] === 1);
}

function validHostnameSyntax(host) {
  if (!host || host.length > 253 || host.endsWith(".") || host.includes("..")) return false;
  if (!isPublicNetworkHost(host)) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every(label =>
    label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

async function resolveAllDnsAddresses(host) {
  if (LOCAL_HOSTS.has(normalizedHostname(host))) {
    // Local-development loopback is permitted only through the explicit
    // configuration wrapper; consult the OS resolver for hosts-file entries.
    return dns.lookup(host, { all: true, verbatim: true });
  }
  const noRecordCodes = new Set(["ENODATA", "ENOTFOUND"]);
  const resolveFamily = async resolver => {
    try {
      return await resolver(host);
    } catch (error) {
      if (noRecordCodes.has(error?.code)) return [];
      // Resolver timeouts/SERVFAIL and similar errors are not equivalent to
      // an empty RRset; fail closed rather than trust an incomplete DNS view.
      throw error;
    }
  };
  const [v4, v6] = await Promise.all([
    resolveFamily(name => dns.resolve4(name)),
    resolveFamily(name => dns.resolve6(name))
  ]);
  return [
    ...v4.map(address => ({ address, family: 4 })),
    ...v6.map(address => ({ address, family: 6 }))
  ];
}

function normalizeLookupResults(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value.address === "string") return [value];
  return [];
}

function awaitWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(signal.reason || outboundError("OUTBOUND_ABORTED", "Outbound request was cancelled."));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || outboundError("OUTBOUND_ABORTED", "Outbound request was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => { signal.removeEventListener("abort", onAbort); resolve(value); },
      error => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

async function readBodyLimited(stream, maxBytes, signal) {
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const item = await awaitWithSignal(reader.read(), signal);
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw outboundError("OUTBOUND_REQUEST_TOO_LARGE", "Outbound request body exceeds the configured size limit.");
      }
      chunks.push(chunk);
    }
    return total ? Buffer.concat(chunks, total) : Buffer.alloc(0);
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function hasOnlySupportedContentEncoding(headers) {
  const encoding = String(headers["content-encoding"] || "").trim().toLowerCase();
  return !encoding || encoding === "identity";
}

function toWebHeaders(rawHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, String(item));
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}

function pinnedNodeRequest({ url, address, family, method, headers, body, signal, maxResponseBytes }) {
  const transport = url.protocol === "https:" ? https : http;
  const hostname = normalizedHostname(url.hostname);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const nodeHeaders = Object.fromEntries(headers.entries());
  // Do not allow callers to override the Host header or use a pooled connection.
  nodeHeaders.host = url.host;
  nodeHeaders.connection = "close";
  nodeHeaders["accept-encoding"] = "identity";
  if (body && body.byteLength > 0) nodeHeaders["content-length"] = String(body.byteLength);
  else delete nodeHeaders["content-length"];

  return new Promise((resolve, reject) => {
    let settled = false;
    const req = transport.request({
      protocol: url.protocol,
      hostname,
      port,
      method,
      path: url.pathname + url.search,
      headers: nodeHeaders,
      agent: false,
      signal,
      lookup: (_requestedHost, options, callback) => {
        // The connector must use the exact vetted address, not issue another DNS
        // lookup that could observe a rebinding answer.
        if (options && options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      ...(url.protocol === "https:" ? {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        servername: isIP(hostname) ? undefined : hostname
      } : {})
    }, incoming => {
      const status = Number(incoming.statusCode || 0);
      const responseHeaders = toWebHeaders(incoming.headers);
      const declaredLength = Number(responseHeaders.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        incoming.destroy();
        settled = true;
        reject(outboundError("OUTBOUND_RESPONSE_TOO_LARGE", "Outbound response exceeds the configured size limit."));
        return;
      }
      if (!hasOnlySupportedContentEncoding(incoming.headers)) {
        incoming.destroy();
        settled = true;
        reject(outboundError("OUTBOUND_COMPRESSION_UNSUPPORTED", "Compressed upstream responses are not accepted by this bounded transport."));
        return;
      }
      if ([204, 205, 304].includes(status)) {
        incoming.resume();
        settled = true;
        resolve(new Response(null, { status, statusText: incoming.statusMessage || "", headers: responseHeaders }));
        return;
      }
      let seenBytes = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          seenBytes += chunk.byteLength;
          if (seenBytes > maxResponseBytes) {
            callback(outboundError("OUTBOUND_RESPONSE_TOO_LARGE", "Outbound response exceeds the configured size limit."));
          } else {
            callback(null, chunk);
          }
        }
      });
      limiter.on("error", () => incoming.destroy());
      limiter.on("close", () => { if (!incoming.complete) incoming.destroy(); });
      incoming.pipe(limiter);
      const bodyStream = Readable.toWeb(limiter);
      try {
        settled = true;
        resolve(new Response(bodyStream, { status, statusText: incoming.statusMessage || "", headers: responseHeaders }));
      } catch {
        incoming.destroy();
        reject(outboundError("OUTBOUND_RESPONSE_INVALID", "Outbound response could not be represented safely."));
      }
    });
    req.on("error", error => {
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        reject(outboundError("OUTBOUND_ABORTED", "Outbound request was cancelled or timed out."));
      } else if (error?.code === "OUTBOUND_RESPONSE_TOO_LARGE" || error?.code === "OUTBOUND_COMPRESSION_UNSUPPORTED") {
        reject(error);
      } else {
        reject(outboundError("OUTBOUND_REQUEST_FAILED", "Outbound request failed."));
      }
    });
    if (body && body.byteLength) req.write(body);
    req.end();
  });
}

function stripSensitiveHeaders(headers) {
  for (const name of [...headers.keys()]) {
    const normalized = name.toLowerCase();
    if (normalized === "authorization" || normalized === "cookie" || normalized === "proxy-authorization" ||
        normalized === "x-api-key" || normalized.includes("token") || normalized.includes("secret") ||
        normalized.includes("api-key") || normalized.includes("apikey")) {
      headers.delete(name);
    }
  }
}

function parseAndValidateUrl(value, { allowLoopbackHttp, allowedPorts }) {
  let url;
  const rawValue = value instanceof URL ? value.href : String(value);
  if (/%(?![0-9a-f]{2})/i.test(rawValue)) {
    throw outboundError("OUTBOUND_URL_INVALID", "Outbound URL contains malformed percent encoding.");
  }
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(rawValue);
  } catch {
    throw outboundError("OUTBOUND_URL_INVALID", "Outbound URL is malformed.");
  }
  const host = normalizedHostname(url.hostname);
  if (!host || url.username || url.password || url.hash) {
    throw outboundError("OUTBOUND_URL_INVALID", "Outbound URL contains disallowed URL components.");
  }
  const localHttpAllowed = allowLoopbackHttp === true && url.protocol === "http:" && LOCAL_HOSTS.has(host);
  if (url.protocol !== "https:" && !localHttpAllowed) {
    throw outboundError("OUTBOUND_SCHEME_BLOCKED", "Only HTTPS outbound requests are allowed unless loopback HTTP was explicitly enabled.");
  }
  const hostIpVersion = isIP(host);
  if (hostIpVersion !== 0 && !(localHttpAllowed && isLoopbackAddress(host)) && !isPublicDestinationAddress(host)) {
    throw outboundError("OUTBOUND_ADDRESS_BLOCKED", "Outbound IP literal is not a public destination.");
  }
  if (hostIpVersion === 0 && !validHostnameSyntax(host) && !(localHttpAllowed && host === "localhost")) {
    throw outboundError("OUTBOUND_HOST_BLOCKED", "Outbound hostname is not eligible for network access.");
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (port < 1 || port > 65535) throw outboundError("OUTBOUND_PORT_BLOCKED", "Outbound port is not supported.");
  if (url.protocol === "https:" && port !== 443 && !allowedPorts.includes(port)) {
    throw outboundError("OUTBOUND_PORT_BLOCKED", "Nonstandard HTTPS ports require explicit allowlisting.");
  }
  if (url.protocol === "http:" && !localHttpAllowed) {
    throw outboundError("OUTBOUND_SCHEME_BLOCKED", "HTTP is disabled for non-loopback destinations.");
  }
  return url;
}

async function resolvePinnedAddress(url, { lookupImpl, signal, allowLoopbackHttp }) {
  const host = normalizedHostname(url.hostname);
  const version = isIP(host);
  let records;
  try {
    records = version
      ? [{ address: host, family: version }]
      : normalizeLookupResults(await awaitWithSignal(lookupImpl(host, { all: true, verbatim: true }), signal));
  } catch {
    throw outboundError("OUTBOUND_DNS_FAILED", "Outbound hostname could not be resolved safely.");
  }
  if (!records.length) throw outboundError("OUTBOUND_DNS_FAILED", "Outbound hostname returned no addresses.");
  const localHttpAllowed = allowLoopbackHttp === true && url.protocol === "http:" && LOCAL_HOSTS.has(host);
  const checked = records.map(record => ({
    address: normalizedHostname(record.address),
    family: Number(record.family) || isIP(normalizedHostname(record.address))
  }));
  const everyAddressAllowed = checked.every(record => record.family === isIP(record.address) &&
    (localHttpAllowed ? isLoopbackAddress(record.address) : isPublicDestinationAddress(record.address)));
  if (!everyAddressAllowed) {
    throw outboundError("OUTBOUND_ADDRESS_BLOCKED", "Outbound hostname resolves to a non-public or unsupported network address.");
  }
  return checked[0];
}

/**
 * Fetch-compatible HTTPS transport with DNS-pinned connections.
 * Resolves all A/AAAA records, rejects mixed public/private answers, pins the
 * chosen validated address into the actual socket lookup, disables connection
 * pooling, verifies TLS against the original hostname, and revalidates redirects.
 *
 * Loopback HTTP requires a module-private capability set only by the configured-origin
 * wrapper. The similarly named public option is ignored. Nonstandard HTTPS ports
 * require the explicit ultronAllowedPorts option. Compressed upstream bodies are
 * rejected so decompression cannot bypass the response byte cap.
 */
export function createSafeOutboundFetch({
  lookupImpl = resolveAllDnsAddresses,
  requestImpl = pinnedNodeRequest,
  maxRedirects = 3,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return async function safeOutboundFetch(input, init = {}) {
    const redirectMode = init.redirect || "follow";
    if (!["follow", "error", "manual"].includes(redirectMode)) {
      throw outboundError("OUTBOUND_REDIRECT_MODE_INVALID", "Outbound redirect mode is invalid.");
    }
    const perCallTimeout = Number(init.ultronTimeoutMs);
    const deadlineMs = Number.isFinite(perCallTimeout) && perCallTimeout >= 1000
      ? Math.min(perCallTimeout, 10 * 60 * 1000) : timeoutMs;
    const timeoutSignal = AbortSignal.timeout(deadlineMs);
    const signals = [init.signal, timeoutSignal].filter(Boolean);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const allowedPorts = Array.isArray(init.ultronAllowedPorts)
      ? init.ultronAllowedPorts.filter(port => Number.isInteger(port) && port >= 1 && port <= 65535)
      : [];
    const allowLoopbackHttp = init[INTERNAL_ALLOW_LOOPBACK] === true;
    const responseLimit = Number.isInteger(init.ultronMaxResponseBytes) && init.ultronMaxResponseBytes > 0
      ? Math.min(init.ultronMaxResponseBytes, 50 * 1024 * 1024) : maxResponseBytes;
    const requestLimit = Number.isInteger(init.ultronMaxRequestBytes) && init.ultronMaxRequestBytes > 0
      ? Math.min(init.ultronMaxRequestBytes, 50 * 1024 * 1024) : maxRequestBytes;
    const maxHops = Number.isInteger(init.ultronMaxRedirects) && init.ultronMaxRedirects >= 0
      ? Math.min(init.ultronMaxRedirects, MAX_REDIRECTS) : Math.min(maxRedirects, MAX_REDIRECTS);
    const requestInit = { ...init };
    for (const key of ["ultronTimeoutMs", "ultronAllowedPorts", "ultronAllowLoopbackHttp", "ultronMaxResponseBytes", "ultronMaxRequestBytes", "ultronMaxRedirects", INTERNAL_ALLOW_LOOPBACK]) delete requestInit[key];
    requestInit.signal = signal;
    requestInit.redirect = "manual";

    let request;
    try {
      request = new Request(input, requestInit);
    } catch {
      throw outboundError("OUTBOUND_REQUEST_INVALID", "Outbound request options or body are invalid.");
    }
    let currentUrl = parseAndValidateUrl(request.url, { allowLoopbackHttp, allowedPorts });
    let method = request.method;
    let headers = new Headers(request.headers);
    let body = await readBodyLimited(request.body, requestLimit, signal);
    let redirects = 0;

    while (true) {
      if (signal?.aborted) throw outboundError("OUTBOUND_ABORTED", "Outbound request was cancelled or timed out.");
      currentUrl = parseAndValidateUrl(currentUrl, { allowLoopbackHttp, allowedPorts });
      const pin = await resolvePinnedAddress(currentUrl, { lookupImpl, signal, allowLoopbackHttp });
      let response;
      try {
        response = await awaitWithSignal(Promise.resolve(requestImpl({
          url: currentUrl,
          address: pin.address,
          family: pin.family,
          method,
          headers: new Headers(headers),
          body,
          signal,
          maxResponseBytes: responseLimit
        })), signal);
      } catch (error) {
        if (error?.code && String(error.code).startsWith("OUTBOUND_")) throw error;
        if (signal?.aborted) throw outboundError("OUTBOUND_ABORTED", "Outbound request was cancelled or timed out.");
        throw outboundError("OUTBOUND_REQUEST_FAILED", "Outbound request failed.");
      }
      const responseEncoding = String(response.headers?.get?.("content-encoding") || "").trim().toLowerCase();
      if (responseEncoding && responseEncoding !== "identity") {
        try { await response.body?.cancel?.(); } catch {}
        throw outboundError("OUTBOUND_COMPRESSION_UNSUPPORTED", "Compressed upstream responses are not accepted by this bounded transport.");
      }
      const declaredResponseLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declaredResponseLength) && declaredResponseLength > responseLimit) {
        try { await response.body?.cancel?.(); } catch {}
        throw outboundError("OUTBOUND_RESPONSE_TOO_LARGE", "Outbound response exceeds the configured size limit.");
      }
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers?.get?.("location");
      if (!location || redirectMode === "manual") return response;
      if (redirectMode === "error") {
        try { await response.body?.cancel?.(); } catch {}
        throw outboundError("OUTBOUND_REDIRECT_BLOCKED", "Outbound redirect was rejected by policy.");
      }
      if (redirects >= maxHops) {
        try { await response.body?.cancel?.(); } catch {}
        throw outboundError("OUTBOUND_REDIRECT_LIMIT", "Outbound redirect limit was exceeded.");
      }
      let nextUrl;
      try { nextUrl = new URL(location, currentUrl); }
      catch {
        try { await response.body?.cancel?.(); } catch {}
        throw outboundError("OUTBOUND_REDIRECT_INVALID", "Outbound redirect target is malformed.");
      }
      // Validate the redirect target before issuing any further connection. The
      // next loop resolves it anew and pins the exact resulting public address.
      parseAndValidateUrl(nextUrl, { allowLoopbackHttp, allowedPorts });
      try { await response.body?.cancel?.(); } catch {}
      if (nextUrl.origin !== currentUrl.origin) stripSensitiveHeaders(headers);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = null;
        headers.delete("content-type");
        headers.delete("content-length");
        headers.delete("transfer-encoding");
      }
      currentUrl = nextUrl;
      redirects += 1;
    }
  };
}


export const safeOutboundFetch = createSafeOutboundFetch();

/**
 * Wrap the safe transport with narrowly-scoped loopback HTTP support for
 * explicitly configured local development services. This does not allow
 * arbitrary request URLs to opt themselves into loopback access: the exact
 * HTTP origin must be present in an owner-controlled environment setting.
 */
export function createConfiguredOutboundFetch({
  env = process.env,
  fetchImpl = safeOutboundFetch,
  baseUrlEnvNames = [],
  includeModelProviderRegistry = false
} = {}) {
  const approvedLoopbackOrigins = new Set();
  const addConfiguredBase = value => {
    const normalized = safeServiceBase(typeof value === "string" ? value : "");
    if (!normalized) return;
    try {
      const url = new URL(normalized);
      if (url.protocol === "http:" && LOCAL_HOSTS.has(normalizedHostname(url.hostname))) {
        approvedLoopbackOrigins.add(url.origin);
      }
    } catch { /* Invalid optional configuration is ignored and fails closed. */ }
  };
  for (const name of baseUrlEnvNames) addConfiguredBase(env[name]);

  if (includeModelProviderRegistry) {
    try {
      const providers = JSON.parse(env.ULTRON_MODEL_PROVIDERS_JSON || "[]");
      if (Array.isArray(providers)) {
        for (const provider of providers.slice(0, 12)) addConfiguredBase(provider?.baseUrl);
      }
    } catch { /* Malformed optional provider configuration is ignored. */ }
  }

  return (input, init = {}) => {
    let url;
    try {
      const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      url = new URL(raw);
    } catch { /* The underlying transport returns a consistent safe URL error. */ }
    const host = url ? normalizedHostname(url.hostname) : "";
    const localHttpRequest = Boolean(url && url.protocol === "http:" && LOCAL_HOSTS.has(host));
    const inheritedTrustedLoopback = localHttpRequest && init[INTERNAL_ALLOW_LOOPBACK] === true;
    const allowConfiguredLoopback = Boolean(
      localHttpRequest && (approvedLoopbackOrigins.has(url.origin) || inheritedTrustedLoopback)
    );
    return fetchImpl(input, {
      ...init,
      // Diagnostic-only option for injected adapters; the transport never trusts it.
      ultronAllowLoopbackHttp: allowConfiguredLoopback,
      [INTERNAL_ALLOW_LOOPBACK]: allowConfiguredLoopback
    });
  };
}

