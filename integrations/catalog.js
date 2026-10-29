import { getObscuraReadiness } from "./obscura-mcp.js";
import { getCactusReadiness } from "./cactus.js";
import { getPaperclipReadiness } from "./paperclip-services.js";
import { getHermesAgentReadiness } from "./hermes-agent.js";
import { safeServiceBase } from "../network-safety.js";
import { isGoogleWorkspaceConfigured } from "./google-workspace.js";

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
  const cactusReadiness = getCactusReadiness(env);

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
