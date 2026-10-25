import { isIP } from "node:net";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_SUFFIXES = [
  ".localhost", ".local", ".localdomain", ".internal", ".intranet",
  ".lan", ".home", ".test", ".invalid"
];

/**
 * Accept public hostnames for remote services and reject obvious local/private
 * targets before a configured server-side credential is forwarded.
 *
 * This is defence in depth for explicit server configuration; it is not a
 * substitute for network egress controls or DNS-rebinding protections.
 */
export function isPublicNetworkHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))
      || host === "metadata.google.internal" || host === "metadata.google") return false;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 192 && b === 88 && c === 99) return false; // Deprecated 6to4 relay anycast.
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }

  if (ipVersion === 6) {
    const firstHextet = Number.parseInt(host.split(":")[0] || "0", 16);
    if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd")
        || /^fe[89ab]/.test(host) || host.startsWith("2001:db8:")
        || host.startsWith("2001:0:") || host.startsWith("2001:2:")
        || host.startsWith("2001:10:") || host.startsWith("2001:20:") || host.startsWith("2002:")
        || host.startsWith("3fff:")) return false;

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
