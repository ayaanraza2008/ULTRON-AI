// Friday-inspired deterministic routing for ULTRON's existing allowlisted agent tools.
// Tool schemas are narrowed only for a single, high-confidence intent. Compound or
// ambiguous requests keep the full allowlist so a narrow classifier cannot strand work.
const CATEGORY_TOOLS = Object.freeze({
  voice: [
    "clone_speech_voice", "design_speech_voice", "describe_speech_voice",
    "list_speech_voices", "synthesize_speech", "transcribe_audio",
    "create_talking_avatar"
  ],
  weather: ["weather_lookup"],
  study: ["create_study_pack"],
  notes: ["notes_search", "notes_read", "notes_create", "notes_update"],
  github: ["github_public_repo"],
  reminders: ["list_reminders", "create_reminder", "update_reminder"],
  wikipedia: ["wikipedia_lookup"],
  time: ["world_clock"],
  research: ["research_web", "check_openviking", "openviking_find_context", "openviking_read_context"],
  browser: ["browser_use", "chrome_devtools", "research_web", "obscura_inspect_public_page", "obscura_capture_public_page"],
  reverse_engineering: [
    "rea_analyze_application", "rea_investigate_application_feature", "rea_inspect_native_code",
    "rea_inspect_artifact", "rea_inspect_binary_layout", "rea_inspect_wasm_artifact",
    "rea_inspect_firmware_regions", "rea_inspect_web_network_capture", "rea_inspect_desktop_application",
    "rea_inspect_model_artifact", "rea_inspect_managed_artifact", "rea_inspect_apk_signature",
    "rea_inspect_android_package", "rea_search_guidance", "rea_list_guided_workflows"
  ],
  harness2: ["harness2_guidance"],
  coding_sandbox: ["coding_sandbox_run"],
  coding: ["coding_assist", "check_repository_capabilities", "check_openviking", "openviking_find_context", "openviking_read_context"],
  memory: ["check_openviking", "openviking_find_context", "openviking_read_context"],
  integrations: [
    "check_integrations", "check_cactus", "check_desktop_companion",
    "check_openviking", "check_hermes_agent", "check_comfyui",
    "check_repository_capabilities", "paperclip_read_agent_governance"
  ],
  desktop: ["check_desktop_companion"],
  productivity: [
    "chatwoot_list_conversations", "openproject_list_projects",
    "openproject_list_work_packages", "caldiy_list_event_types",
    "caldiy_check_availability"
  ],
  google_workspace: [
    "google_workspace_status", "google_gmail_list_unread", "google_gmail_search",
    "google_calendar_get_events", "google_drive_list_files", "google_drive_read_doc",
    "google_sheets_read"
  ],
  planning: ["plan_employee", "enqueue_employee_task", "create_youtube_production_plan"],
  youtube: ["create_youtube_production_plan", "research_web"],
  geolocation: ["geo_sleuth_investigate", "research_web"],
  spaceplanner: ["create_spaceplanner_plan"],
  world_intelligence: ["world_intelligence_command"],
  paperclip: ["paperclip_read_agent_governance"],
  hermes: ["check_hermes_agent", "hermes_agent_task"],
  cactus: ["check_cactus"],
  comfyui: ["check_comfyui", "run_comfyui_workflow"],
  media: [
    "create_youtube_production_plan", "check_comfyui", "run_comfyui_workflow",
    "create_talking_avatar", "design_speech_voice", "synthesize_speech",
    "openhiggsfield", "open_generative_ai"
  ],
  open_higgsfield: ["openhiggsfield", "check_integrations", "check_repository_capabilities"],
  open_generative_ai: ["open_generative_ai", "check_integrations", "check_repository_capabilities"],
  open_design: ["open_design", "coding_assist", "check_integrations", "check_repository_capabilities"],
  appflowy: ["appflowy", "check_integrations", "check_repository_capabilities"],
  open_seo: ["openseo", "research_web", "check_integrations", "check_repository_capabilities"]
});

const CATEGORY_PATTERNS = Object.freeze([
  ["harness2", /\b(?:harness2|agent harness benchmark|benchmark harness|recursive harness refinement)\b/i],
  ["coding_sandbox", /^\s*(?:please\s+)?(?:run|execute|test)\s+(?:(?:(?:this|the|following|provided)\s+)?(?:code|script|program|snippet)|(?:(?:this|the|following|provided)\s+)?(?:python|javascript|node(?:\.js)?)\s+(?:code|script|program|snippet))\b/i],
  ["reminders", /\b(?:remind me|reminder(?:s)?|snooze (?:a |the )?reminder|mark (?:a |the )?reminder|reschedule (?:a |the )?reminder)\b/i],
  ["github", /\b(?:github|git hub|github\.com|readme (?:from|on) github|latest commits for|open issues for|public github repository)\b/i],
  ["notes", /\b(?:notes? library|saved notes?|search (?:my )?notes?|find (?:my )?notes?|read (?:my |the )?note|create (?:a )?note|write (?:a )?note|save (?:a |this |the )?note|update (?:my |the )?note)\b/i],
  ["study", /\b(?:study mode|study pack|study guide|exam mode|revision sheet|revision notes|flashcards?|make (?:me )?(?:a )?quiz|create (?:a )?quiz|generate (?:a )?quiz|practice questions|practice test|mock test|self.?test|quiz me|test me on)\b/i],
  ["weather", /\b(?:weather\s+(?:in|for|forecast)|current weather|forecast\s+(?:in|for)|temperature\s+(?:outside|in)|rain chance\s+in|local weather)\b/i],
  ["wikipedia", /\b(?:wikipedia|wiki article|wikipedia page)\b/i],
  ["time", /\b(?:world clock|time zones?|timezones?|utc offset|time difference|what\s+time\b|current time in\b|local time in\b|time in\s+[a-z][a-z .'-]{1,60})\b/i],
  ["voice", /\b(?:voice|speech|tts|stt|transcrib(?:e|ing|tion)|audio|pronunciation|speak aloud|read(?:ing)? (?:it )?aloud|read (?:this|it|that) aloud|read out loud|read this to me|read it to me|voice studio|voicestudio)\b/i],
  ["browser", /\b(?:chrome devtools|devtools|performance trace|browser performance|console logs|network requests|inspect chrome|browser automation|use the browser|open the website|inspect the (?:website|page)|take a screenshot of the website|click the (?:button|link|tab)|navigate (?:the )?(?:website|page|site)|webpage|browser-use)\b/i],
  ["reverse_engineering", /\b(?:reverse engineer(?:ing)?|trace how .{1,120} work(?:s)?|trace application feature|inspect (?:this |an? )?(?:binary|executable|firmware|apk|electron app|desktop application|wasm)|analy[sz]e (?:the )?(?:binary|executable|firmware|apk|electron app|native code)|decompile|disassembl(?:e|y)|\brea\b)\b/i],
  ["geolocation", /\b(?:geolocat(?:e|ion)|where was this photo taken|photo location|identify (?:this )?location from (?:the )?(?:photo|image)|geo[- ]sleuth)\b/i],
  ["spaceplanner", /\b(?:floor plan|house plan|room layout|interior layout|spaceplanner|space planner)\b/i],
  ["world_intelligence", /\b(?:god[’']?s eye|world intelligence|live globe|earthquake map|live flights|vessel tracking)\b/i],
  ["youtube", /\b(?:youtube|video production plan|scene plan|thumbnail prompt|shorts script)\b/i],
  ["comfyui", /\b(?:comfyui|workflow json|image workflow|render an image|run the workflow)\b/i],
  ["open_higgsfield", /\b(?:openhiggsfield|open higgsfield|higgsfield (?:image|video|model|generation)|higgsfield\s+studio)\b/i],
  ["open_generative_ai", /\b(?:open[- ]generative[- ]ai|open gen(?:erative)? ai studio|muapi (?:image|video) generation|muapi model)\b/i],
  ["open_design", /\b(?:opendesign|open design (?:agent|workspace|project)|headless design agent|design workspace run)\b/i],
  ["appflowy", /\b(?:appflowy|appflowy workspace|search appflowy|appflowy documents?)\b/i],
  ["open_seo", /\b(?:openseo|open seo|seo keyword research|rank tracker cost|domain keyword suggestions|serp lookup)\b/i],
  ["paperclip", /\b(?:paperclip|agent governance|agent roster|agent budget|monthly agent cost)\b/i],
  ["hermes", /\b(?:hermes agent|run hermes|hermes task)\b/i],
  ["cactus", /\b(?:cactus model|cactus provider|local model service)\b/i],
  ["desktop", /\b(?:windows companion|desktop companion|pair (?:my )?(?:pc|computer)|is my pc connected|desktop pairing|local pc status)\b/i],
  ["google_workspace", /\b(?:google workspace|gmail|google calendar|google drive|google docs|google sheets|apps script bridge)\b/i],
  ["productivity", /\b(?:chatwoot|openproject|cal\.diy|cal\.com|work packages|meeting availability|event types)\b/i],
  ["coding", /\b(?:write code|coding assist|debug|fix (?:the )?(?:bug|error|test)|implement (?:this|the|a|an)|review (?:this|the) code|refactor|code review|programming task)\b/i],
  ["memory", /\b(?:memory vault|saved memory|recall (?:my|the|a)|what did we decide|we (?:decided|agreed|chose)|decision noted|remember (?:that|this)|prior project context|openviking|agentmemory)\b/i],
  ["research", /\b(?:research|look up|search the web|search online|latest (?:news|information|release)|find sources|fact check|current information)\b/i],
  ["integrations", /\b(?:integration status|check integrations|what integrations|connected services|capability status|provider status|list capabilities|which tools are available|tools available for|connector readiness|repository readiness)\b/i],
  ["planning", /\b(?:plan (?:my|the|a|an)|create a plan|multi[- ]step task|schedule (?:a|an|the) (?:task|employee|routine)|background task|enqueue task|queue (?:a |the |this )?(?:background )?(?:research |review |report |task|employee)|queue .*\b(?:background|research|review|report|task)\b|\b(?:background|queue|enqueue)\b.{0,80}\b(?:task|report|research|review|employee)\b|run this in the background)\b/i],
  ["browser", /\b(?:obscura|public web page snapshot|capture this public page)\b/i],
  ["media", /\b(?:talking avatar|synthetic voice|voice clone|generate media|make a video|create an image|image generation)\b/i]
]);

const COMPLEX_PATTERN = /\b(?:then|after that|step by step|multi[- ]step|end to end|from scratch|complete project|across multiple|and also|and then|first .* then|workflow|autonomously|queue (?:a |the |an )?(?:task|report|research))\b/i;
const ACTION_PATTERN = /\b(?:build|create|write|fix|debug|implement|run|execute|schedule|send|publish|book|delete|change|update|research|search|open|inspect|transcribe|generate|plan|connect|integrate|check|analyze|analyse|summarize|compare|calculate|find|coordinate|migrate|migration|report|audit|verify|test)\b/i;
const SIMPLE_PATTERN = /^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|who are you|what can you do|what is [\s\S]+|what's [\s\S]+|define [\s\S]+|explain [\s\S]+|tell me about [\s\S]+|how does [\s\S]+ work|why is [\s\S]+)\??[.! ]*$/i;
const VAGUE_PATTERN = /^(?:help|help me|do it|continue|go ahead|make it better|fix it|start|proceed|do the needful|handle it)[.! ]*$/i;

export function getToolCategories() {
  return Object.keys(CATEGORY_TOOLS);
}

export function classifyTaskRoute(value, { hasHistory = false } = {}) {
  const text = typeof value === "string" ? value.trim().slice(0, 6000) : "";
  const categories = [];
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text) && !categories.includes(category)) categories.push(category);
  }
  // Prefer the public GitHub adapter over generic web research when the user
  // names GitHub; its actions are fixed, read-only and repository-scoped.
  if (categories.includes("github")) {
    const genericResearchIndex = categories.indexOf("research");
    if (genericResearchIndex >= 0) categories.splice(genericResearchIndex, 1);
  }
  // A specific Wikipedia lookup should not be widened by the generic "look up"
  // research matcher; the narrow route keeps it on the dedicated read-only tool.
  if (categories.includes("wikipedia")) {
    const genericResearchIndex = categories.indexOf("research");
    if (genericResearchIndex >= 0) categories.splice(genericResearchIndex, 1);
  }

  // Provider-specific intents win over generic media/research matches so the
  // corresponding adapter is actually exposed to the agent.
  const providerSpecific = new Set(["open_higgsfield", "open_generative_ai", "open_design", "appflowy", "open_seo"]);
  if (categories.some(category => providerSpecific.has(category))) {
    const matched = categories.filter(category => providerSpecific.has(category));
    categories.splice(0, categories.length, ...matched);
  }

  const complex = COMPLEX_PATTERN.test(text);
  let tier = "medium";
  if (!text || (!hasHistory && VAGUE_PATTERN.test(text))) tier = "clarify";
  else if (hasHistory && VAGUE_PATTERN.test(text)) tier = "medium";
  else if (complex || categories.length > 1 || /\b(?:project|application|repository|repo|platform|system)\b/i.test(text) && ACTION_PATTERN.test(text)) tier = "complex";
  else if (categories.length === 1) tier = "medium";
  else if (SIMPLE_PATTERN.test(text)) tier = "simple";
  else if (!ACTION_PATTERN.test(text)) tier = "medium";
  else tier = "complex";

  // Simple/underspecified requests should not receive any tool schemas. For one
  // high-confidence domain, send only that domain's allowlist. Compound or
  // uncertain tasks retain the full allowlist so valid subtasks are not hidden.
  let toolNames = null;
  if (tier === "simple" || tier === "clarify") {
    toolNames = [];
  } else if (categories.length === 1 && !complex) {
    const selected = CATEGORY_TOOLS[categories[0]] || [];
    toolNames = [...new Set(selected)];
  }

  return {
    tier,
    categories,
    filtered: Array.isArray(toolNames),
    toolNames,
    clarificationSuggested: tier === "clarify",
    reason: tier === "simple"
      ? "Conversational or explanatory request; no tool schema is needed initially."
      : tier === "clarify"
        ? "The request is too vague to infer a safe task without context."
        : Array.isArray(toolNames)
          ? "One high-confidence intent; send only the matching allowlisted tool schemas."
          : "Compound or uncertain task; retain the full allowlist to avoid hiding needed tools."
  };
}
