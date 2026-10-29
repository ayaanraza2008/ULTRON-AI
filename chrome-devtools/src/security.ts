import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const CHROME_ACTIONS = [
  "status",
  "navigate",
  "click",
  "fill",
  "screenshot",
  "page_snapshot",
  "console_logs",
  "network_requests",
  "performance_trace"
] as const;

export type ChromeAction = typeof CHROME_ACTIONS[number];

export interface ChromeActionInput {
  action: ChromeAction;
  url?: string;
  selector?: string;
  text?: string;
  limit?: number;
  durationMs?: number;
  confirmExternalAction?: boolean;
}

export class ChromeActionError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ChromeActionError";
    this.code = code;
    this.status = status;
  }
}

function hostnameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return normalized === "localhost" || normalized === "::1" || normalized === "127.0.0.1";
}

function looksLikeInternalHostname(host: string): boolean {
  return host === "metadata.google" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".localhost");
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0));
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return false;
    const parts = normalized.split(":");
    const first = Number.parseInt(parts[0] || "0", 16);
    const second = Number.parseInt(parts[1] || "0", 16);
    // Only global-unicast space is considered. Exclude IETF special-use,
    // documentation and deprecated 6to4 ranges within the global block.
    if (first < 0x2000 || first > 0x3fff) return false;
    if (first === 0x2001 && second <= 0x01ff) return false;
    if (first === 0x2001 && second === 0x0db8) return false;
    if (first === 0x2002) return false;
    return true;
  }
  return false;
}

export async function assertPublicBrowserTarget(url: URL, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const host = hostnameOf(url);
  if (isLoopbackHost(host)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), 3000);
      })
    ]);
    if (!addresses.length || addresses.some((item) => !isPublicIpAddress(item.address))) {
      throw new Error("Hostname resolved to a non-public address");
    }
  } catch {
    throw new ChromeActionError(
      "PRIVATE_TARGET_BLOCKED",
      "The browser target could not be confirmed as resolving only to public IP addresses.",
      403
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function validateBrowserUrl(raw: unknown, env: NodeJS.ProcessEnv = process.env): URL {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 2048) {
    throw new ChromeActionError("INVALID_URL", "Provide an HTTP or HTTPS URL up to 2048 characters.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ChromeActionError("INVALID_URL", "The browser URL is not valid.");
  }
  if (url.username || url.password || url.hash) {
    throw new ChromeActionError("INVALID_URL", "URLs with embedded credentials or fragments are not accepted.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ChromeActionError("URL_SCHEME_BLOCKED", "Only HTTP and HTTPS browser navigation is allowed.");
  }

  const host = hostnameOf(url);
  const loopback = isLoopbackHost(host);
  if (loopback) {
    if (env.CHROME_ALLOW_LOCALHOST === "false") {
      throw new ChromeActionError("LOCALHOST_DISABLED", "Local development URLs are disabled by CHROME_ALLOW_LOCALHOST.");
    }
    return url;
  }

  // Do not let an attached, authenticated browser be directed to raw IPs,
  // metadata endpoints, or obvious private/internal hostnames.
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (isIpLiteral || looksLikeInternalHostname(host) || !host.includes(".")) {
    throw new ChromeActionError("PRIVATE_TARGET_BLOCKED", "Private IPs, metadata endpoints, internal hostnames, and single-label hosts are blocked.");
  }
  if (url.protocol !== "https:") {
    throw new ChromeActionError("HTTPS_REQUIRED", "Non-local browser navigation requires HTTPS.");
  }
  return url;
}

export function validateCdpEndpoint(raw: unknown): string {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : "http://127.0.0.1:9222";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChromeActionError("CDP_ENDPOINT_INVALID", "CHROME_CDP_URL must be a valid local Chrome debugging URL.", 503);
  }
  const host = hostnameOf(url);
  if (url.protocol !== "http:" || !isLoopbackHost(host) || url.username || url.password || url.search || url.hash) {
    throw new ChromeActionError("CDP_ENDPOINT_BLOCKED", "Chrome DevTools Protocol must use a loopback HTTP endpoint; remote CDP endpoints are blocked.", 503);
  }
  return url.toString().replace(/\/+$/, "");
}

export function safeDisplayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (["data:", "blob:", "javascript:", "file:"].includes(url.protocol)) return "[" + url.protocol.replace(":", "") + " resource omitted]";
    url.search = "";
    url.hash = "";
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    return url.toString().slice(0, 1000);
  } catch {
    return "[unavailable URL]";
  }
}

export function validateChromeActionInput(value: unknown): ChromeActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChromeActionError("INVALID_ACTION", "Provide a Chrome DevTools action object.");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.action !== "string" || !(CHROME_ACTIONS as readonly string[]).includes(source.action)) {
    throw new ChromeActionError("ACTION_NOT_SUPPORTED", "Supported actions: " + CHROME_ACTIONS.join(", "));
  }
  const action = source.action as ChromeAction;
  const output: ChromeActionInput = { action };

  if (source.url !== undefined) {
    if (typeof source.url !== "string" || source.url.length > 2048) {
      throw new ChromeActionError("INVALID_URL", "URL must be a string up to 2048 characters.");
    }
    output.url = source.url;
  }
  if (source.selector !== undefined) {
    if (typeof source.selector !== "string" || source.selector.trim().length < 1 || source.selector.length > 600) {
      throw new ChromeActionError("INVALID_SELECTOR", "Provide a CSS/Playwright selector between 1 and 600 characters.");
    }
    output.selector = source.selector.trim();
  }
  if (source.text !== undefined) {
    if (typeof source.text !== "string" || source.text.length > 5000) {
      throw new ChromeActionError("INVALID_TEXT", "Form text must be a string up to 5000 characters.");
    }
    output.text = source.text;
  }
  if (source.limit !== undefined) {
    if (!Number.isInteger(source.limit) || (source.limit as number) < 1 || (source.limit as number) > 100) {
      throw new ChromeActionError("INVALID_LIMIT", "Limit must be an integer from 1 to 100.");
    }
    output.limit = source.limit as number;
  } else {
    output.limit = 30;
  }
  if (source.durationMs !== undefined) {
    if (!Number.isInteger(source.durationMs) || (source.durationMs as number) < 1000 || (source.durationMs as number) > 10000) {
      throw new ChromeActionError("INVALID_DURATION", "Trace duration must be an integer from 1000 to 10000 milliseconds.");
    }
    output.durationMs = source.durationMs as number;
  } else {
    output.durationMs = 3000;
  }
  if (source.confirmExternalAction !== undefined && typeof source.confirmExternalAction !== "boolean") {
    throw new ChromeActionError("INVALID_CONFIRMATION", "confirmExternalAction must be a boolean.");
  }
  output.confirmExternalAction = source.confirmExternalAction === true;

  if (action === "navigate" && !output.url) {
    throw new ChromeActionError("URL_REQUIRED", "navigate requires a url.");
  }
  if ((action === "click" || action === "fill") && !output.selector) {
    throw new ChromeActionError("SELECTOR_REQUIRED", action + " requires a selector.");
  }
  if (action === "fill" && output.text === undefined) {
    throw new ChromeActionError("TEXT_REQUIRED", "fill requires text.");
  }
  return output;
}
