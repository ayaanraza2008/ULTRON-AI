import { safeServiceBase } from "./network-safety.js";

const truthy = (value) => typeof value === "string" && value.trim().length > 0;

function secureServiceUrl(value) {
  return safeServiceBase(value) !== null;
}

function component(id, label, state, requiredEnv, note) {
  return { id, label, state, requiredEnv, note };
}

/**
 * Returns a secret-free snapshot. Configuration checks are deliberately not
 * presented as proof that an upstream service, model, or local device works.
 */
export function buildRuntimeReadiness({
  env = process.env,
  workerStatus = null,
  modelProviderConfigured = false,
  supabaseConfigured = false,
  now = new Date()
} = {}) {
  const browserConfigured = secureServiceUrl(env.ULTRON_BROWSER_USE_URL) && truthy(env.ULTRON_BROWSER_USE_TOKEN);
  const desktopConfigured = secureServiceUrl(env.ULTRON_DESKTOP_AGENT_URL) && truthy(env.ULTRON_DESKTOP_AGENT_TOKEN) && truthy(env.ULTRON_INTEGRATION_OWNER_USER_ID);
  const desktopBridgeToken = String(env.ULTRON_DESKTOP_BRIDGE_TOKEN || "").trim();
  const desktopActionQueueConfigured = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim()) &&
    desktopBridgeToken.length >= 32 && !/\s/.test(desktopBridgeToken);
  const localModelConfigured = secureServiceUrl(env.OLLAMA_BASE_URL);
  const memoryConfigured = supabaseConfigured || (secureServiceUrl(env.AGENTMEMORY_URL) && truthy(env.AGENTMEMORY_SECRET));
  const tavilyConfigured = truthy(env.TAVILY_API_KEY);
  const premiumTtsConfigured = secureServiceUrl(env.TTS_API_BASE_URL) && truthy(env.TTS_API_KEY);
  const premiumSttConfigured = secureServiceUrl(env.STT_API_BASE_URL) && truthy(env.STT_API_KEY);
  const authCallbackConfigured = (() => {
    if (!secureServiceUrl(env.ULTRON_AUTH_CALLBACK_URL)) return false;
    try { return new URL(env.ULTRON_AUTH_CALLBACK_URL.trim()).pathname === "/api/auth/google/callback"; }
    catch { return false; }
  })();
  const googleAuthConfigured = supabaseConfigured && authCallbackConfigured;
  const phoneOtpConfigured = supabaseConfigured;
  const workerEnabled = env.ULTRON_EMPLOYEES_ENABLED === "true";
  const workerState = workerStatus?.state || (workerEnabled ? "not_started" : "disabled");

  const components = [
    component("cloud_model", "Cloud model inference", modelProviderConfigured ? "configured_unverified" : "blocked",
      ["OPENROUTER_API_KEY or ULTRON_MODEL_PROVIDERS_JSON"], modelProviderConfigured
        ? "A provider key is configured; live inference, quota, and model availability are not tested by this endpoint."
        : "Configure a supported server-side model provider before expecting AI-generated responses."),
    component("database_auth", "Supabase persistence and authentication", supabaseConfigured ? "configured_unverified" : "blocked",
      ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], supabaseConfigured
        ? "Database URL and publishable key are configured; account login, row-level security, and writes still need end-to-end verification."
        : "Configure Supabase Auth and database settings."),
    component("google_auth", "Google sign-in", googleAuthConfigured ? "configured_unverified" : "blocked",
      ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "ULTRON_AUTH_CALLBACK_URL"], googleAuthConfigured
        ? "OAuth callback is configured; the Google provider, Supabase redirect allow-list, and live token exchange still need verification."
        : "Configure a valid HTTPS callback ending in /api/auth/google/callback and enable Google in Supabase Auth."),
    component("phone_otp", "Phone number sign-in", phoneOtpConfigured ? "configured_unverified" : "blocked",
      ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], phoneOtpConfigured
        ? "Supabase Auth is configured; phone sign-in, SMS provider credentials, delivery, and rate limits still require live verification."
        : "Configure Supabase Auth, enable phone sign-in, and configure an SMS provider before sending OTPs."),
    component("background_tasks", "Background task worker", workerState,
      ["ULTRON_EMPLOYEES_ENABLED=true", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], workerState === "running"
        ? "Worker process reports running; successful task execution is tracked separately."
        : workerState === "disabled" ? "Worker is disabled by configuration." : "Worker is not currently reporting a running state."),
    component("memory", "Account-scoped memory", memoryConfigured ? "configured_unverified" : "blocked",
      ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY (or AGENTMEMORY_URL and AGENTMEMORY_SECRET)"], memoryConfigured
        ? "Memory storage configuration exists; user consent/preferences, retrieval quality, and cross-account isolation still require live verification."
        : "Configure authenticated Supabase persistence or the separate authenticated AgentMemory service."),
    component("research", "Web research", tavilyConfigured ? "configured_unverified" : "best_effort_fallback",
      ["TAVILY_API_KEY (recommended)"], tavilyConfigured
        ? "Tavily is configured; provider reachability is not tested here."
        : "Public HTML search fallback may be rate-limited or change without notice; research quality is not guaranteed."),
    component("browser_automation", "Browser automation", browserConfigured ? "configured_unverified" : "blocked",
      ["ULTRON_BROWSER_USE_URL", "ULTRON_BROWSER_USE_TOKEN"], browserConfigured
        ? "Bridge settings are present; browser readiness and real browser actions are not tested here."
        : "A separately hosted, authenticated Browser Use bridge is required."),
    component("windows_companion", "Windows PC companion", desktopConfigured ? "configured_unverified" : "blocked",
      ["ULTRON_DESKTOP_AGENT_URL", "ULTRON_DESKTOP_AGENT_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"], desktopConfigured
        ? "Bridge settings and the owner guard are present; live pairing is unverified. The current adapter only probes status and does not execute PC commands."
        : "A reachable, authenticated Windows companion is required. A cloud server cannot directly control the user's PC."),
    component("windows_action_queue", "Windows approved-action queue", desktopActionQueueConfigured ? "configured_unverified" : "blocked",
      ["ULTRON_INTEGRATION_OWNER_USER_ID", "ULTRON_DESKTOP_BRIDGE_TOKEN"], desktopActionQueueConfigured
        ? "Owner UUID and a high-entropy bridge token are configured; this is not proof that the SQL migration is applied, a Windows companion is paired, or any action has run."
        : "Requires the configured owner UUID and a dedicated 32+ character bridge token. Actions remain unavailable until the additive migration is applied and a companion is paired; configuration alone is not verification."),
    component("local_models", "Local model runtime", localModelConfigured ? "configured_unverified" : "optional",
      ["OLLAMA_BASE_URL"], localModelConfigured
        ? "Endpoint is configured; model availability and network reachability are not tested."
        : "Optional. A cloud-hosted service cannot reach a PC-local localhost endpoint."),
    component("premium_speech", "Premium speech adapters", premiumTtsConfigured && premiumSttConfigured ? "configured_unverified" : "optional",
      ["TTS_API_BASE_URL", "TTS_API_KEY", "STT_API_BASE_URL", "STT_API_KEY"], "Browser-native speech can remain the fallback; configured provider URLs do not prove speech quality or reachability."),
    component("safe_code_execution", "Isolated code execution", "not_available",
      [], "ULTRON does not claim to run arbitrary user code in an isolated sandbox; coding assistance is limited to supported plan, draft, and review workflows.")
  ];

  // A deliberately unsupported optional capability is disclosed in the component list,
  // but must not make otherwise configured core services permanently unready.
  const blockers = components.filter((item) => ["blocked", "disabled", "not_started"].includes(item.state));
  const configuredCount = components.filter((item) => ["configured_unverified", "running", "best_effort_fallback"].includes(item.state)).length;
  return {
    app: "ULTRON AI",
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    verification: "configuration_and_process_snapshot_only",
    overallState: blockers.length === 0 ? "ready_for_live_verification" : configuredCount > 0 ? "partially_ready" : "blocked",
    summary: {
      componentCount: components.length,
      configuredOrAvailableCount: configuredCount,
      blockerCount: blockers.length
    },
    worker: workerStatus ? {
      state: workerStatus.state || "unknown",
      startedAt: workerStatus.startedAt || null,
      lastCycleAt: workerStatus.lastCycleAt || null,
      lastCycleSuccessAt: workerStatus.lastCycleSuccessAt || null,
      lastErrorCode: workerStatus.lastErrorCode || null,
      tasksCompleted: Number(workerStatus.tasksCompleted) || 0,
      tasksRetried: Number(workerStatus.tasksRetried) || 0,
      tasksFailed: Number(workerStatus.tasksFailed) || 0,
      tasksBlocked: Number(workerStatus.tasksBlocked) || 0,
      tasksDiscarded: Number(workerStatus.tasksDiscarded) || 0,
      taskStateUpdateFailures: Number(workerStatus.taskStateUpdateFailures) || 0,
      taskLeaseRenewalFailures: Number(workerStatus.taskLeaseRenewalFailures) || 0
    } : { state: workerEnabled ? "not_started" : "disabled" },
    components,
    notes: [
      "This endpoint never returns secret values.",
      "configured_unverified means configuration exists, not that an upstream call succeeded.",
      "This endpoint does not perform network probes, execute code, or control a device."
    ]
  };
}
