import { randomUUID } from "node:crypto";
import { safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PROMPT_CHARS = 6_000;
const MAX_RUN_ID_CHARS = 180;
const MAX_PROJECTS = 100;
const PAID_CONFIRMATION = "I explicitly approve sending this task to OpenDesign using my configured model provider and API credits.";

function bounded(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function configFor(env = process.env, userId = "") {
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  const enabled = env.OPEN_DESIGN_ENABLED === "true";
  const base = safeServiceBase(bounded(env.OPEN_DESIGN_BASE_URL, 1000));
  const apiToken = bounded(env.OPEN_DESIGN_API_TOKEN, 2000);
  const projectId = bounded(env.OPEN_DESIGN_PROJECT_ID, 120);
  const protocol = bounded(env.OPEN_DESIGN_BYOK_PROTOCOL, 30) || "openai";
  const providerBaseUrl = safeServiceBase(bounded(env.OPEN_DESIGN_BYOK_BASE_URL, 1000));
  const providerApiKey = bounded(env.OPEN_DESIGN_BYOK_API_KEY, 2000);
  const model = bounded(env.OPEN_DESIGN_BYOK_MODEL, 160);
  const projectIdValid = /^[A-Za-z0-9_-]{1,120}$/.test(projectId);
  const modelValid = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/.test(model) && model.toLowerCase() !== "default" && !model.includes("..");
  const ownerAuthorized = Boolean(ownerId && userId && ownerId === userId);
  const byokConfigured = protocol === "openai" && Boolean(providerBaseUrl && providerApiKey && modelValid);
  const configured = Boolean(enabled && ownerId && base && apiToken && projectIdValid && byokConfigured);
  return {
    ownerId, enabled, base, apiToken, projectId, protocol,
    providerBaseUrl, providerApiKey, model, ownerAuthorized, byokConfigured, configured
  };
}

export function getOpenDesignReadiness(env = process.env, userId = "") {
  const config = configFor(env, userId);
  return {
    configured: config.configured,
    ownerAuthorized: config.ownerAuthorized,
    state: !config.enabled
      ? "disabled_by_config"
      : !config.ownerId
        ? "missing_owner"
        : !config.base || !config.apiToken || !/^[A-Za-z0-9_-]{1,120}$/.test(config.projectId)
          ? "missing_open_design_configuration"
          : !config.byokConfigured
            ? "missing_byok_configuration"
            : !config.ownerAuthorized
              ? "owner_only"
              : "configured_unverified",
    requiredEnv: [
      "OPEN_DESIGN_ENABLED=true",
      "OPEN_DESIGN_BASE_URL",
      "OPEN_DESIGN_API_TOKEN",
      "OPEN_DESIGN_PROJECT_ID",
      "OPEN_DESIGN_BYOK_BASE_URL",
      "OPEN_DESIGN_BYOK_API_KEY",
      "OPEN_DESIGN_BYOK_MODEL",
      "ULTRON_INTEGRATION_OWNER_USER_ID"
    ],
    optionalEnv: ["OPEN_DESIGN_BYOK_PROTOCOL=openai"],
    executionPrerequisites: ["reachable OpenDesign daemon", "valid daemon token", "existing configured project", "OpenCode executable installed inside the OpenDesign daemon environment", "valid model-provider API key and model access"],
    model: config.model || null,
    protocol: config.protocol,
    note: !config.enabled
      ? "OpenDesign integration is disabled by default. Enable it only after installing a secured OpenDesign daemon and configuring a dedicated project and model provider."
      : !config.configured
        ? "OpenDesign needs a safe base URL, daemon bearer token, existing project ID, OpenAI-compatible model-provider URL/key/model, the owner UUID and OPEN_DESIGN_ENABLED=true."
        : !config.ownerAuthorized
          ? "OpenDesign shared credentials and project access are restricted to the configured ULTRON owner."
          : "Configuration is present but OpenDesign daemon reachability, project authorization, OpenCode runtime, provider auth and actual output are not live-verified. Task submission can consume model-provider credits and requires explicit per-request approval."
  };
}

function requireOwner(config) {
  if (!config.ownerId) throw fail("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID before using OpenDesign.", 503);
  if (!config.ownerAuthorized) throw fail("INTEGRATION_OWNER_ONLY", "OpenDesign is restricted to the configured ULTRON owner account.", 403);
  if (!config.configured) throw fail("OPEN_DESIGN_NOT_CONFIGURED", "OpenDesign is disabled or missing its daemon, project or model-provider configuration.", 503);
}

async function readLimitedText(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw fail("OPEN_DESIGN_RESPONSE_TOO_LARGE", "OpenDesign response exceeded ULTRON's size limit.", 502);
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw fail("OPEN_DESIGN_RESPONSE_UNSAFE", "OpenDesign response could not be size-limited safely.", 502);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw fail("OPEN_DESIGN_RESPONSE_TOO_LARGE", "OpenDesign response exceeded ULTRON's size limit.", 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function requestJson(config, path, { method = "GET", body, fetchImpl = safePinnedFetch } = {}) {
  const response = await fetchImpl(config.base + path, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + config.apiToken,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await readLimitedText(response);
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { throw fail("OPEN_DESIGN_INVALID_RESPONSE", "OpenDesign returned invalid JSON.", 502); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw fail("OPEN_DESIGN_AUTH_FAILED", "OpenDesign rejected the daemon token or project access.", 502);
    if (response.status === 429) throw fail("OPEN_DESIGN_RATE_LIMITED", "OpenDesign or its configured provider rate-limited the request.", 429);
    throw fail("OPEN_DESIGN_REQUEST_FAILED", "OpenDesign could not complete the request (HTTP " + response.status + ").", response.status >= 500 ? 502 : 400);
  }
  return payload;
}

function safeProjectList(payload) {
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  return projects.slice(0, MAX_PROJECTS).flatMap(project => {
    if (!project || typeof project !== "object") return [];
    const id = bounded(project.id, 120);
    const name = bounded(project.name, 200);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || !name) return [];
    return [{ id, name, ...(typeof project.metadata?.kind === "string" ? { kind: bounded(project.metadata.kind, 60) } : {}) }];
  });
}

function safeRunStatus(payload, runId, configuredProjectId) {
  const rawStatus = bounded(payload?.status, 40).toLowerCase();
  const status = ["queued", "running", "succeeded", "failed", "canceled", "cancelled"].includes(rawStatus) ? (rawStatus === "cancelled" ? "canceled" : rawStatus) : "unknown";
  const deliverableEntryFile = bounded(payload?.deliverableEntryFile, 300);
  const validEntry = deliverableEntryFile && !deliverableEntryFile.startsWith("/") && !deliverableEntryFile.includes("\\") && !deliverableEntryFile.split("/").some(part => part === ".." || part === "." || part === "");
  return {
    provider: "open-design",
    runId,
    projectId: configuredProjectId,
    status,
    ...(typeof payload?.errorCode === "string" ? { errorCode: bounded(payload.errorCode, 100) } : {}),
    ...(typeof payload?.deliverableValid === "boolean" ? { deliverableValid: payload.deliverableValid } : {}),
    ...(validEntry ? { deliverableEntryFile } : {}),
    ...(status === "failed" ? { error: "OpenDesign reported that the run failed. Inspect the OpenDesign run log for safe diagnostic detail." } : {}),
    verified: status === "succeeded" && payload?.deliverableValid === true && Boolean(validEntry)
  };
}

function validateRunId(value) {
  const id = bounded(value, MAX_RUN_ID_CHARS);
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(id) || id.includes("..")) throw fail("OPEN_DESIGN_RUN_ID_INVALID", "OpenDesign run ID is invalid.");
  return id;
}

export async function runOpenDesignAction({
  env = process.env,
  fetchImpl = safePinnedFetch,
  userId = "",
  action = "readiness",
  prompt = "",
  requestId = "",
  approveRun = false,
  confirmationText = "",
  userPrompt = ""
} = {}) {
  if (action === "catalog") {
    return {
      provider: "open-design",
      capabilities: ["list configured daemon projects", "submit a headless BYOK design/coding task", "poll a run's terminal status", "report validated entry-file and deliverable status"],
      apiRoutes: ["GET /api/projects", "POST /api/runs", "GET /api/runs/:id"],
      execution: "static_adapter_catalog_only"
    };
  }
  const config = configFor(env, userId);
  if (action === "readiness") return getOpenDesignReadiness(env, userId);
  requireOwner(config);

  if (action === "projects") {
    const payload = await requestJson(config, "/api/projects", { fetchImpl });
    return {
      state: "completed",
      provider: "open-design",
      projects: safeProjectList(payload),
      truncated: Array.isArray(payload?.projects) && payload.projects.length > MAX_PROJECTS,
      configuredProjectId: config.projectId
    };
  }

  if (action === "submit") {
    const cleanPrompt = bounded(prompt, MAX_PROMPT_CHARS);
    if (cleanPrompt.length < 2) throw fail("OPEN_DESIGN_PROMPT_REQUIRED", "A task prompt is required.");
    if (
      approveRun !== true ||
      bounded(confirmationText, 300) !== PAID_CONFIRMATION ||
      !/\b(approve|authorize|confirm|run|execute|send)\b[\s\S]{0,120}\b(task|prompt|provider|credits?|model|open[ -]?design)\b/i.test(userPrompt)
    ) {
      return {
        state: "approval_required",
        provider: "open-design",
        execution: "not_started",
        projectId: config.projectId,
        model: config.model,
        confirmationText: PAID_CONFIRMATION,
        message: "No OpenDesign run was started. The configured provider may consume credits and the task can modify files in the selected OpenDesign project; explicitly approve submission before retrying."
      };
    }
    const clientRequestId = randomUUID();
    const payload = await requestJson(config, "/api/runs", {
      method: "POST",
      fetchImpl,
      body: {
        projectId: config.projectId,
        clientRequestId,
        message: cleanPrompt,
        agentId: "byok-opencode",
        model: config.model,
        byokProvider: {
          protocol: "openai",
          apiKey: config.providerApiKey,
          baseUrl: config.providerBaseUrl,
          model: config.model
        }
      }
    });
    const runId = validateRunId(payload?.runId);
    return {
      state: "queued",
      provider: "open-design",
      runId,
      projectId: config.projectId,
      conversationId: bounded(payload?.conversationId, 180) || undefined,
      assistantMessageId: bounded(payload?.assistantMessageId, 180) || undefined,
      clientRequestId,
      statusAction: "Call open_design with action=status and this runId.",
      notice: "HTTP 202 acknowledges creation only. OpenCode runtime, provider completion, valid files and final deliverable still require run-status verification."
    };
  }

  if (action === "status") {
    const runId = validateRunId(requestId);
    const payload = await requestJson(config, "/api/runs/" + encodeURIComponent(runId), { fetchImpl });
    return { state: "status_available", ...safeRunStatus(payload, runId, config.projectId) };
  }

  throw fail("OPEN_DESIGN_ACTION_INVALID", "Supported actions are catalog, readiness, projects, submit and status.");
}

export const OPEN_DESIGN_PAID_CONFIRMATION = PAID_CONFIRMATION;
