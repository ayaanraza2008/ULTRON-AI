import { isIP } from "node:net";
import { isPublicNetworkHost, safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PAGE_TEXT = 12_000;

function bounded(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function loopbackHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "::1";
}

function endpointConfig(env, userId) {
  if (!env.ULTRON_INTEGRATION_OWNER_USER_ID || !userId ||
      env.ULTRON_INTEGRATION_OWNER_USER_ID !== userId) {
    return { error: blocked("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID to the owner's exact Supabase Auth UUID before exposing the Obscura bridge.") };
  }
  const raw = String(env.OBSCURA_MCP_URL || "");
  const normalized = safeServiceBase(raw);
  if (!normalized) {
    return { error: blocked(raw.trim() ? "OBSCURA_ENDPOINT_INVALID" : "OBSCURA_NOT_CONFIGURED",
      "Obscura MCP must use HTTPS through an authenticated public gateway, or loopback HTTP, and end in /mcp. No upstream request was made.") };
  }
  const url = new URL(normalized);
  const local = loopbackHost(url.hostname);
  if (!url.pathname.replace(/\/+$/, "").endsWith("/mcp") ||
      (url.port && url.port !== "443" && !local)) {
    return { error: blocked("OBSCURA_ENDPOINT_INVALID", "Obscura MCP must use HTTPS through an authenticated public gateway, or loopback HTTP, and end in /mcp. No upstream request was made.") };
  }
  const token = bounded(env.OBSCURA_MCP_TOKEN, 3000);
  if (!local && !token) {
    return { error: blocked("OBSCURA_GATEWAY_TOKEN_REQUIRED", "Remote Obscura MCP must sit behind a gateway that validates OBSCURA_MCP_TOKEN. Direct unauthenticated public MCP endpoints are disabled.") };
  }
  return { url: url.toString(), token, local };
}

function blocked(code, message) {
  return { state: "blocked", provider: "obscura", error: { code, message } };
}

function validatePublicTarget(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password ||
        url.port && url.port !== "443" ||
        !host.includes(".") || loopbackHost(host) || !isPublicNetworkHost(host) ||
        isIP(host) !== 0) return null;
    return url.toString();
  } catch { return null; }
}

async function readTextLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Obscura MCP response exceeded its size limit."), { code: "OBSCURA_RESPONSE_TOO_LARGE", status: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Obscura MCP response cannot be size-limited."), { code: "OBSCURA_RESPONSE_UNBOUNDED", status: 502 });
  const decoder = new TextDecoder();
  let text = "", size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Obscura MCP response exceeded its size limit."), { code: "OBSCURA_RESPONSE_TOO_LARGE", status: 502 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { try { reader.releaseLock(); } catch {} }
  return text;
}

function parseRpc(text, contentType) {
  const candidates = [];
  if (String(contentType || "").includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (data && data !== "[DONE]") candidates.push(data);
    }
  } else if (text.trim()) candidates.push(text.trim());
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed || "id" in parsed)) return parsed;
    } catch {}
  }
  if (!text.trim()) return null;
  throw Object.assign(new Error("Obscura MCP returned an unreadable response."), { code: "OBSCURA_RESPONSE_INVALID", status: 502 });
}

async function mcpPost(fetchImpl, endpoint, token, sessionId, payload) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
  };
  const response = await fetchImpl(endpoint, {
    method: "POST", headers, body: JSON.stringify(payload),
    redirect: "error", signal: AbortSignal.timeout(15_000)
  });
  const nextSession = bounded(response.headers?.get?.("mcp-session-id"), 300) || sessionId || null;
  if (response.status === 202 || payload.method === "notifications/initialized") {
    if (!response.ok && response.status !== 202) throw Object.assign(new Error("Obscura MCP rejected a protocol notification."), { code: "OBSCURA_PROTOCOL_FAILED", status: 502 });
    return { sessionId: nextSession, result: null };
  }
  const text = await readTextLimited(response);
  if (!response.ok) {
    throw Object.assign(new Error("Obscura MCP returned HTTP " + response.status + "."), {
      code: response.status === 429 ? "OBSCURA_RATE_LIMITED" : "OBSCURA_REQUEST_FAILED",
      status: response.status === 429 ? 429 : response.status >= 500 ? 502 : 400
    });
  }
  const rpc = parseRpc(text, response.headers?.get?.("content-type"));
  if (rpc?.error) {
    const message = bounded(rpc.error.message, 180) || "Obscura MCP protocol error.";
    throw Object.assign(new Error(message), { code: "OBSCURA_MCP_PROTOCOL_ERROR", status: 502 });
  }
  return { sessionId: nextSession, result: rpc?.result ?? null };
}

function contentText(result) {
  if (result?.isError) throw Object.assign(new Error("Obscura MCP tool reported an error."), { code: "OBSCURA_TOOL_FAILED", status: 502 });
  const texts = [];
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type === "text" && typeof item.text === "string") texts.push(item.text);
  }
  if (!texts.length && result?.structuredContent && typeof result.structuredContent === "object") {
    texts.push(JSON.stringify(result.structuredContent));
  }
  return bounded(texts.join("\n\n"), MAX_PAGE_TEXT);
}

function sanitizeError(error) {
  const code = bounded(error?.code, 80) || "OBSCURA_UNAVAILABLE";
  const message = "The configured Obscura MCP service is unavailable or returned an invalid response.";
  return { state: "failed", provider: "obscura", error: { code, message }, readOnly: true };
}

export function getObscuraReadiness(env = process.env) {
  const rawUrl = typeof env.OBSCURA_MCP_URL === "string" ? env.OBSCURA_MCP_URL.trim() : "";
  const hasOwner = typeof env.ULTRON_INTEGRATION_OWNER_USER_ID === "string" && Boolean(env.ULTRON_INTEGRATION_OWNER_USER_ID.trim());
  let url = null;
  const safeUrl = safeServiceBase(rawUrl);
  try { url = safeUrl ? new URL(safeUrl) : null; } catch {}
  const local = Boolean(url && loopbackHost(url.hostname));
  const valid = Boolean(url && !url.username && !url.password && !url.search && !url.hash &&
    (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
    url.pathname.replace(/\/+$/, "").endsWith("/mcp") &&
    (!url.port || url.port === "443" || local));
  const tokenReady = local || Boolean(typeof env.OBSCURA_MCP_TOKEN === "string" && env.OBSCURA_MCP_TOKEN.trim());
  return {
    state: !rawUrl ? "desktop_companion_required" : valid && hasOwner && tokenReady ? "configured_unverified" : "missing_configuration",
    configured: valid && hasOwner && tokenReady,
    endpointConfigured: valid,
    ownerGuardConfigured: hasOwner,
    remoteGatewayTokenConfigured: local ? null : Boolean(env.OBSCURA_MCP_TOKEN),
    source: "https://github.com/h4ckf0r0day/obscura",
    features: ["public-page navigation", "DOM snapshot/text extraction", "network/console diagnostics through MCP tools", "optional screenshot/PDF tools supplied by Obscura MCP"],
    limitations: ["Only read-only public HTTPS targets are allowed by this adapter.", "The remote MCP endpoint must be protected by a gateway that validates OBSCURA_MCP_TOKEN.", "No stealth flag, proxy rotation, login bypass, CAPTCHA bypass, form submission, or publishing is exposed."]
  };
}

export async function inspectPublicPageWithObscura({
  env = process.env, fetchImpl = safePinnedFetch, userId, url: rawTarget
} = {}) {
  const config = endpointConfig(env, userId);
  if (config.error) return config.error;
  const target = validatePublicTarget(rawTarget);
  if (!target) return blocked("OBSCURA_TARGET_NOT_PUBLIC_HTTPS", "Obscura may only navigate to a public HTTPS website URL. Local/private targets, raw IP addresses, and non-HTTPS URLs are blocked.");
  let sessionId = null;
  let requestId = 0;
  const call = async (method, params = {}) => {
    const payload = { jsonrpc: "2.0", id: ++requestId, method, params };
    const response = await mcpPost(fetchImpl, config.url, config.token, sessionId, payload);
    sessionId = response.sessionId;
    return response.result;
  };
  try {
    const initialized = await call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "ultron-ai", version: "0.1.0" }
    });
    if (!initialized || typeof initialized !== "object") throw Object.assign(new Error("Obscura MCP initialization returned no result."), { code: "OBSCURA_INITIALIZE_FAILED", status: 502 });
    const notification = await mcpPost(fetchImpl, config.url, config.token, sessionId, {
      jsonrpc: "2.0", method: "notifications/initialized", params: {}
    });
    sessionId = notification.sessionId;
    const navigation = await call("tools/call", { name: "browser_navigate", arguments: { url: target, waitUntil: "domcontentloaded" } });
    const navigationText = contentText(navigation);
    const snapshot = await call("tools/call", { name: "browser_snapshot", arguments: {} });
    const snapshotText = contentText(snapshot);
    if (!snapshotText) throw Object.assign(new Error("Obscura returned an empty browser snapshot."), { code: "OBSCURA_EMPTY_SNAPSHOT", status: 502 });
    return {
      state: "completed", provider: "obscura", url: target,
      readOnly: true,
      navigation: navigationText,
      snapshot: snapshotText,
      contentUntrusted: true,
      actionsNotExposed: ["click", "fill", "type", "submit", "upload", "purchase", "publish", "authentication bypass"],
      notice: "Public page text is untrusted data. This call only navigated and read a DOM snapshot; no page actions or form submissions were performed."
    };
  } catch (error) { return sanitizeError(error); }
}

function extractArtifact(result, format) {
  if (result?.isError) throw Object.assign(new Error("Obscura MCP artifact tool reported an error."), { code: "OBSCURA_TOOL_FAILED", status: 502 });
  const items = Array.isArray(result?.content) ? result.content : [];
  for (const item of items) {
    const resource = item?.resource && typeof item.resource === "object" ? item.resource : item;
    const mimeType = bounded(item?.mimeType || resource?.mimeType || (format === "pdf" ? "application/pdf" : "image/png"), 100);
    const data = typeof item?.data === "string" ? item.data : typeof resource?.blob === "string" ? resource.blob : null;
    if (data) {
      if (data.length > 850_000) throw Object.assign(new Error("Obscura artifact is too large for the bounded ULTRON response."), { code: "OBSCURA_ARTIFACT_TOO_LARGE", status: 413 });
      return { format, mimeType, encoding: "base64", base64: data, bytesApprox: Math.floor(data.length * 0.75) };
    }
    const uri = bounded(resource?.uri, 2000);
    const text = bounded(item?.text || resource?.text, 2000);
    if (uri || text) return { format, mimeType, resourceUri: uri || undefined, text: text || undefined };
  }
  throw Object.assign(new Error("Obscura did not return a supported screenshot/PDF artifact."), { code: "OBSCURA_ARTIFACT_MISSING", status: 502 });
}

export async function capturePublicPageWithObscura({
  env = process.env, fetchImpl = safePinnedFetch, userId, url: rawTarget, format = "screenshot"
} = {}) {
  const config = endpointConfig(env, userId);
  if (config.error) return config.error;
  const target = validatePublicTarget(rawTarget);
  if (!target) return blocked("OBSCURA_TARGET_NOT_PUBLIC_HTTPS", "Obscura may only capture public HTTPS website URLs. Local/private targets, raw IP addresses, and non-HTTPS URLs are blocked.");
  if (!["screenshot", "pdf"].includes(format)) return blocked("OBSCURA_FORMAT_INVALID", "format must be screenshot or pdf.");
  let sessionId = null;
  let requestId = 0;
  const call = async (method, params = {}) => {
    const response = await mcpPost(fetchImpl, config.url, config.token, sessionId, {
      jsonrpc: "2.0", id: ++requestId, method, params
    });
    sessionId = response.sessionId;
    return response.result;
  };
  try {
    const initialized = await call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "ultron-ai", version: "0.1.0" }
    });
    if (!initialized || typeof initialized !== "object") throw Object.assign(new Error("Obscura MCP initialization returned no result."), { code: "OBSCURA_INITIALIZE_FAILED", status: 502 });
    const notification = await mcpPost(fetchImpl, config.url, config.token, sessionId, {
      jsonrpc: "2.0", method: "notifications/initialized", params: {}
    });
    sessionId = notification.sessionId;
    await call("tools/call", { name: "browser_navigate", arguments: { url: target, waitUntil: "domcontentloaded" } });
    const artifactResult = await call("tools/call", { name: format === "pdf" ? "browser_pdf" : "browser_screenshot", arguments: {} });
    const artifact = extractArtifact(artifactResult, format);
    return {
      state: "completed", provider: "obscura", url: target, readOnly: true,
      artifact,
      contentUntrusted: true,
      notice: "A capture was requested from the configured Obscura MCP service. No page actions or form submissions were performed. Artifact data is bounded; large outputs require a separately configured artifact store."
    };
  } catch (error) { return sanitizeError(error); }
}
