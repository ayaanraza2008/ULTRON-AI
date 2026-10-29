import { isIP } from "node:net";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_RESULT_BYTES = 800_000;
const MAX_PATH_LENGTH = 500;
const NATIVE_CODE_OPERATIONS = new Set(["file_headers", "section_headers", "symbols", "relocations", "dwarf", "disassemble", "disassemble_all"]);
const TOOL_SPECS = Object.freeze({
  rea_analyze_application: {
    upstreamTool: "analyze_javascript_application", pathRequired: true, requiresActiveTarget: true,
    args: path => ({ input_path: path, format: "auto", integrity_policy: "fail", detail: "complete" })
  },
  rea_investigate_application_feature: {
    // Analyze and trace in one MCP session so the evidence remains valid for the follow-up.
    upstreamTool: "trace_application_feature", sourceTool: "analyze_javascript_application",
    pathRequired: true, requiresActiveTarget: true,
    args: path => ({ input_path: path, format: "auto", integrity_policy: "fail", detail: "complete" })
  },
  rea_inspect_native_code: {
    upstreamTool: "inspect_with_objdump", pathRequired: true,
    args: (path, input) => ({ path, operation: input.operation, ...(input.symbol ? { symbol: input.symbol } : {}) })
  },
  rea_inspect_artifact: {
    upstreamTool: "inspect_artifact", pathRequired: true, requiresActiveTarget: true,
    args: () => ({ detail: "complete" })
  },
  rea_inspect_binary_layout: { upstreamTool: "inspect_binary_layout", pathRequired: true, args: path => ({ path, detail: "complete" }) },
  rea_inspect_wasm_artifact: { upstreamTool: "inspect_wasm_artifact", pathRequired: true, requiresActiveTarget: true, args: path => ({ path, glue_paths: [], candidate_paths: [], detail: "complete" }) },
  rea_inspect_firmware_regions: { upstreamTool: "inspect_firmware_regions", pathRequired: true, args: path => ({ path }) },
  rea_inspect_web_network_capture: {
    upstreamTool: "inspect_web_network_capture", pathRequired: true,
    args: (path, input) => ({ capture_path: path, format: input.format, detail: "complete",
      sensitive_values: input.sensitiveValues, ...(input.recordOrdinals ? { record_ordinals: input.recordOrdinals } : {}) })
  },
  rea_inspect_desktop_application: { upstreamTool: "inspect_desktop_application", pathRequired: true, requiresActiveTarget: true, args: path => ({ path, detail: "complete" }) },
  rea_inspect_model_artifact: { upstreamTool: "inspect_model_artifact", pathRequired: true, requiresActiveTarget: true, args: path => ({ path, hash: "header", detail: "complete" }) },
  rea_inspect_managed_artifact: { upstreamTool: "inspect_managed_artifact", pathRequired: true, args: path => ({ path, detail: "complete" }) },
  rea_inspect_apk_signature: { upstreamTool: "inspect_apk_signature", pathRequired: true, requiresActiveTarget: true, args: path => ({ path }) },
  rea_inspect_android_package: { upstreamTool: "inspect_android_package", pathRequired: true, args: path => ({ path, detail: "complete" }) },
  rea_search_guidance: { upstreamTool: "search_guidance", pathRequired: false, args: (_path, input) => ({ query: bounded(input.query, 500) }) },
  rea_list_guided_workflows: { upstreamTool: "guided_workflows", pathRequired: false, args: () => ({ action: "list" }) }
});

function bounded(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function loopbackHost(host) {
  const normalized = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized === "::1" || normalized === "127.0.0.1" || normalized === "0:0:0:0:0:0:0:1";
}
function normalizeAnalysisRoot(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 1000 || /[\u0000-\u001f\u007f]/.test(raw) || raw.includes("..")) return null;
  const posix = raw.startsWith("/") && raw !== "/";
  const windows = /^[a-zA-Z]:[\\/]/.test(raw) && !/^[a-zA-Z]:[\\/]*$/.test(raw);
  if (!posix && !windows) return null;
  return raw.replace(/[\\/]+$/, "");
}
function resolveTargetPath(rootValue, relativeValue) {
  const root = normalizeAnalysisRoot(rootValue);
  const relative = bounded(relativeValue, MAX_PATH_LENGTH);
  if (!root || !relative || relative.startsWith("/") || relative.includes("\\") ||
      relative.includes(":") || /[\u0000-\u001f\u007f]/.test(relative)) return null;
  const segments = relative.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;
  const separator = /^[a-zA-Z]:[\\/]/.test(root) ? "\\" : "/";
  return root + separator + segments.join(separator);
}
function blocked(code, message) {
  return { state: "blocked", provider: "rea", error: { code, message } };
}
function safeFailure(error) {
  const code = bounded(error?.code, 80) || "REA_MCP_UNAVAILABLE";
  const message = code === "REA_RESULT_TOO_LARGE"
    ? "REA returned more evidence than ULTRON can safely pass to the model; narrow the target or use a more specific inspection."
    : code === "REA_MCP_TOOL_ERROR"
      ? "REA refused or failed the requested analysis. Check the REA host's local diagnostics and provider availability."
      : code === "REA_MCP_TIMEOUT"
        ? "REA analysis timed out. Retry with a smaller target or review REA-side resource limits."
        : "The configured REA MCP service is unavailable or returned an invalid response.";
  return { state: Number(error?.status) === 400 ? "blocked" : "failed", provider: "rea", error: { code, message }, contentUntrusted: true };
}

/** Configuration-only readiness; does not contact REA. */
export function getReaReadiness(env = process.env) {
  const enabled = env.REA_MCP_ENABLED === "true";
  const raw = bounded(env.REA_MCP_URL, 2000);
  const safe = safeServiceBase(raw);
  let url = null;
  try { url = safe ? new URL(safe) : null; } catch {}
  const local = Boolean(url && loopbackHost(url.hostname));
  const endpointConfigured = Boolean(url && !url.username && !url.password && !url.search && !url.hash &&
    (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
    url.pathname.replace(/\/+$/, "") === "/mcp" && (!url.port || url.port === "443" || local));
  const analysisRootConfigured = Boolean(normalizeAnalysisRoot(env.REA_ANALYSIS_ROOT));
  const ownerGuardConfigured = Boolean(bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100));
  const tokenConfigured = local || Boolean(bounded(env.REA_MCP_TOKEN, 3000));
  const configured = Boolean(enabled && endpointConfigured && analysisRootConfigured && ownerGuardConfigured && tokenConfigured);
  return {
    state: !enabled ? "disabled" : configured ? "configured_unverified" : "missing_configuration",
    enabled, configured, endpointConfigured, analysisRootConfigured, ownerGuardConfigured,
    remoteGatewayTokenConfigured: local ? null : Boolean(bounded(env.REA_MCP_TOKEN, 3000)),
    capabilities: Object.values(TOOL_SPECS).map(spec => spec.upstreamTool),
    note: !enabled
      ? "REA is disabled until REA_MCP_ENABLED=true is explicitly set."
      : configured
        ? "Settings are present; live MCP connectivity, REA tool availability and target-specific analysis have not been tested."
        : "Requires an enabled REA MCP server at /mcp, an absolute REA_ANALYSIS_ROOT on the REA host, the exact ULTRON owner UUID, and an authenticated HTTPS gateway for remote endpoints.",
    limitations: [
      "Targets must already exist under REA_ANALYSIS_ROOT on the REA host; ULTRON does not download targets or install analysis engines.",
      "Only the adapter's allowlisted inspection and guidance tools are callable; generic MCP tools and target execution are not exposed.",
      "REA findings and target-derived strings are untrusted evidence and need independent validation."
    ]
  };
}

function endpointConfig(env, userId) {
  if (env.REA_MCP_ENABLED !== "true") return { error: blocked("REA_DISABLED", "Enable REA explicitly with REA_MCP_ENABLED=true after reviewing the REA host and target directory.") };
  const owner = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  if (!owner || !userId || owner !== userId) {
    return { error: blocked(owner ? "INTEGRATION_OWNER_ONLY" : "INTEGRATION_OWNER_NOT_CONFIGURED", "REA analysis is restricted to the configured ULTRON owner account.") };
  }
  const normalized = safeServiceBase(bounded(env.REA_MCP_URL, 2000));
  if (!normalized) return { error: blocked("REA_ENDPOINT_INVALID", "REA_MCP_URL must be an HTTPS /mcp endpoint, or loopback HTTP when REA runs on the same host. No upstream request was made.") };
  let url;
  try { url = new URL(normalized); } catch { return { error: blocked("REA_ENDPOINT_INVALID", "REA_MCP_URL is invalid. No upstream request was made.") }; }
  const local = loopbackHost(url.hostname);
  if (url.pathname.replace(/\/+$/, "") !== "/mcp" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      (url.port && url.port !== "443" && !local) ||
      (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 && !local)) {
    return { error: blocked("REA_ENDPOINT_INVALID", "REA_MCP_URL must use /mcp over HTTPS, or loopback HTTP for a same-host setup. Remote custom ports and IP-literal hosts are blocked.") };
  }
  const token = bounded(env.REA_MCP_TOKEN, 3000);
  if (!local && !token) return { error: blocked("REA_GATEWAY_TOKEN_REQUIRED", "Remote REA MCP must be behind an HTTPS gateway that validates REA_MCP_TOKEN.") };
  const root = normalizeAnalysisRoot(env.REA_ANALYSIS_ROOT);
  if (!root) return { error: blocked("REA_ANALYSIS_ROOT_INVALID", "REA_ANALYSIS_ROOT must be an absolute, dedicated directory on the REA host; filesystem roots and parent traversal are rejected.") };
  return { url: url.toString(), token, root };
}

async function readTextLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Response too large."), { code: "REA_RESPONSE_TOO_LARGE", status: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Response body cannot be safely size-limited."), { code: "REA_RESPONSE_UNBOUNDED", status: 502 });
  const decoder = new TextDecoder();
  let raw = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Response too large."), { code: "REA_RESPONSE_TOO_LARGE", status: 502 });
      }
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } finally { try { reader.releaseLock(); } catch {} }
}
function parseRpc(raw, contentType) {
  const candidates = [];
  if (String(contentType || "").includes("text/event-stream")) {
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (data && data !== "[DONE]") candidates.push(data);
    }
  } else if (raw.trim()) candidates.push(raw.trim());
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed || "id" in parsed)) return parsed;
    } catch {}
  }
  throw Object.assign(new Error("REA MCP returned unreadable protocol data."), { code: "REA_RESPONSE_INVALID", status: 502 });
}
async function mcpPost(fetchImpl, config, sessionId, payload, protocolVersion = null) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(config.token ? { Authorization: "Bearer " + config.token } : {}),
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(protocolVersion ? { "Mcp-Protocol-Version": protocolVersion } : {})
  };
  let response;
  try {
    response = await fetchImpl(config.url, { method: "POST", headers, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw Object.assign(new Error("REA MCP request failed."), { code: timedOut ? "REA_MCP_TIMEOUT" : "REA_MCP_UNAVAILABLE", status: timedOut ? 504 : 502 });
  }
  const nextSession = bounded(response.headers?.get?.("mcp-session-id"), 300) || sessionId || null;
  if (payload.method === "notifications/initialized") {
    if (!response.ok && response.status !== 202) throw Object.assign(new Error("REA MCP rejected initialization notification."), { code: "REA_MCP_PROTOCOL_FAILED", status: 502 });
    return { sessionId: nextSession, result: null };
  }
  const raw = await readTextLimited(response);
  if (!response.ok) {
    throw Object.assign(new Error("REA MCP HTTP request failed."), { code: response.status === 429 ? "REA_MCP_RATE_LIMITED" : "REA_MCP_REQUEST_FAILED", status: response.status === 429 ? 429 : response.status >= 500 ? 502 : 400 });
  }
  const rpc = parseRpc(raw, response.headers?.get?.("content-type"));
  if (payload.id !== undefined && rpc.id !== payload.id) throw Object.assign(new Error("REA MCP response ID mismatch."), { code: "REA_RESPONSE_ID_MISMATCH", status: 502 });
  if (rpc.error) throw Object.assign(new Error("REA MCP returned an RPC error."), { code: "REA_MCP_TOOL_ERROR", status: 502 });
  return { sessionId: nextSession, result: rpc.result ?? null };
}
function extractToolOutput(result) {
  if (!result || typeof result !== "object") return result;
  if (result.isError) throw Object.assign(new Error("REA tool failed."), { code: "REA_MCP_TOOL_ERROR", status: 502 });
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const textItems = Array.isArray(result.content) ? result.content.filter(item => item?.type === "text" && typeof item.text === "string").map(item => item.text) : [];
  if (textItems.length) return textItems.join("\n\n");
  return result.content || result;
}

const endpointQueues = new Map();
async function withEndpointLock(key, work) {
  // REA's HTTP MCP listener documents single-active-session behaviour.
  const previous = endpointQueues.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => current);
  endpointQueues.set(key, tail);
  await previous.catch(() => {});
  try { return await work(); }
  finally {
    release();
    if (endpointQueues.get(key) === tail) endpointQueues.delete(key);
  }
}
async function invokeRea(config, fetchImpl, toolName, upstreamArgs, targetPath = null, requiresActiveTarget = false, postProcess = null) {
  let sessionId = null, requestId = 0, protocolVersion = null;
  const call = async (method, params = {}, notification = false) => {
    const payload = { jsonrpc: "2.0", ...(notification ? {} : { id: ++requestId }), method, ...(Object.keys(params).length ? { params } : {}) };
    const reply = await mcpPost(fetchImpl, config, sessionId, payload, protocolVersion);
    sessionId = reply.sessionId;
    if (method === "initialize" && typeof reply.result?.protocolVersion === "string") {
      protocolVersion = reply.result.protocolVersion;
    }
    return reply.result;
  };
  const initialized = await call("initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "ultron-ai-rea-bridge", version: "1.0.0" }
  });
  if (!initialized || typeof initialized !== "object") throw Object.assign(new Error("REA MCP initialization returned no result."), { code: "REA_INITIALIZE_FAILED", status: 502 });
  await call("notifications/initialized", {}, true);
  // REA checks requiresActiveTarget for several analyzers. Open the already
  // authorized local artifact first, in this same MCP session, without executing it.
  let targetOpened = false;
  if (requiresActiveTarget) {
    if (!targetPath) throw Object.assign(new Error("An active REA target path is required."), { code: "REA_ACTIVE_TARGET_PATH_REQUIRED", status: 400 });
    extractToolOutput(await call("tools/call", { name: "open_binary", arguments: { path: targetPath } }));
    targetOpened = true;
  }
  let output, operationError;
  try {
    output = extractToolOutput(await call("tools/call", { name: toolName, arguments: upstreamArgs }));
    if (postProcess) output = await postProcess({ output, call });
  } catch (error) {
    operationError = error;
  }
  if (targetOpened) {
    try {
      extractToolOutput(await call("tools/call", { name: "close_binary", arguments: {} }));
    } catch {
      throw Object.assign(new Error("REA could not close the active analysis target after inspection."), {
        code: "REA_SESSION_CLEANUP_FAILED", status: 502
      });
    }
  }
  if (operationError) throw operationError;
  return output;
}

/** Call one allowlisted REA inspection/guidance tool; arbitrary MCP tools are unavailable. */
export async function runReaTool({ env = process.env, fetchImpl = safePinnedFetch, userId, toolName, path: relativePath, query, format, recordOrdinals, sensitiveValues, operation, symbol, seed } = {}) {
  const config = endpointConfig(env, userId);
  if (config.error) return config.error;
  const spec = TOOL_SPECS[toolName];
  if (!spec) return blocked("REA_TOOL_NOT_ALLOWED", "This REA operation is not exposed by ULTRON's allowlist.");
  let targetPath = null;
  if (spec.pathRequired) {
    targetPath = resolveTargetPath(config.root, relativePath);
    if (!targetPath) return blocked("REA_PATH_OUTSIDE_ROOT", "Supply a relative target path with no absolute prefix, backslashes, or dot/parent segments; paths must stay under REA_ANALYSIS_ROOT.");
  } else if (toolName === "rea_search_guidance" && bounded(query, 500).length < 2) {
    return blocked("REA_QUERY_REQUIRED", "Provide at least two characters describing the workflow guidance to find.");
  }
  if (toolName === "rea_investigate_application_feature" && bounded(seed, 500).length < 2) {
    return blocked("REA_FEATURE_SEED_REQUIRED", "Describe the feature or behavior to trace using at least two characters.");
  }
  if (toolName === "rea_inspect_native_code") {
    if (!NATIVE_CODE_OPERATIONS.has(operation)) {
      return blocked("REA_NATIVE_OPERATION_INVALID", "Choose a supported read-only native-code operation: file_headers, section_headers, symbols, relocations, dwarf, disassemble, or disassemble_all.");
    }
    if (symbol !== undefined && (typeof symbol !== "string" || !symbol.trim() || symbol.length > 300 || /[\u0000-\u001f\u007f]/.test(symbol))) {
      return blocked("REA_NATIVE_SYMBOL_INVALID", "symbol must be a non-empty name of at most 300 characters without control characters.");
    }
    if (symbol !== undefined && operation !== "disassemble") {
      return blocked("REA_NATIVE_SYMBOL_OPERATION_MISMATCH", "A symbol selector is supported only for the disassemble operation.");
    }
  }
  if (toolName === "rea_inspect_web_network_capture") {
    if (!["har", "mitmproxy", "saz", "qlog"].includes(format)) return blocked("REA_CAPTURE_FORMAT_INVALID", "Choose a supported offline capture format: har, mitmproxy, saz, or qlog.");
    if (recordOrdinals !== undefined && (!Array.isArray(recordOrdinals) || recordOrdinals.length < 1 || recordOrdinals.length > 100 || recordOrdinals.some(n => !Number.isSafeInteger(n) || n < 0))) {
      return blocked("REA_CAPTURE_ORDINALS_INVALID", "recordOrdinals must contain 1–100 non-negative integer record indices.");
    }
    if (sensitiveValues !== undefined && (!Array.isArray(sensitiveValues) || sensitiveValues.length > 20 || sensitiveValues.some(v => typeof v !== "string" || !v.trim() || v.length > 500))) {
      return blocked("REA_SENSITIVE_VALUES_INVALID", "sensitiveValues may contain at most 20 non-empty strings, each up to 500 characters.");
    }
  }
  const upstreamArgs = spec.args(targetPath, {
    query, format, recordOrdinals, operation, symbol: typeof symbol === "string" ? symbol.trim() : undefined,
    seed: bounded(seed, 500), sensitiveValues: Array.isArray(sensitiveValues) ? sensitiveValues : []
  });
  try {
    const compoundFeatureTrace = toolName === "rea_investigate_application_feature";
    const sourceTool = compoundFeatureTrace ? spec.sourceTool : spec.upstreamTool;
    const postProcess = compoundFeatureTrace ? async ({ output: applicationEvidence, call }) => {
      if (!applicationEvidence || typeof applicationEvidence !== "object" || Array.isArray(applicationEvidence) ||
          typeof applicationEvidence.evidence_id !== "string" || !applicationEvidence.normalized_result) {
        throw Object.assign(new Error("REA analysis did not return complete application Evidence."), {
          code: "REA_APPLICATION_EVIDENCE_MISSING", status: 502
        });
      }
      const evidenceJson = JSON.stringify(applicationEvidence);
      if (Buffer.byteLength(evidenceJson, "utf8") > MAX_RESULT_BYTES) {
        throw Object.assign(new Error("Application Evidence exceeds the bounded trace input size."), {
          code: "REA_RESULT_TOO_LARGE", status: 502
        });
      }
      const featureTrace = extractToolOutput(await call("tools/call", {
        name: "trace_application_feature",
        arguments: { application: applicationEvidence, seed: { kind: "string", value: bounded(seed, 500) }, direction: "both" }
      }));
      return { applicationEvidenceId: applicationEvidence.evidence_id, featureTrace };
    } : null;
    const output = await withEndpointLock(config.url, () => invokeRea(
      { url: config.url, token: config.token }, fetchImpl, sourceTool, upstreamArgs, targetPath,
      Boolean(spec.requiresActiveTarget), postProcess
    ));
    let serialized = "";
    try { serialized = JSON.stringify(output); } catch {}
    if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
      return safeFailure(Object.assign(new Error("REA result too large."), { code: "REA_RESULT_TOO_LARGE", status: 502 }));
    }
    return {
      state: "completed", provider: "rea", operation: toolName, upstreamTool: spec.upstreamTool,
      result: output, staticAnalysisOnly: true, contentUntrusted: true,
      notice: "REA output is target-derived evidence, not proof that every inferred behavior is correct. Verify findings before implementation. ULTRON does not expose generic MCP tools, target execution, or device mutation."
    };
  } catch (error) { return safeFailure(error); }
}
