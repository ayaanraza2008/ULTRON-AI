const safeBaseUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

/**
 * Returns configuration readiness only. It does not claim that an external
 * service is reachable or that model weights are installed.
 */
export function buildIntegrationCatalog(env = process.env) {
  const hasComfy = safeBaseUrl(env.COMFYUI_BASE_URL);
  const hasHeyGem = safeBaseUrl(env.HEYGEM_API_BASE_URL) && Boolean(env.HEYGEM_API_KEY) && typeof env.HEYGEM_JOB_PATH === "string" && env.HEYGEM_JOB_PATH.startsWith("/");
  const hasOmniVoice = safeBaseUrl(env.OMNIVOICE_API_BASE_URL) && Boolean(env.OMNIVOICE_API_KEY) && typeof env.OMNIVOICE_SYNTHESIS_PATH === "string" && env.OMNIVOICE_SYNTHESIS_PATH.startsWith("/");
  const hasHandyBridge = safeBaseUrl(env.ULTRON_HANDY_BRIDGE_URL) && Boolean(env.ULTRON_HANDY_BRIDGE_TOKEN) && typeof env.ULTRON_HANDY_TRANSCRIBE_PATH === "string" && env.ULTRON_HANDY_TRANSCRIBE_PATH.startsWith("/");
  const employeesEnabled = env.ULTRON_EMPLOYEES_ENABLED === "true";
  const hasGeoSleuth = env.GEO_SLEUTH_ENABLED === "true";

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
    }
  ];
}
