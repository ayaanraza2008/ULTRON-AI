import { getObscuraReadiness } from "./obscura-mcp.js";
import { getReaReadiness } from "./rea-mcp.js";
import { getCactusReadiness } from "./cactus.js";
import { getPaperclipReadiness } from "./paperclip-services.js";
import { getHermesAgentReadiness } from "./hermes-agent.js";
import { safeServiceBase } from "../network-safety.js";
import { isGoogleWorkspaceConfigured } from "./google-workspace.js";
import { getStrataReadiness } from "./strata.js";
import { getOpenSeoReadiness } from "./openseo-mcp.js";
import { getOpenDesignReadiness } from "./open-design.js";
import { getOpenHiggsfieldReadiness } from "./open-higgsfield.js";
import { getOpenGenerativeAIReadiness } from "./open-generative-ai.js";
import { getAppFlowyReadiness } from "./appflowy.js";

const safeBaseUrl = (value) => safeServiceBase(value) !== null;

/**
 * Returns configuration readiness only. It does not claim that an external
 * service is reachable or that model weights are installed.
 */
export function buildIntegrationCatalog(env = process.env) {
  const hermesReadiness = getHermesAgentReadiness(env);
  const hasComfy = safeBaseUrl(env.COMFYUI_BASE_URL);
  const hasHeyGem = safeBaseUrl(env.HEYGEM_API_BASE_URL) && Boolean(env.HEYGEM_API_KEY) && typeof env.HEYGEM_JOB_PATH === "string" && env.HEYGEM_JOB_PATH.startsWith("/");
  const hasOmniVoice = safeBaseUrl(env.OMNIVOICE_API_BASE_URL) && Boolean(env.OMNIVOICE_API_KEY) && typeof env.OMNIVOICE_SYNTHESIS_PATH === "string" && env.OMNIVOICE_SYNTHESIS_PATH.startsWith("/");
  const hasHandyBridge = safeBaseUrl(env.ULTRON_HANDY_BRIDGE_URL) && Boolean(env.ULTRON_HANDY_BRIDGE_TOKEN) && typeof env.ULTRON_HANDY_TRANSCRIBE_PATH === "string" && env.ULTRON_HANDY_TRANSCRIBE_PATH.startsWith("/");
  const hasVoiceStudio = safeBaseUrl(env.VOICESTUDIO_BASE_URL) && (Boolean(env.VOICESTUDIO_API_KEY) || ["localhost", "127.0.0.1", "::1"].includes(new URL(env.VOICESTUDIO_BASE_URL).hostname));
  const employeesEnabled = env.ULTRON_EMPLOYEES_ENABLED === "true";
  const hasGeoSleuth = env.GEO_SLEUTH_ENABLED === "true";
  const hasIntegrationOwner = Boolean(typeof env.ULTRON_INTEGRATION_OWNER_USER_ID === "string" && env.ULTRON_INTEGRATION_OWNER_USER_ID.trim());
  const hasDesktopCompanion = hasIntegrationOwner && safeBaseUrl(env.ULTRON_DESKTOP_AGENT_URL) && Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN);
  const hasChatwoot = hasIntegrationOwner && safeBaseUrl(env.CHATWOOT_BASE_URL) && Boolean(env.CHATWOOT_API_TOKEN) && /^\d+$/.test(String(env.CHATWOOT_ACCOUNT_ID || ""));
  const hasOpenProject = hasIntegrationOwner && safeBaseUrl(env.OPENPROJECT_BASE_URL) && Boolean(env.OPENPROJECT_API_TOKEN);
  const hasCalDiy = hasIntegrationOwner && safeBaseUrl(env.CALDIY_BASE_URL) && Boolean(env.CALDIY_API_TOKEN);
  const hasGoogleWorkspace = isGoogleWorkspaceConfigured(env);
  const paperclipReadiness = getPaperclipReadiness(env);
  const obscuraReadiness = getObscuraReadiness(env);
  const hasChromeDevTools = hasIntegrationOwner && safeBaseUrl(env.ULTRON_CHROME_DEVTOOLS_URL) && typeof env.ULTRON_CHROME_DEVTOOLS_TOKEN === "string" && env.ULTRON_CHROME_DEVTOOLS_TOKEN.trim().length >= 32;
  const reaReadiness = getReaReadiness(env);
  const cactusReadiness = getCactusReadiness(env);
  const strataReadiness = getStrataReadiness(env);
  const openSeoReadiness = getOpenSeoReadiness(env);
  const openDesignReadiness = getOpenDesignReadiness(env, env.ULTRON_INTEGRATION_OWNER_USER_ID);
  const openHiggsfieldReadiness = getOpenHiggsfieldReadiness(env, env.ULTRON_INTEGRATION_OWNER_USER_ID);
  const openGenerativeAIReadiness = getOpenGenerativeAIReadiness(env, env.ULTRON_INTEGRATION_OWNER_USER_ID);
  const appFlowyReadiness = getAppFlowyReadiness(env, env.ULTRON_INTEGRATION_OWNER_USER_ID);

  return [
    {
      id: "heygem",
      name: "HeyGem Avatar",
      capability: "Talking-head avatar and lip-sync media jobs",
      state: hasHeyGem ? "configured_unverified" : "blocked",
      configured: hasHeyGem,
      mode: "separate_service",
      requiredEnv: ["HEYGEM_API_BASE_URL", "HEYGEM_API_KEY", "HEYGEM_JOB_PATH"],
      apiRoutes: ["/api/integrations/heygem/jobs"],
      note: hasHeyGem
        ? "Credentials are present; reachability, license terms, and GPU capacity are not yet verified."
        : "Requires a separately hosted HeyGem-compatible API, credentials, an explicit HEYGEM_JOB_PATH, and a review of its community license/model terms."
    },
    {
      id: "comfyui",
      name: "ComfyUI Studio",
      capability: "Node-based image, video, audio, and 3D generation workflows",
      state: hasComfy ? "configured_unverified" : "blocked",
      configured: hasComfy,
      mode: "separate_service",
      requiredEnv: ["COMFYUI_BASE_URL"],
      optionalEnv: ["COMFYUI_API_KEY"],
      apiRoutes: ["/api/integrations/comfyui/status", "/api/integrations/comfyui/queue", "/api/integrations/comfyui/queue (POST prompt)", "/api/integrations/comfyui/jobs/:promptId (GET history, DELETE queued job)"],
      note: hasComfy
        ? "Endpoint is configured; API connectivity, authentication, workflows, and model availability still need verification."
        : "Requires a separately hosted ComfyUI API and approved workflows/models. Keep it separate from the chat process."
    },
    {
      id: "omnivoice",
      name: "OmniVoice Speech",
      capability: "Multilingual neural speech generation and optional voice cloning",
      state: hasOmniVoice ? "configured_unverified" : "blocked",
      configured: hasOmniVoice,
      mode: "separate_service",
      requiredEnv: ["OMNIVOICE_API_BASE_URL", "OMNIVOICE_API_KEY", "OMNIVOICE_SYNTHESIS_PATH"],
      apiRoutes: ["/api/integrations/omnivoice/synthesize"],
      note: hasOmniVoice
        ? "Credentials are present; model loading, language quality, latency, and consent controls are not yet verified."
        : "The repository is a model/runtime, not a ready-made hosted API. A separate inference service and explicit OMNIVOICE_SYNTHESIS_PATH are required."
    },
    {
      id: "handy",
      name: "Handy Local Transcription",
      capability: "Offline desktop speech-to-text through a local companion bridge",
      state: hasHandyBridge ? "configured_unverified" : "desktop_companion_required",
      configured: hasHandyBridge,
      mode: "desktop_companion",
      requiredEnv: ["ULTRON_HANDY_BRIDGE_URL", "ULTRON_HANDY_BRIDGE_TOKEN", "ULTRON_HANDY_TRANSCRIBE_PATH"],
      apiRoutes: ["/api/integrations/handy/transcribe"],
      note: hasHandyBridge
        ? "Bridge settings are present; local IPC, authentication, and transcription have not yet been verified."
        : "Handy is a local desktop app. The public Render service cannot access a user's microphone or local Handy process directly."
    },
    {
      id: "geo-sleuth",
      name: "Geo-Sleuth Photo Geolocation",
      capability: "Prepare photo metadata, OCR, image crops and evidence for a photo-location investigation",
      state: hasGeoSleuth ? "configured_unverified" : "disabled",
      configured: hasGeoSleuth,
      mode: "local_python_cli",
      requiredEnv: ["GEO_SLEUTH_ENABLED=true", "GEO_SLEUTH_ROOT"],
      apiRoutes: ["/api/integrations/geo-sleuth/status", "/api/integrations/geo-sleuth/intake"],
      note: hasGeoSleuth
        ? "Intake route is enabled; Python dependencies and end-to-end location verification still need a live test. Reverse-image search is opt-in."
        : "Enable the pinned Geo-Sleuth runtime in the deployment. The tool prepares evidence but does not independently prove a location."
    },
    {
      id: "voicestudio",
      name: "VoiceStudio Speech Engine",
      capability: "Multilingual speech synthesis, voice catalog, and transcription through VoiceStudio local API",
      state: hasVoiceStudio ? "configured_unverified" : "desktop_companion_required",
      configured: Boolean(hasVoiceStudio),
      mode: "local_or_separate_https_service",
      requiredEnv: ["VOICESTUDIO_BASE_URL"],
      optionalEnv: ["VOICESTUDIO_API_KEY"],
      apiRoutes: ["/api/integrations/voicestudio/status", "/api/integrations/voicestudio/voices", "/api/integrations/voicestudio/synthesize", "/api/integrations/voicestudio/transcribe"],
      note: hasVoiceStudio
        ? "Endpoint is configured; live model readiness must be verified through the status route."
        : "Install and run VoiceStudio separately. Cloud ULTRON cannot reach a user's PC localhost; remote endpoints require HTTPS and an API key."
    },
    {
      id: "chatwoot",
      name: "Chatwoot Support Inbox",
      capability: "Read-only listing and triage context for conversations",
      state: hasChatwoot ? "configured_unverified" : "blocked",
      configured: Boolean(hasChatwoot),
      mode: "owner_scoped_external_api",
      requiredEnv: ["CHATWOOT_BASE_URL", "CHATWOOT_API_TOKEN", "CHATWOOT_ACCOUNT_ID", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["agent tool: chatwoot_list_conversations"],
      note: hasChatwoot
        ? "Owner-scoped API credentials are present; live conversation listing is not yet verified. Replies and conversation state changes are not exposed as automatic actions."
        : "Requires a secure Chatwoot API endpoint/token/account ID and an owner UUID guard; connector remains disabled otherwise."
    },
    {
      id: "openproject",
      name: "OpenProject",
      capability: "Read-only project and work-package listing",
      state: hasOpenProject ? "configured_unverified" : "blocked",
      configured: Boolean(hasOpenProject),
      mode: "owner_scoped_external_api",
      requiredEnv: ["OPENPROJECT_BASE_URL", "OPENPROJECT_API_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["agent tool: openproject_list_projects", "agent tool: openproject_list_work_packages"],
      note: hasOpenProject
        ? "Owner-scoped API credentials are present; live project/work-package reads are not yet verified. Writes are not exposed as automatic actions."
        : "Requires a secure OpenProject API endpoint/token and an owner UUID guard; connector remains disabled otherwise."
    },
    {
      id: "caldiy",
      name: "Cal.diy / Cal.com-compatible Scheduling",
      capability: "Read-only event-type listing and availability lookup",
      state: hasCalDiy ? "configured_unverified" : "blocked",
      configured: Boolean(hasCalDiy),
      mode: "owner_scoped_external_api",
      requiredEnv: ["CALDIY_BASE_URL", "CALDIY_API_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      optionalEnv: ["CALDIY_API_VERSION"],
      apiRoutes: ["agent tool: caldiy_list_event_types", "agent tool: caldiy_check_availability"],
      note: hasCalDiy
        ? "Owner-scoped API credentials are present; event types/availability need live verification. Booking/cancellation is not exposed as automatic action."
        : "Requires a secure compatible API endpoint/token and an owner UUID guard; connector remains disabled otherwise."
    },
    {
      id: "rea-reverse-engineering",
      name: "REA Reverse Engineering",
      capability: "Evidence-backed feature tracing and read-only reverse engineering of authorized application and software artifacts through REA MCP",
      state: reaReadiness.state,
      configured: Boolean(reaReadiness.configured),
      mode: "owner_scoped_mcp",
      requiredEnv: ["REA_MCP_ENABLED=true", "REA_MCP_URL", "REA_ANALYSIS_ROOT", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      optionalEnv: ["REA_MCP_TOKEN"],
      apiRoutes: ["agent tools: rea_investigate_application_feature, rea_analyze_application, rea_inspect_native_code, rea_inspect_artifact, rea_inspect_binary_layout, rea_inspect_wasm_artifact, rea_inspect_firmware_regions, rea_inspect_web_network_capture, rea_inspect_desktop_application, rea_inspect_model_artifact, rea_inspect_managed_artifact, rea_inspect_apk_signature, rea_inspect_android_package, rea_search_guidance, rea_list_guided_workflows"],
      note: reaReadiness.note
    },
    {
      id: "obscura",
      name: "Obscura Read-only Browser",
      capability: "Public HTTPS page navigation and DOM snapshot through the Obscura MCP service",
      state: obscuraReadiness.state,
      configured: Boolean(obscuraReadiness.configured),
      mode: "owner_scoped_mcp",
      requiredEnv: ["OBSCURA_MCP_URL", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      optionalEnv: ["OBSCURA_MCP_TOKEN"],
      apiRoutes: ["agent tool: obscura_inspect_public_page"],
      note: obscuraReadiness.configured
        ? "The MCP endpoint and owner guard are configured; live navigation has not been verified. Remote endpoints must be behind a gateway that validates the configured bearer token."
        : "Requires a local Obscura MCP service or a remote HTTPS service behind an authenticated gateway. Public-page read-only use only; no stealth, proxy rotation, authentication/CAPTCHA bypass, or form submission."
    },
    {
      id: "chrome-devtools",
      name: "Chrome DevTools Browser Debugging",
      capability: "Owner-scoped live Chrome navigation, screenshots, console/network diagnostics, and performance traces",
      state: hasChromeDevTools ? "configured_unverified" : "blocked",
      configured: Boolean(hasChromeDevTools),
      mode: "owner_scoped_local_cdp_bridge",
      requiredEnv: ["ULTRON_CHROME_DEVTOOLS_URL", "ULTRON_CHROME_DEVTOOLS_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["agent tool: chrome_devtools", "local MCP tools: chrome_status, chrome_navigate, chrome_click, chrome_fill, chrome_page_snapshot, chrome_screenshot, chrome_console_logs, chrome_network_requests, chrome_performance_trace"],
      note: hasChromeDevTools
        ? "Bridge URL, token and owner guard are configured; local Chrome/CDP connectivity remains unverified. A hosted backend cannot reach the developer PC's localhost."
        : "Optional TypeScript Chrome CDP companion; requires a token of at least 32 characters and the exact owner UUID. Remote use requires a private authenticated HTTPS gateway; never expose port 9222."
    },
    {
      id: "cactus-compute",
      name: "Cactus Local Model Engine",
      capability: "Optional OpenAI-compatible local model provider with tool calling and confidence-based fallback",
      state: cactusReadiness.state,
      configured: Boolean(cactusReadiness.configured),
      mode: "local_or_authenticated_https_model_provider",
      requiredEnv: ["CACTUS_BASE_URL", "CACTUS_MODEL"],
      optionalEnv: ["CACTUS_API_KEY", "CACTUS_LOCAL_FIRST", "CACTUS_CONFIDENCE_THRESHOLD", "CACTUS_SUPPORTS_TOOLS"],
      apiRoutes: ["agent tool: check_cactus", "model gateway: /chat/completions"],
      note: cactusReadiness.configured
        ? "Configured but not yet live-tested. The engine and Needle/Whistle must be installed and started separately; ULTRON never downloads model weights."
        : "Requires an already-running Cactus OpenAI-compatible server, an installed model ID, and an authenticated HTTPS gateway for remote endpoints. On the same machine, loopback HTTP is allowed."
    },
    {
      id: "strata",
      name: "Strata Local Inference",
      capability: "Optional OpenAI-/Anthropic-compatible local model server",
      state: strataReadiness.state,
      configured: Boolean(strataReadiness.configured),
      mode: "optional_model_provider",
      requiredEnv: ["STRATA_BASE_URL", "STRATA_MODEL"],
      optionalEnv: ["STRATA_API_KEY", "STRATA_SUPPORTS_TOOLS", "STRATA_SUPPORTS_VISION"],
      apiRoutes: ["model provider fallback: /chat/completions"],
      note: strataReadiness.note
    },
    {
      id: "open-seo",
      name: "OpenSEO SEO Research",
      capability: "Owner-scoped MCP project/context/keyword reads and explicitly credit-gated keyword/domain/SERP research",
      state: openSeoReadiness.configured ? "configured_unverified" : "optional",
      configured: Boolean(openSeoReadiness.configured),
      mode: "owner_scoped_mcp",
      requiredEnv: ["OPENSEO_API_KEY", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      optionalEnv: ["OPENSEO_MCP_URL"],
      apiRoutes: ["agent tool: openseo (list_projects, get_project_context, list_saved_keywords, estimate_rank_tracker_cost, research_keywords, get_domain_overview, get_domain_keyword_suggestions, get_serp_results)"],
      note: openSeoReadiness.note
    },
    {
      id: "open-higgsfield",
      name: "OpenHiggsfield Image/Video Studio",
      capability: "Allowlisted 38-model image/video generation, reference inputs, queue submission and job-status polling",
      state: openHiggsfieldReadiness.state,
      configured: Boolean(openHiggsfieldReadiness.configured),
      mode: "owner_scoped_metered_media_api",
      requiredEnv: ["ULTRON_OPEN_HIGGSFIELD_ENABLED=true", "HF_API_BASE_URL", "OPEN_HIGGSFIELD_API_KEY", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["GET /api/integrations/open-higgsfield/models", "POST /api/integrations/open-higgsfield/generate", "GET /api/integrations/open-higgsfield/jobs/:requestId", "agent tool: openhiggsfield"],
      note: openHiggsfieldReadiness.note
    },
    {
      id: "open-design",
      name: "OpenDesign Headless Design Agent",
      capability: "Owner-scoped project discovery, BYOK design/coding task submission and run status/deliverable validation",
      state: openDesignReadiness.state,
      configured: Boolean(openDesignReadiness.configured),
      mode: "owner_scoped_headless_daemon",
      requiredEnv: ["OPEN_DESIGN_ENABLED=true", "OPEN_DESIGN_BASE_URL", "OPEN_DESIGN_API_TOKEN", "OPEN_DESIGN_PROJECT_ID", "OPEN_DESIGN_BYOK_BASE_URL", "OPEN_DESIGN_BYOK_API_KEY", "OPEN_DESIGN_BYOK_MODEL", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["GET /api/integrations/open-design/status", "GET /api/integrations/open-design/projects", "POST /api/integrations/open-design/runs", "GET /api/integrations/open-design/runs/:runId", "agent tool: open_design"],
      note: openDesignReadiness.note
    },
    {
      id: "open-generative-ai",
      name: "Open Generative AI / MuAPI Studio",
      capability: "Allowlisted image generation/editing and video text/image/reference/edit/extend workflows with asynchronous status polling",
      state: openGenerativeAIReadiness.state,
      configured: Boolean(openGenerativeAIReadiness.configured),
      mode: "owner_scoped_metered_media_api",
      requiredEnv: ["ULTRON_OPEN_GENERATIVE_AI_ENABLED=true", "MUAPI_API_KEY", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["GET /api/integrations/open-generative-ai/status", "GET /api/integrations/open-generative-ai/models", "POST /api/integrations/open-generative-ai/generate", "GET /api/integrations/open-generative-ai/jobs/:requestId", "agent tool: open_generative_ai"],
      note: openGenerativeAIReadiness.note
    },
    {
      id: "appflowy",
      name: "AppFlowy Workspace Knowledge",
      capability: "Owner-scoped workspace listing, recursive page/folder tree reads and document search",
      state: appFlowyReadiness.state,
      configured: Boolean(appFlowyReadiness.configured),
      mode: "owner_scoped_read_only_cloud_api",
      requiredEnv: ["APPFLOWY_ENABLED=true", "APPFLOWY_BASE_URL", "APPFLOWY_API_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      optionalEnv: ["APPFLOWY_CLIENT_VERSION", "APPFLOWY_DEVICE_ID"],
      apiRoutes: ["GET /api/integrations/appflowy/status", "GET /api/integrations/appflowy/workspaces", "GET /api/integrations/appflowy/workspaces/:workspaceId/folder", "GET /api/integrations/appflowy/workspaces/:workspaceId/search", "agent tool: appflowy"],
      note: appFlowyReadiness.note
    },
    {
      id: "hermes-agent",
      name: "Hermes Agent Runtime",
      capability: "Delegated tool-enabled agent runtime, skills, memory, subagents, and scheduled routines",
      state: hermesReadiness.state,
      configured: Boolean(hermesReadiness.configured),
      mode: "owner_scoped_agent_gateway",
      requiredEnv: ["HERMES_AGENT_ENABLED=true", "HERMES_AGENT_BASE_URL", "HERMES_AGENT_API_KEY", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      optionalEnv: ["HERMES_AGENT_MODEL", "HERMES_AGENT_CHAT_PROVIDER=true"],
      apiRoutes: ["agent tools: check_hermes_agent, hermes_agent_task"],
      note: hermesReadiness.configured
        ? "Configured but not live-verified; Hermes-side toolsets, model provider, skills, memory, terminal sandbox and integrations must be configured separately."
        : "Requires a separately installed and authenticated Hermes Agent API server. ULTRON does not install the runtime or enable external messaging/cron actions automatically."
    },
  {
      id: "paperclip",
      name: "Paperclip Agent Governance",
      capability: "Read-only agent roster, company dashboard, and monthly cost summary",
      state: paperclipReadiness.state,
      configured: Boolean(paperclipReadiness.configured),
      mode: "owner_scoped_external_api",
      requiredEnv: ["PAPERCLIP_BASE_URL", "PAPERCLIP_API_TOKEN", "PAPERCLIP_COMPANY_ID", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["agent tool: paperclip_read_agent_governance"],
      note: paperclipReadiness.configured
        ? "Endpoint/token/company and owner guard are present; live roster, dashboard, and cost compatibility remain unverified. Read-only tool only."
        : "Requires a separately hosted Paperclip service, bearer API token, company ID, and exact owner UUID guard. It cannot create, hire, assign, pause, terminate, or change budgets."
    },
    {
      id: "google-workspace",
      name: "Google Workspace Read-Only Bridge",
      capability: "Owner-scoped read-only Gmail, Calendar, Drive, Docs and Sheets access",
      state: hasGoogleWorkspace ? "configured_unverified" : "blocked",
      configured: Boolean(hasGoogleWorkspace),
      mode: "owner_scoped_read_only_apps_script_bridge",
      requiredEnv: ["GOOGLE_WORKSPACE_BRIDGE_URL", "GOOGLE_WORKSPACE_BRIDGE_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["agent tools: google_gmail_list_unread, google_gmail_search, google_calendar_get_events, google_drive_list_files, google_drive_read_doc, google_sheets_read"],
      note: hasGoogleWorkspace
        ? "The HTTPS bridge URL, shared token and owner guard are present; live Google account access remains unverified. Sending email, editing Sheets, creating events and deleting/moving files are disabled."
        : "Configure a fixed Google Apps Script /exec URL, a strong Script Properties token mirrored in the backend environment, and the exact owner UUID. Only bounded read actions will be available."
    },
    {
      id: "ai-employees",
      name: "AI Employee Routines",
      capability: "Role-based task templates, checklists, and scheduled routines",
      state: employeesEnabled ? "enabled_guarded_templates" : "disabled",
      configured: employeesEnabled,
      mode: "native_guarded_workflows",
      requiredEnv: ["ULTRON_EMPLOYEES_ENABLED=true"],
      note: employeesEnabled
        ? "Routine templates are enabled in guarded mode; external accounts, schedules, and consequential actions still require explicit setup and confirmation."
        : "Routine orchestration is disabled by default. Enable only after task storage, audit logging, and approval gates are verified."
    },
    {
      id: "windows-desktop-companion",
      name: "Windows Desktop Companion",
      capability: "Owner-scoped read-only device pairing and status check; no command execution yet",
      state: hasDesktopCompanion ? "configured_unverified" : "desktop_companion_required",
      configured: Boolean(hasDesktopCompanion),
      mode: "owner_scoped_read_only_status_probe",
      requiredEnv: ["ULTRON_DESKTOP_AGENT_URL", "ULTRON_DESKTOP_AGENT_TOKEN", "ULTRON_INTEGRATION_OWNER_USER_ID"],
      apiRoutes: ["agent tool: check_desktop_companion"],
      note: hasDesktopCompanion
        ? "Bridge settings are present; the protocol must return a paired Windows-device status. This adapter is read-only and cannot run commands or control the PC."
        : "Requires a separately installed Windows companion reachable through HTTPS and an owner-scoped server token. Shell/keyboard/mouse actions are not exposed by this status adapter."
    }
  ];
}
