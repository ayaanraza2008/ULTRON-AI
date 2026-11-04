/**
 * ULTRON AI — Browser Automation Helper & URL Normalizer
 *
 * Implements intelligent web automation utilities (adapted from Source B ULTRONMAIN):
 * - Normalizes user inputs: bare words -> domain URLs, queries -> search engine URLs.
 * - Anti-SSRF and private network navigation protection.
 * - Real user profile discovery on Windows (Chrome, Edge, Brave).
 * - Safe session context management.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // AWS / GCP / Azure link-local metadata
  /^::1$/,
  /^fc00:/,
  /^fe80:/
];

export class BrowserAutomationHelper {
  constructor(options = {}) {
    this.searchEngine = options.searchEngine || "https://duckduckgo.com/?q=";
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
   */
  validateUrlSafety(rawUrl) {
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

      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return {
          safe: false,
          reason: "Navigation to localhost is blocked for security (anti-SSRF)."
        };
      }

      for (const regex of PRIVATE_IP_RANGES) {
        if (regex.test(hostname)) {
          return {
            safe: false,
            reason: `Navigation to private / metadata IP '${hostname}' is blocked (anti-SSRF).`
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
