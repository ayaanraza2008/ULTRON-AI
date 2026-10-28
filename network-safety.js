import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_SUFFIXES = [
  ".localhost", ".local", ".localdomain", ".internal", ".intranet",
  ".lan", ".home", ".test", ".invalid", ".example"
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DNS_LOOKUP_TIMEOUT_MS = 5000;

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function networkSafetyError(code, message) {
  return Object.assign(new Error(message), { code });
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError", code: "ABORT_ERR" });
}

function waitForPromiseOrAbort(value, signal, timeoutMs = 0) {
  const promise = Promise.resolve(value);
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (!signal && !(timeoutMs > 0)) return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
    };
    const settle = (callback, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(result);
    };
    const onAbort = () => settle(reject, abortError(signal));
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs > 0) {
      timer = setTimeout(() => settle(
        reject,
        networkSafetyError("DNS_LOOKUP_TIMEOUT", "The outbound hostname lookup timed out.")
      ), timeoutMs);
    }
    // Close the race where cancellation happens between the initial check and
    // listener registration.
    if (signal?.aborted) {
      onAbort();
      return;
    }
    promise.then(
      result => settle(resolve, result),
      error => settle(reject, error)
    );
  });
}

function isLoopbackAddress(address) {
  const host = normalizeHostname(address);
  const version = isIP(host);
  if (version === 4) return Number(host.split(".")[0]) === 127;
  if (version === 6) return host === "::1" || host === "0:0:0:0:0:0:0:1";
  return false;
}

function normalizeAddressRecords(records) {
  if (!Array.isArray(records)) return [];
  const unique = new Map();
  for (const record of records) {
    const address = normalizeHostname(record?.address);
    const family = Number(record?.family) || isIP(address);
    if (!address || !family || isIP(address) !== family) continue;
    unique.set(address, { address, family });
  }
  return [...unique.values()];
}

/**
 * Creates a Node lookup callback that returns only the already validated DNS
 * answers. HTTP clients must use this callback for the connection so they
 * cannot resolve the hostname a second time after validation.
 */
export function createPinnedDnsLookup(addresses, expectedHostname = "") {
  const pinned = normalizeAddressRecords(addresses);
  if (!pinned.length) {
    throw networkSafetyError("DNS_LOOKUP_EMPTY", "No validated outbound address is available.");
  }
  const expected = normalizeHostname(expectedHostname);
  return (hostname, options, callback) => {
    let opts = options;
    let cb = callback;
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    } else if (typeof opts === "number") {
      opts = { family: opts };
    }
    opts ||= {};
    if (typeof cb !== "function") return;

    if (expected && normalizeHostname(hostname) !== expected) {
      return process.nextTick(cb, networkSafetyError("DNS_PIN_HOST_MISMATCH", "The outbound connection hostname changed after validation."));
    }
    const family = Number(opts.family) || 0;
    const candidates = pinned.filter(record => !family || record.family === family);
    if (!candidates.length) {
      return process.nextTick(cb, networkSafetyError("DNS_PIN_FAMILY_UNAVAILABLE", "No validated address matches the requested network family."));
    }
    if (opts.all) return process.nextTick(cb, null, candidates.map(record => ({ ...record })));
    const selected = candidates[0];
    return process.nextTick(cb, null, selected.address, selected.family);
  };
}

async function resolvePinnedAddresses(hostname, { lookupImpl = dnsLookup, allowLoopback = false, signal, lookupTimeoutMs = DNS_LOOKUP_TIMEOUT_MS } = {}) {
  if (signal?.aborted) throw abortError(signal);
  const host = normalizeHostname(hostname);
  const version = isIP(host);
  if (version) {
    const allowed = allowLoopback ? isLoopbackAddress(host) : isPublicNetworkHost(host);
    if (!allowed) {
      throw networkSafetyError("DNS_TARGET_NOT_PUBLIC", "The outbound target is not a public address.");
    }
    return [{ address: host, family: version }];
  }

  if (allowLoopback) {
    if (host !== "localhost") {
      throw networkSafetyError("DNS_TARGET_NOT_LOOPBACK", "Local HTTP is permitted only for explicit loopback development targets.");
    }
  } else if (!isPublicNetworkHost(host)) {
    throw networkSafetyError("DNS_TARGET_NOT_PUBLIC", "The outbound hostname is not a public hostname.");
  }

  let records;
  try {
    const lookupPromise = Promise.resolve().then(() => lookupImpl(host, { all: true, verbatim: true }));
    records = normalizeAddressRecords(await waitForPromiseOrAbort(lookupPromise, signal, lookupTimeoutMs));
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError" || error?.code === "DNS_LOOKUP_TIMEOUT") throw error;
    throw networkSafetyError("DNS_LOOKUP_FAILED", "The outbound hostname could not be resolved safely.");
  }
  if (!records.length) {
    throw networkSafetyError("DNS_LOOKUP_EMPTY", "The outbound hostname returned no usable addresses.");
  }

  const unsafe = records.some(record => allowLoopback
    ? !isLoopbackAddress(record.address)
    : !isPublicNetworkHost(record.address));
  if (unsafe) {
    throw networkSafetyError("DNS_TARGET_NOT_PUBLIC", "The outbound hostname resolved to a private, reserved, or otherwise non-public address.");
  }
  return records;
}

/**
 * DNS-pinned outbound fetch for ULTRON's server-side HTTP calls.
 *
 * - Public remote services must use HTTPS and resolve exclusively to public IPs.
 * - Explicit HTTP loopback URLs remain available for local development.
 * - The validated answers are pinned into Node's connection lookup callback.
 * - Redirects are blocked by default and never followed automatically.
 * - An injected lookup/transport can be used by deterministic unit tests.
 *
 * Network egress firewall rules are still recommended as an independent layer.
 */
export async function safePinnedFetch(input, init = {}, dependencies = {}) {
  const {
    lookupImpl = dnsLookup,
    httpRequestImpl = httpRequest,
    httpsRequestImpl = httpsRequest,
    dnsTimeoutMs = DNS_LOOKUP_TIMEOUT_MS
  } = dependencies || {};
  const lookupTimeoutMs = Number.isFinite(dnsTimeoutMs)
    ? Math.min(30_000, Math.max(1, dnsTimeoutMs))
    : DNS_LOOKUP_TIMEOUT_MS;

  const redirectMode = init?.redirect ?? "error";
  const request = new Request(input, { ...init, redirect: redirectMode, duplex: "half" });
  const url = new URL(request.url);
  if (url.username || url.password || url.hash) {
    throw networkSafetyError("OUTBOUND_URL_INVALID", "Outbound URLs must not contain credentials or fragments.");
  }

  const hostname = normalizeHostname(url.hostname);
  const allowLoopback = url.protocol === "http:" && LOCAL_HOSTS.has(hostname);
  if (url.protocol !== "https:" && !allowLoopback) {
    throw networkSafetyError("OUTBOUND_PROTOCOL_BLOCKED", "Remote outbound requests require HTTPS; HTTP is allowed only for explicit loopback development targets.");
  }

  const addresses = await resolvePinnedAddresses(hostname, { lookupImpl, allowLoopback, signal: request.signal, lookupTimeoutMs });
  const lookup = createPinnedDnsLookup(addresses, hostname);
  const requestHeaders = new Headers(request.headers);
  // Node must generate Host from the validated request URL; callers cannot
  // override it independently from the target hostname or TLS server name.
  requestHeaders.delete("host");
  requestHeaders.delete("proxy-authorization");
  requestHeaders.delete("proxy-connection");
  // This transport does not transparently decompress like browser fetch. Ask
  // upstreams for an uncompressed body so downstream response parsing matches
  // the normal fetch contract.
  requestHeaders.set("accept-encoding", "identity");
  const headers = Object.fromEntries(requestHeaders.entries());
  const transport = url.protocol === "https:" ? httpsRequestImpl : httpRequestImpl;

  return await new Promise((resolve, reject) => {
    let outgoing;
    const handleResponse = incoming => {
      const status = Number(incoming.statusCode) || 502;
      const location = incoming.headers?.location;
      if (REDIRECT_STATUSES.has(status) && location && redirectMode !== "manual") {
        incoming.destroy?.();
        reject(networkSafetyError("OUTBOUND_REDIRECT_BLOCKED", "Outbound redirects are disabled to prevent unvalidated target changes."));
        return;
      }
      if (status < 200 || status > 599 || status === 101) {
        incoming.destroy?.();
        reject(networkSafetyError("OUTBOUND_STATUS_UNSUPPORTED", "The outbound server returned an unsupported HTTP status."));
        return;
      }

      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(key, String(item));
        } else {
          responseHeaders.set(key, String(value));
        }
      }
      const noBody = request.method.toUpperCase() === "HEAD" || [204, 205, 304].includes(status);
      const responseBody = noBody ? null : Readable.toWeb(incoming);
      if (noBody) incoming.resume?.();
      resolve(new Response(responseBody, {
        status,
        statusText: incoming.statusMessage || "",
        headers: responseHeaders
      }));
    };

    try {
      outgoing = transport(url, {
        method: request.method,
        headers,
        lookup,
        signal: request.signal,
        ...(url.protocol === "https:" && isIP(hostname) === 0 ? { servername: hostname } : {})
      }, handleResponse);
    } catch (error) {
      reject(error);
      return;
    }
    outgoing.on("error", reject);

    if (request.body) {
      const body = Readable.fromWeb(request.body);
      body.on("error", error => outgoing.destroy(error));
      body.pipe(outgoing);
    } else {
      outgoing.end();
    }
  });
}

/**
 * Accept public hostnames for remote services and reject obvious local/private
 * targets before a configured server-side credential is forwarded.
 *
 * Use safePinnedFetch for actual outbound requests: URL-shape validation alone
 * cannot prevent DNS rebinding. Network egress firewall controls are also
 * recommended in production.
 */
export function isPublicNetworkHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))
      || host === "metadata.google.internal" || host === "metadata.google") return false;

  const ipVersion = isIP(host);
  // Non-standard IPv4 forms such as 127.1, 0177.0.0.1, and 0x7f.0.0.1
  // may be interpreted as IP literals by URL/DNS stacks despite net.isIP() rejecting them.
  // Public service hostnames should not consist solely of numeric/hex-address-like labels.
  if (ipVersion === 0 && host.split(".").every(label => /^(?:[0-9]+|0x[0-9a-f]+)$/i.test(label))) return false;
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 192 && b === 88 && c === 99) return false; // Deprecated 6to4 relay anycast.
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }

  if (ipVersion === 6) {
    const hextets = host.split(":");
    const firstHextet = Number.parseInt(hextets[0] || "0", 16);
    const secondHextet = Number.parseInt(hextets[1] || "0", 16);
    // The IETF protocol-assignment block is 2001::/23. Reject the entire
    // special-purpose range rather than only a few known sub-prefixes.
    const inIetfProtocolAssignments = firstHextet === 0x2001
      && Number.isFinite(secondHextet) && secondHextet >= 0 && secondHextet <= 0x01ff;
    // Match the documentation prefix numerically so zero-padded hextets such
    // as 2001:0db8::1 cannot bypass a textual prefix check.
    const inDocumentationPrefix = firstHextet === 0x2001 && secondHextet === 0x0db8;
    if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd")
        || /^fe[89ab]/.test(host) || inDocumentationPrefix || inIetfProtocolAssignments
        || host.startsWith("2002:") || host.startsWith("3fff:")) return false;

    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicNetworkHost(mapped[1]);

    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      const ipv4 = [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join(".");
      return isPublicNetworkHost(ipv4);
    }

    // Public global-unicast IPv6 only; exclude reserved, local and transition forms.
    return firstHextet >= 0x2000 && firstHextet <= 0x3fff;
  }

  // Single-label hosts generally resolve via local DNS/search suffixes.
  return host.includes(".") && !host.startsWith(".") && !host.endsWith(".");
}

/**
 * Normalizes a configured upstream URL. HTTP is allowed only for loopback
 * development; remote services require HTTPS and a public-looking hostname/IP.
 */
export function safeServiceBase(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const loopback = LOCAL_HOSTS.has(host);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "http:" && loopback) return url.toString().replace(/\/+$/, "");
    if (url.protocol !== "https:" || !isPublicNetworkHost(url.hostname)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
