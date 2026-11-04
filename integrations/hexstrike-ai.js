import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "../security/target-authorization-gateway.js";
import { ultronGuardian } from "../security/ultron-guardian.js";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_OUTPUT_CHARS = 40_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Intentionally narrow: local static-analysis tools only. No exploit, brute-force,
// password, shell, arbitrary-command, generic-tool, or active remote-scan endpoint.
export const HEXSTRIKE_SAFE_SCANS = Object.freeze({
  "trivy-fs": Object.freeze({
    endpoint: "/api/tools/trivy",
    buildPayload: target => ({
      scan_type: "fs",
      target,
      output_format: "json",
      severity: "HIGH,CRITICAL",
      output_file: "",
      additional_args: ""
    })
  }),
  "trivy-config": Object.freeze({
    endpoint: "/api/tools/trivy",
    buildPayload: target => ({
      scan_type: "config",
      target,
      output_format: "json",
      severity: "HIGH,CRITICAL",
      output_file: "",
      additional_args: ""
    })
  }),
  checkov: Object.freeze({
    endpoint: "/api/tools/checkov",
    buildPayload: target => ({
      directory: target,
      framework: "",
      check: "",
      skip_check: "",
      output_format: "json",
      additional_args: ""
    })
  })
});

function clean(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || "").toLowerCase().replace(/^\[|\]$/g, ""));
}

function resolveBase(env) {
  const base = safeServiceBase(env.HEXSTRIKE_BASE_URL);
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash) return null;
    const localHttp = url.protocol === "http:" && isLoopbackHost(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function getHexStrikeReadiness(env = process.env) {
  const enabled = env.HEXSTRIKE_ENABLED === "true";
  const base = resolveBase(env);
  const ownerConfigured = Boolean(clean(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100));
  const token = clean(env.HEXSTRIKE_API_TOKEN, 500);
  let remoteGatewayReady = false;
  if (base) {
    try {
      const url = new URL(base);
      const local = isLoopbackHost(url.hostname);
      remoteGatewayReady = local || (
        url.protocol === "https:" &&
        env.HEXSTRIKE_REMOTE_GATEWAY_CONFIRMED === "true" &&
        token.length >= 32
      );
    } catch {}
  }
  const scanRoot = clean(env.HEXSTRIKE_SCAN_ROOT, 1000);
  const scanRootConfigured = Boolean(scanRoot && path.isAbsolute(scanRoot));
  const configured = enabled && Boolean(base) && ownerConfigured && remoteGatewayReady;
  const scanReady = configured && scanRootConfigured;
  let note;
  if (!enabled) note = "Disabled by default. Set HEXSTRIKE_ENABLED=true after installing and reviewing a separate HexStrike service.";
  else if (!base) note = "Requires HEXSTRIKE_BASE_URL using loopback HTTP or a secured HTTPS endpoint.";
  else if (!ownerConfigured) note = "Requires ULTRON_INTEGRATION_OWNER_USER_ID for owner-only access.";
  else if (!remoteGatewayReady) note = "Remote HexStrike requires an HTTPS authentication gateway, HEXSTRIKE_REMOTE_GATEWAY_CONFIRMED=true, and a 32+ character server-side token.";
  else if (!scanRootConfigured) note = "Status checks are configured; scans remain disabled until HEXSTRIKE_SCAN_ROOT is an absolute shared workspace directory.";
  else note = "Configured but not live-verified. Only local Trivy filesystem/config and Checkov IaC scans are exposed.";
  return {
    enabled,
    configured,
    scanReady,
    state: !enabled ? "disabled" : configured ? "configured_unverified" : "missing_configuration",
    note
  };
}

export async function resolveHexStrikeScanTarget(target, scanRoot) {
  const requested = clean(target, 240);
  if (!requested || requested.includes("\0") || requested.startsWith("~") ||
      path.isAbsolute(requested) || path.win32.isAbsolute(requested) ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(requested)) {
    throw Object.assign(new Error("Scan target must be a relative path beneath HEXSTRIKE_SCAN_ROOT."), { code: "INVALID_SCAN_TARGET" });
  }
  const segments = requested.replace(/\\/g, "/").split("/");
  if (!/^[A-Za-z0-9._/-]+$/.test(requested.replace(/\\/g, "/")) ||
      segments.some(segment => segment === ".." || segment === "")) {
    throw Object.assign(new Error("Scan target path traversal is not allowed."), { code: "INVALID_SCAN_TARGET" });
  }
  if (!scanRoot || !path.isAbsolute(scanRoot)) {
    throw Object.assign(new Error("HEXSTRIKE_SCAN_ROOT must be an absolute directory."), { code: "SCAN_ROOT_NOT_CONFIGURED" });
  }

  const root = await fs.realpath(scanRoot);
  if (!/^[A-Za-z0-9._:/\\-]+$/.test(root)) {
    throw Object.assign(new Error("HEXSTRIKE_SCAN_ROOT contains shell-unsafe path characters."), { code: "SCAN_ROOT_UNSAFE" });
  }
  const resolved = await fs.realpath(path.resolve(root, requested));
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Scan target resolves outside HEXSTRIKE_SCAN_ROOT."), { code: "INVALID_SCAN_TARGET" });
  }
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw Object.assign(new Error("Scan target must resolve to an existing directory."), { code: "INVALID_SCAN_TARGET" });
  }
  return resolved;
}

async function readJsonLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("HexStrike response exceeded the configured size limit."), { code: "RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("HexStrike response has no bounded streaming body."), { code: "UNSAFE_RESPONSE" });
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("HexStrike response exceeded the configured size limit."), { code: "RESPONSE_TOO_LARGE" });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("HexStrike returned a non-JSON response."), { code: "INVALID_RESPONSE" }); }
}

async function requestJson(fetchImpl, url, { method = "GET", token = "", body, timeoutMs = 10000 } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await readJsonLimited(response);
  if (!response.ok) {
    throw Object.assign(new Error("HexStrike request failed."), {
      code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REQUEST_FAILED",
      status: response.status
    });
  }
  return data;
}

function redactOutput(value) {
  return clean(value, MAX_OUTPUT_CHARS)
    .replace(/(authorization|api[_-]?key|access[_-]?token|password|secret)\s*([:=])\s*[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
}

export function createHexStrikeRouter({
  env = process.env,
  fetchImpl = safePinnedFetch,
  requireSupabaseUser,
  authGateway = targetAuthorizationGateway,
  guardian = ultronGuardian
} = {}) {
  const router = express.Router();

  function requireOwner(req, res, next) {
    const ownerId = clean(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
    if (!ownerId) return res.status(503).json({ error: { code: "INTEGRATION_OWNER_NOT_CONFIGURED", message: "Configure the ULTRON integration owner before enabling HexStrike." } });
    const userId = clean(req.supabaseUser?.id, 100);
    if (!userId) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to use HexStrike." } });
    if (userId !== ownerId) return res.status(403).json({ error: { code: "INTEGRATION_OWNER_ONLY", message: "HexStrike is restricted to the configured ULTRON owner." } });
    return next();
  }

  function configured(res, { scans = false } = {}) {
    const readiness = getHexStrikeReadiness(env);
    if (!readiness.configured || (scans && !readiness.scanReady)) {
      res.status(503).json({
        error: {
          code: scans ? "HEXSTRIKE_SCAN_NOT_CONFIGURED" : "HEXSTRIKE_NOT_CONFIGURED",
          message: readiness.note
        }
      });
      return null;
    }
    return { base: resolveBase(env), token: clean(env.HEXSTRIKE_API_TOKEN, 500), readiness };
  }

  const auth = typeof requireSupabaseUser === "function"
    ? requireSupabaseUser
    : (_req, res) => res.status(503).json({ error: { code: "AUTH_MIDDLEWARE_REQUIRED", message: "Supabase authentication middleware is required." } });

  router.get("/integrations/hexstrike/status", auth, requireOwner, async (_req, res) => {
    const settings = configured(res);
    if (!settings) return;
    try {
      const health = await requestJson(fetchImpl, settings.base + "/health", { token: settings.token, timeoutMs: 10000 });
      res.setHeader("Cache-Control", "no-store");
      res.json({
        provider: "hexstrike-ai",
        reachable: true,
        configured: true,
        verification: "live_health_only",
        health: {
          status: clean(health?.status, 40) || "unknown",
          version: clean(health?.version, 40) || undefined
        },
        allowedScans: Object.keys(HEXSTRIKE_SAFE_SCANS)
      });
    } catch (error) {
      const status = error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 502;
      res.status(status).json({ error: { code: "HEXSTRIKE_UNREACHABLE", message: "HexStrike health check failed; connectivity is not verified." } });
    }
  });

  router.post("/integrations/hexstrike/scan", auth, requireOwner, async (req, res) => {
    const settings = configured(res, { scans: true });
    if (!settings) return;
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).some(key => !["tool", "target"].includes(key))) {
      return res.status(400).json({ error: { code: "INVALID_HEXSTRIKE_REQUEST", message: "Only tool and target are accepted." } });
    }
    const tool = clean(body.tool, 40);
    const scan = HEXSTRIKE_SAFE_SCANS[tool];
    if (!scan) return res.status(400).json({ error: { code: "HEXSTRIKE_TOOL_NOT_ALLOWED", message: "Only the approved local static-analysis tools are available." } });

    let target;
    let authRecord;
    try {
      target = await resolveHexStrikeScanTarget(body.target, env.HEXSTRIKE_SCAN_ROOT);
      authRecord = authGateway.assertAuthorization(target, PERMITTED_ACTIVITIES.VULNERABILITY_SCAN);
    } catch (error) {
      const code = error?.code || "TARGET_AUTHORIZATION_DENIED";
      const status = code === "RATE_LIMIT_EXCEEDED" ? 429 : code === "SCAN_ROOT_NOT_CONFIGURED" ? 503 : 403;
      return res.status(status).json({ error: { code, message: status === 403 ? "The scan target is outside the active authorized scope or failed path validation." : "HexStrike scan prerequisites are not satisfied." } });
    }

    try {
      const result = await requestJson(fetchImpl, settings.base + scan.endpoint, {
        method: "POST",
        token: settings.token,
        body: scan.buildPayload(target),
        timeoutMs: 120000
      });
      const success = result?.success === true;
      guardian?.recordAudit?.("HEXSTRIKE_DEFENSIVE_SCAN_COMPLETED", clean(req.supabaseUser?.id, 100) || "unknown", {
        tool,
        target: path.relative(env.HEXSTRIKE_SCAN_ROOT, target) || ".",
        scopeId: authRecord?.scopeId || null,
        success
      });
      res.status(success ? 200 : 502).json({
        provider: "hexstrike-ai",
        tool,
        status: success ? "completed" : "failed",
        success,
        target: path.relative(env.HEXSTRIKE_SCAN_ROOT, target) || ".",
        returnCode: Number.isInteger(result?.return_code) ? result.return_code : undefined,
        executionTimeSeconds: Number.isFinite(Number(result?.execution_time)) ? Number(result.execution_time) : undefined,
        stdout: redactOutput(result?.stdout),
        stderr: redactOutput(result?.stderr),
        note: "A completed scan is not proof that the target is secure; review the findings."
      });
    } catch (error) {
      guardian?.recordAudit?.("HEXSTRIKE_DEFENSIVE_SCAN_FAILED", clean(req.supabaseUser?.id, 100) || "unknown", {
        tool,
        target: path.relative(env.HEXSTRIKE_SCAN_ROOT, target) || ".",
        scopeId: authRecord?.scopeId || null,
        code: clean(error?.code, 80) || "UPSTREAM_FAILURE"
      });
      const status = error?.name === "TimeoutError" || error?.name === "AbortError" ? 504
        : error?.code === "UPSTREAM_RATE_LIMITED" ? 429 : 502;
      res.status(status).json({ error: { code: "HEXSTRIKE_SCAN_FAILED", message: "The defensive scan did not complete successfully." } });
    }
  });

  return router;
}
