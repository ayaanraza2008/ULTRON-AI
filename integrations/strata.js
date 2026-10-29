import { safeServiceBase } from "../network-safety.js";

function bounded(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isLoopback(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function getStrataReadiness(env = process.env) {
  const rawBase = bounded(env.STRATA_BASE_URL, 1000);
  const model = bounded(env.STRATA_MODEL, 160);
  const apiKey = bounded(env.STRATA_API_KEY, 2000);
  if (!rawBase && !model && !apiKey) {
    return {
      configured: false,
      state: "optional",
      baseUrl: null,
      model: null,
      supportsTools: false,
      note: "Optional local/remote Strata provider. ULTRON does not install Strata or download model weights."
    };
  }

  const baseUrl = safeServiceBase(rawBase);
  if (!baseUrl || !model) {
    return {
      configured: false,
      state: "blocked",
      baseUrl: null,
      model: null,
      supportsTools: false,
      note: "Set a valid STRATA_BASE_URL and STRATA_MODEL; local HTTP is permitted only for loopback endpoints."
    };
  }

  let parsed;
  try { parsed = new URL(baseUrl); } catch {
    return { configured: false, state: "blocked", baseUrl: null, model: null, supportsTools: false, note: "The configured Strata URL is invalid." };
  }
  const local = parsed.protocol === "http:" && isLoopback(parsed.hostname);
  if (!local && (parsed.protocol !== "https:" || !apiKey)) {
    return {
      configured: false,
      state: "blocked",
      baseUrl: null,
      model: null,
      supportsTools: false,
      note: "Remote Strata endpoints require HTTPS and a server-side STRATA_API_KEY. Never place the key in browser code."
    };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { configured: false, state: "blocked", baseUrl: null, model: null, supportsTools: false, note: "The Strata URL must not include credentials, query parameters, or a fragment." };
  }

  return {
    configured: true,
    state: "configured_unverified",
    baseUrl,
    model,
    supportsTools: env.STRATA_SUPPORTS_TOOLS === "true",
    note: "Strata endpoint and model are configured; connectivity, model availability, quality, tool-call compatibility and latency have not been tested by this readiness check."
  };
}

export function resolveStrataProvider(env = process.env) {
  const readiness = getStrataReadiness(env);
  if (!readiness.configured) return null;
  const parsed = new URL(readiness.baseUrl);
  const local = parsed.protocol === "http:" && isLoopback(parsed.hostname);
  return {
    name: "strata",
    baseUrl: readiness.baseUrl,
    apiKey: bounded(env.STRATA_API_KEY, 2000),
    model: readiness.model,
    priority: -10,
    supportsTools: readiness.supportsTools,
    supportsVision: env.STRATA_SUPPORTS_VISION === "true",
    local
  };
}
