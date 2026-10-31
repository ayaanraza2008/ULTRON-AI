/**
 * ULTRON AI — Specialized 18-Agent Coordinated System Catalog
 *
 * Defines the roles, capabilities, allowlisted tools, and boundaries
 * for all 18 specialized autonomous engineering agents inspired by JARVIS × ULTRON.
 */

export const ULTRON_AGENT_CATALOG = [
  {
    id: "ultron-core",
    name: "ULTRON CORE",
    role: "Central Intelligence & Master Orchestrator",
    description: "Master coordinator that understands overall context, arbitrates agent delegation, and enforces global policies.",
    allowedTools: ["delegate_task", "query_memory", "get_system_status", "emergency_stop", "broadcast_notification", "synthesize_directive"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 1
  },
  {
    id: "jarvis-assistant",
    name: "JARVIS PERSONAL ASSISTANT",
    role: "Conversational Intelligence & Personal Concierge",
    description: "Conducts natural conversations, prepares daily briefings, coordinates user schedules, and tracks personal preferences.",
    allowedTools: ["personal_conversation", "daily_briefing", "schedule_reminder", "proactive_check", "user_preferences"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 1
  },
  {
    id: "research-agent",
    name: "RESEARCH AGENT",
    role: "Information Discovery & Fact Verification",
    description: "Performs multi-source web investigations, reads documents, compares sources, and generates factual synthesis.",
    allowedTools: ["tavily_search", "duckduckgo_search", "extract_page_content", "read_document", "verify_facts", "multi_source_synthesis"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "coding-agent",
    name: "CODING AGENT",
    role: "Code Generation & Syntax Verification",
    description: "Performs repository analysis, code generation, refactoring, bug fixing, and test authoring within isolated sandboxes.",
    allowedTools: ["read_source_file", "write_sandbox_code", "execute_sandbox_tests", "git_status", "prepare_diff", "syntax_check"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "software-engineering-agent",
    name: "SOFTWARE ENGINEERING AGENT",
    role: "Architectural Refactoring & CI/CD Pipeline",
    description: "Inspects multi-file repository architecture, generates comprehensive test suites, reviews PR diffs, and troubleshoots CI.",
    allowedTools: ["repository_analysis", "refactor_code", "generate_tests", "ci_troubleshooting", "prepare_pull_request", "code_review"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "security-agent",
    name: "SECURITY AGENT",
    role: "Cybersecurity & Policy Auditing",
    description: "Monitors tool invocations, scans code for CVEs/secrets, audits network egress, and enforces permission gates.",
    allowedTools: ["audit_log_inspection", "scan_secrets", "verify_dns_safety", "check_permissions", "revoke_session", "ssrf_guard"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 0
  },
  {
    id: "browser-agent",
    name: "BROWSER AGENT",
    role: "Web Navigation & Page Interaction",
    description: "Automates multi-step browser tasks, navigation, DOM analysis, form submission, and web page content snapshots.",
    allowedTools: ["browser_navigate", "page_inspect", "extract_dom", "fill_form", "workflow_automation", "screenshot_element"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3
  },
  {
    id: "system-agent",
    name: "WINDOWS COMPUTER ASSISTANT",
    role: "Windows & Local PC Operations",
    description: "Manages local computer operations, process monitoring, file organization, clipboard, and hardware telemetry.",
    allowedTools: ["get_hardware_telemetry", "list_processes", "launch_app", "sandboxed_file_op", "clipboard_read_write", "lock_workstation", "set_volume"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3
  },
  {
    id: "android-agent",
    name: "ANDROID DEVICE AGENT",
    role: "Mobile Companion & Device Hub",
    description: "Coordinates companion phone integration, cryptographic pairing PIN verification, notification push, and mobile telemetry.",
    allowedTools: ["send_companion_notification", "poll_device_commands", "verify_pairing_pin", "read_mobile_telemetry", "sync_device_state"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "voice-agent",
    name: "VOICE AGENT",
    role: "JARVIS Conversational Speech",
    description: "Handles wake-word events, speech-to-text transcription, natural voice synthesis, and multi-lingual voice cues.",
    allowedTools: ["wake_word_listen", "transcribe_speech", "synthesize_speech", "set_voice_profile", "stop_speaking", "sapi_tts_speak"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 1
  },
  {
    id: "vision-agent",
    name: "VISION AGENT",
    role: "Multimodal & Environmental Awareness",
    description: "Inspects webcam frames, analyzes screen contents, performs OCR, and compares visual UI elements.",
    allowedTools: ["capture_screenshot", "analyze_image", "extract_ocr", "inspect_ui_elements", "webcam_frame_analysis"],
    maxConcurrency: 1,
    autonomyLevelThreshold: 2
  },
  {
    id: "memory-agent",
    name: "MEMORY AGENT",
    role: "Cognitive Knowledge & Memory Vault",
    description: "Manages conversational memory, user preferences, factual extraction, consolidation, deduplication, and expiration.",
    allowedTools: ["store_memory", "recall_memory", "consolidate_memories", "purge_expired_memories", "export_vault", "isolate_account_memory"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 1
  },
  {
    id: "automation-agent",
    name: "TASK AUTOMATION AGENT",
    role: "Scheduled Routines & Background Workflows",
    description: "Schedules recurring routines, executes cron-style automation pipelines, and dispatches webhook triggers.",
    allowedTools: ["schedule_routine", "cancel_routine", "execute_cron", "dispatch_webhook", "trigger_workflow"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3
  },
  {
    id: "document-agent",
    name: "DOCUMENT INTELLIGENCE AGENT",
    role: "Document Analysis & Knowledge Extraction",
    description: "Parses PDF, markdown, and text documents, generates structured knowledge summaries, and indexes document text.",
    allowedTools: ["parse_pdf", "extract_document_text", "index_document", "query_knowledge_base", "citation_tracker"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "self-improvement-agent",
    name: "SELF-EVALUATION & IMPROVEMENT AGENT",
    role: "Performance Evaluation & Skill Registry",
    description: "Analyzes task outcomes, identifies recurring failure modes, drafts reusable skills, and tests against regressions.",
    allowedTools: ["evaluate_task_outcome", "register_skill", "test_skill", "audit_skill_safety", "analyze_failure", "propose_patch"],
    maxConcurrency: 1,
    autonomyLevelThreshold: 2
  },
  {
    id: "system-monitoring-agent",
    name: "SYSTEM MONITORING AGENT",
    role: "Host Health & Headroom Watchdog",
    description: "Tracks CPU load, monitors RAM usage against the 85% headroom threshold, and checks background worker health.",
    allowedTools: ["check_cpu_ram", "headroom_alert", "worker_health", "audit_event_stream", "uptime_telemetry"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 1
  },
  {
    id: "planning-agent",
    name: "PLANNING AGENT",
    role: "Strategic Task Decomposition",
    description: "Decomposes complex goals into sequential and parallel execution DAGs with checkpoints and rollback paths.",
    allowedTools: ["create_execution_plan", "estimate_resources", "reorder_tasks", "evaluate_dependencies", "build_dag"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 1
  },
  {
    id: "integration-agent",
    name: "INTEGRATION MANAGEMENT AGENT",
    role: "Ecosystem Bridges & MCP Gateways",
    description: "Manages connectivity to external gateways, MCP tools, Strata, Hermes, and Google Workspace integrations.",
    allowedTools: ["check_mcp_servers", "verify_bridge_health", "openrouter_proxy_status", "rea_gateway_query", "strata_status"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  }
];

const ALIASES = {
  "jarvis": "jarvis-assistant",
  "windows-agent": "system-agent",
  "windows-computer-assistant": "system-agent",
  "self-evaluation-agent": "self-improvement-agent",
  "software-engineer": "software-engineering-agent",
  "execution-agent": "ultron-core"
};

export function getAgentById(agentId) {
  const canonical = ALIASES[agentId] || agentId;
  return ULTRON_AGENT_CATALOG.find(agent => agent.id === canonical) || null;
}

export function listAvailableAgents(currentAutonomyLevel = 2) {
  return ULTRON_AGENT_CATALOG.filter(agent => currentAutonomyLevel >= agent.autonomyLevelThreshold);
}
