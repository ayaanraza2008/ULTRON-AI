/**
 * ULTRON AI — Browser Automation Helper & URL Normalizer
 *
 * Implements intelligent web automation utilities (adapted from Source B ULTRONMAIN):
 * - Normalizes user inputs: bare words -> domain URLs, queries -> search engine URLs.
 * - Anti-SSRF and private network navigation protection.
 * - Comprehensive IPv4, IPv6, IPv4-mapped IPv6, octal, hex, dword loopback/private protection.
 * - Explicit test-only loopback exception gate.
 * - Real user profile discovery on Windows (Chrome, Edge, Brave).
 * - Safe session context management.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const PRIVATE_IPV4_RANGES = [
  /^127\./,                                     // 127.0.0.0/8 Loopback
  /^10\./,                                      // 10.0.0.0/8 Private network
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,             // 172.16.0.0/12 Private network
  /^192\.168\./,                                // 192.168.0.0/16 Private network
  /^169\.254\./,                                // 169.254.0.0/16 Link-local / AWS / GCP / Azure metadata
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 Carrier-grade NAT
  /^192\.0\.(0|2)\./,                           // Reserved / Test
  /^198\.(1[89])\./,                            // Benchmark
  /^0\./                                        // 0.0.0.0/8 Current network
];

const PRIVATE_IPV6_RANGES = [
  /^::1$/,                                      // Loopback
  /^::$/,                                       // Unspecified
  /^fc00:/i,                                    // Unique local
  /^fd[0-9a-f]{2}:/i,                           // Unique local
  /^fe80:/i                                     // Link-local
];

export class BrowserAutomationHelper {
  constructor(options = {}) {
    this.searchEngine = options.searchEngine || "https://duckduckgo.com/?q=";
    this.allowLoopbackInTest = options.allowLoopbackInTest || false;
  }

  /**
   * Intelligently normalize user input into a valid HTTP/HTTPS URL
   * (Adapted from Source B _normalize_url).
   * - "github" -> "https://github.com"
   * - "wikipedia.org" -> "https://wikipedia.org"
   * - "how to build an agent" -> "https://duckduckgo.com/?q=how%20to%20build%20an%20agent"
   */
  normalizeUrl(rawInput) {
    const input = String(rawInput || "").trim();
    if (!input) return "about:blank";

    // Already has explicit URI scheme
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(input)) {
      return input;
    }

    // Contains whitespace -> search query
    if (/\s/.test(input)) {
      return `${this.searchEngine}${encodeURIComponent(input)}`;
    }

    // Has a dot and no spaces -> domain name
    if (input.includes(".") && !input.startsWith(".")) {
      return `https://${input}`;
    }

    // Bare alphanumeric word (e.g. "github", "reddit", "youtube") -> domain.com
    if (/^[a-zA-Z0-9_-]+$/.test(input)) {
      return `https://${input}.com`;
    }

    // Fallback to search query
    return `${this.searchEngine}${encodeURIComponent(input)}`;
  }

  /**
   * Strict Anti-SSRF check: Prevents model from navigating to internal networks or cloud metadata.
   * Defends against IPv4, IPv6, IPv4-mapped IPv6, octal, hex, dword, and DNS localhost tricks.
   * Allows explicit, secure loopback access only when configured strictly in test mode.
   */
  validateUrlSafety(rawUrl, options = {}) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return { safe: true, url: "about:blank" };

    // Reject non-HTTP/HTTPS schemes early
    const schemeMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/i);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (scheme !== "http" && scheme !== "https") {
        return {
          safe: false,
          reason: `Protocol '${scheme}:' is not allowed. Only HTTP and HTTPS are permitted.`
        };
      }
    }

    const urlStr = this.normalizeUrl(raw);
    if (urlStr === "about:blank") return { safe: true, url: urlStr };

    try {
      const parsed = new URL(urlStr);
      const protocol = parsed.protocol.toLowerCase();

      if (protocol !== "http:" && protocol !== "https:") {
        return {
          safe: false,
          reason: `Protocol '${protocol}' is not allowed. Only HTTP and HTTPS are permitted.`
        };
      }

      // Strip enclosing brackets for IPv6 hostnames (Node URL parser keeps brackets in parsed.hostname)
      let hostname = parsed.hostname.toLowerCase();
      if (hostname.startsWith("[") && hostname.endsWith("]")) {
        hostname = hostname.slice(1, -1);
      }

      // Check explicit test-only loopback exception:
      // Permitted ONLY if explicitly requested AND running in test environment.
      // Production must never gain unrestricted loopback access.
      const testLoopbackAllowed = (options.allowLoopbackInTest || this.allowLoopbackInTest) &&
        (process.env.NODE_ENV === "test" || process.env.ULTRON_TEST_ALLOW_LOCALHOST === "true");

      const isLocalhostDomain = hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "localhost.localdomain";

      if (isLocalhostDomain) {
        if (testLoopbackAllowed) {
          return { safe: true, url: parsed.toString(), testLoopbackPermitted: true };
        }
        return {
          safe: false,
          reason: "Navigation to localhost is blocked for security (anti-SSRF)."
        };
      }

      // Block 0.0.0.0 and bare 0
      if (hostname === "0.0.0.0" || hostname === "0" || hostname === "0000" || hostname === "0x0") {
        return {
          safe: false,
          reason: "Navigation to 0.0.0.0 is blocked (anti-SSRF)."
        };
      }

      // Detect and handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
      let checkIpv4 = hostname;
      if (hostname.startsWith("::ffff:")) {
        const rest = hostname.slice(7);
        if (rest.includes(".")) {
          checkIpv4 = rest;
        } else if (rest.includes(":")) {
          const parts = rest.split(":");
          if (parts.length === 2) {
            const high = parseInt(parts[0], 16);
            const low = parseInt(parts[1], 16);
            if (Number.isFinite(high) && Number.isFinite(low)) {
              const b1 = (high >> 8) & 0xff;
              const b2 = high & 0xff;
              const b3 = (low >> 8) & 0xff;
              const b4 = low & 0xff;
              checkIpv4 = `${b1}.${b2}.${b3}.${b4}`;
            }
          }
        }
      }

      // Check loopback IP
      if (checkIpv4 === "127.0.0.1" || hostname === "::1" || hostname === "::") {
        if (testLoopbackAllowed) {
          return { safe: true, url: parsed.toString(), testLoopbackPermitted: true };
        }
        return {
          safe: false,
          reason: "Navigation to localhost is blocked for security (anti-SSRF)."
        };
      }

      // Check IPv4 private and link-local/cloud metadata ranges
      for (const regex of PRIVATE_IPV4_RANGES) {
        if (regex.test(checkIpv4)) {
          return {
            safe: false,
            reason: `Navigation to private / metadata IP '${hostname}' is blocked (anti-SSRF).`
          };
        }
      }

      // Check IPv6 private/link-local ranges
      for (const regex of PRIVATE_IPV6_RANGES) {
        if (regex.test(hostname)) {
          return {
            safe: false,
            reason: `Navigation to private / link-local IPv6 '${hostname}' is blocked (anti-SSRF).`
          };
        }
      }

      return { safe: true, url: parsed.toString() };
    } catch (err) {
      return { safe: false, reason: `Malformed URL: ${err.message}` };
    }
  }

  /**
   * Discover real user browser profile directories on host (Source B adaptation).
   */
  async findBrowserProfileDirs() {
    if (process.platform !== "win32") {
      return [];
    }

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const candidates = [
      { browser: "chrome", dir: path.join(localAppData, "Google", "Chrome", "User Data") },
      { browser: "edge", dir: path.join(localAppData, "Microsoft", "Edge", "User Data") },
      { browser: "brave", dir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data") }
    ];

    const discovered = [];
    for (const item of candidates) {
      try {
        const stat = await fs.stat(item.dir);
        if (stat.isDirectory()) {
          discovered.push({ browser: item.browser, path: item.dir, exists: true });
        }
      } catch {}
    }
    return discovered;
  }
}

export const browserAutomationHelper = new BrowserAutomationHelper();
