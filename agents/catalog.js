/**
 * ULTRON AI — Specialized 18-Agent Coordinated System Catalog
 *
 * Defines the roles, responsibilities, capabilities, allowlisted tools,
 * schemas, and boundaries for all 18 specialized autonomous engineering agents
 * inspired by JARVIS × ULTRON.
 */

export const ULTRON_AGENT_CATALOG = [
  {
    id: "ultron-core",
    name: "ULTRON CORE",
    role: "Central Intelligence & Master Orchestrator",
    responsibility: "Global strategy arbitration, inter-agent delegation, and safety enforcement.",
    description: "Master coordinator that understands overall context, arbitrates agent delegation, and enforces global policies.",
    capabilities: ["strategic_arbitration", "inter_agent_delegation", "global_policy_enforcement", "emergency_stop", "system_state_synthesis"],
    allowedTools: ["delegate_task", "query_memory", "get_system_status", "emergency_stop", "broadcast_notification", "synthesize_directive"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 1,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 30000, maxPayloadBytes: 1048576 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, payload: { type: "object" } } },
    outputSchema: { type: "object", required: ["agent", "action", "status"], properties: { agent: { type: "string" }, action: { type: "string" }, status: { type: "string" } } }
  },
  {
    id: "jarvis-assistant",
    name: "JARVIS PERSONAL ASSISTANT",
    role: "Conversational Intelligence & Personal Concierge",
    responsibility: "Natural conversation, daily briefings, schedule coordination, and user concierge.",
    description: "Conducts natural conversations, prepares daily briefings, coordinates user schedules, and tracks personal preferences.",
    capabilities: ["natural_conversation", "daily_briefings", "schedule_tracking", "proactive_alerts", "preference_management"],
    allowedTools: ["personal_conversation", "daily_briefing", "schedule_reminder", "proactive_check", "user_preferences"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 1,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 25000, maxPayloadBytes: 524288 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, query: { type: "string" } } },
    outputSchema: { type: "object", required: ["agent", "response"], properties: { agent: { type: "string" }, response: { type: "string" } } }
  },
  {
    id: "research-agent",
    name: "RESEARCH AGENT",
    role: "Information Discovery & Fact Verification",
    responsibility: "Multi-source research, web investigations, fact validation, and citation tracking.",
    description: "Performs multi-source web investigations, reads documents, compares sources, and generates factual synthesis.",
    capabilities: ["web_search", "source_extraction", "fact_verification", "multi_source_comparison", "citation_tracking"],
    allowedTools: ["tavily_search", "duckduckgo_search", "extract_page_content", "read_document", "verify_facts", "multi_source_synthesis"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 45000, maxPayloadBytes: 2097152 },
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, depth: { type: "string" } } },
    outputSchema: { type: "object", required: ["findings", "sourcesCount"], properties: { findings: { type: "string" }, sourcesCount: { type: "number" } } }
  },
  {
    id: "coding-agent",
    name: "CODING AGENT",
    role: "Code Generation & Syntax Verification",
    responsibility: "Safe code authoring, sandboxed patching, refactoring, and automated test creation.",
    description: "Performs repository analysis, code generation, refactoring, bug fixing, and test authoring within isolated sandboxes.",
    capabilities: ["code_generation", "patch_synthesis", "syntax_verification", "test_authoring", "sandbox_execution"],
    allowedTools: ["read_source_file", "write_sandbox_code", "execute_sandbox_tests", "git_status", "prepare_diff", "syntax_check"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 40000, maxPayloadBytes: 2097152 },
    inputSchema: { type: "object", required: ["task"], properties: { task: { type: "string" }, targetFiles: { type: "array" } } },
    outputSchema: { type: "object", required: ["codeValid", "sandboxed"], properties: { codeValid: { type: "boolean" }, sandboxed: { type: "boolean" } } }
  },
  {
    id: "software-engineering-agent",
    name: "SOFTWARE ENGINEERING AGENT",
    role: "Architectural Refactoring & CI/CD Pipeline",
    responsibility: "System architecture review, multi-file refactoring, CI troubleshooting, and PR review.",
    description: "Inspects multi-file repository architecture, generates comprehensive test suites, reviews PR diffs, and troubleshoots CI.",
    capabilities: ["architecture_review", "multi_file_refactor", "ci_pipeline_analysis", "diff_review", "regression_testing"],
    allowedTools: ["repository_analysis", "refactor_code", "generate_tests", "ci_troubleshooting", "prepare_pull_request", "code_review"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 60000, maxPayloadBytes: 4194304 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, scope: { type: "string" } } },
    outputSchema: { type: "object", required: ["architectureValid", "filesAudited"], properties: { architectureValid: { type: "boolean" }, filesAudited: { type: "number" } } }
  },
  {
    id: "security-agent",
    name: "SECURITY AGENT",
    role: "Cybersecurity & Policy Auditing",
    responsibility: "Vulnerability analysis, secret scanning, SSRF protection, and permission gate validation.",
    description: "Monitors tool invocations, scans code for CVEs/secrets, audits network egress, and enforces permission gates.",
    capabilities: ["secret_scanning", "ssrf_guard", "permission_enforcement", "egress_audit", "session_validation"],
    allowedTools: ["audit_log_inspection", "scan_secrets", "verify_dns_safety", "check_permissions", "revoke_session", "ssrf_guard"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 0,
    retryPolicy: { maxRetries: 2, backoffFactor: 1.5, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 15000, maxPayloadBytes: 524288 },
    inputSchema: { type: "object", required: ["target"], properties: { target: { type: "string" }, scanType: { type: "string" } } },
    outputSchema: { type: "object", required: ["safe", "isolationVerified"], properties: { safe: { type: "boolean" }, isolationVerified: { type: "boolean" } } }
  },
  {
    id: "browser-agent",
    name: "BROWSER AGENT",
    role: "Web Navigation & Page Interaction",
    responsibility: "Safe web automation, DOM inspection, form submission, and web page snapshotting.",
    description: "Automates multi-step browser tasks, navigation, DOM analysis, form submission, and web page content snapshots.",
    capabilities: ["dom_inspection", "safe_navigation", "form_interaction", "screenshot_snapshot", "workflow_automation"],
    allowedTools: ["browser_navigate", "page_inspect", "extract_dom", "fill_form", "workflow_automation", "screenshot_element"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1500 },
    executionBoundaries: { timeoutMs: 45000, maxPayloadBytes: 2097152 },
    inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, action: { type: "string" } } },
    outputSchema: { type: "object", required: ["navigated", "domParsed"], properties: { navigated: { type: "boolean" }, domParsed: { type: "boolean" } } }
  },
  {
    id: "system-agent",
    name: "WINDOWS COMPUTER ASSISTANT",
    role: "Windows & Local PC Operations",
    responsibility: "Direct PC control, volume, lock, screenshot, clipboard, and hardware vitals.",
    description: "Manages local computer operations, process monitoring, file organization, clipboard, and hardware telemetry.",
    capabilities: ["volume_control", "workstation_lock", "screen_capture", "clipboard_ops", "hardware_telemetry", "app_lifecycle"],
    allowedTools: ["get_hardware_telemetry", "list_processes", "launch_app", "sandboxed_file_op", "clipboard_read_write", "lock_workstation", "set_volume"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3,
    retryPolicy: { maxRetries: 2, backoffFactor: 2, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 20000, maxPayloadBytes: 524288 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, value: { type: "any" } } },
    outputSchema: { type: "object", required: ["hardwareNominal", "telemetryChecked"], properties: { hardwareNominal: { type: "boolean" }, telemetryChecked: { type: "boolean" } } }
  },
  {
    id: "android-agent",
    name: "ANDROID DEVICE AGENT",
    role: "Mobile Companion & Device Hub",
    responsibility: "Companion phone coordination, cryptographic PIN verification, notification dispatch.",
    description: "Coordinates companion phone integration, cryptographic pairing PIN verification, notification push, and mobile telemetry.",
    capabilities: ["device_pairing", "pin_verification", "push_notification", "remote_command_signing", "mobile_telemetry"],
    allowedTools: ["send_companion_notification", "poll_device_commands", "verify_pairing_pin", "read_mobile_telemetry", "sync_device_state"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 20000, maxPayloadBytes: 524288 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, deviceId: { type: "string" } } },
    outputSchema: { type: "object", required: ["paired", "deviceSync"], properties: { paired: { type: "boolean" }, deviceSync: { type: "string" } } }
  },
  {
    id: "voice-agent",
    name: "VOICE AGENT",
    role: "JARVIS Conversational Speech",
    responsibility: "Wake-word detection, speech synthesis plan formatting, Kokoro am_onyx invocation, SAPI fallback.",
    description: "Handles wake-word events, speech-to-text transcription, natural voice synthesis, and multi-lingual voice cues.",
    capabilities: ["wake_word_detection", "speech_synthesis_planning", "kokoro_tts_dispatch", "personality_mode_modulation", "sapi_fallback"],
    allowedTools: ["wake_word_listen", "transcribe_speech", "synthesize_speech", "set_voice_profile", "stop_speaking", "sapi_tts_speak"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 1,
    retryPolicy: { maxRetries: 2, backoffFactor: 1.5, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 20000, maxPayloadBytes: 1048576 },
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" }, mode: { type: "string" } } },
    outputSchema: { type: "object", required: ["spokenCadence", "persona"], properties: { spokenCadence: { type: "boolean" }, persona: { type: "string" } } }
  },
  {
    id: "vision-agent",
    name: "VISION AGENT",
    role: "Multimodal & Environmental Awareness",
    responsibility: "Screen inspection, visual frame comparison, UI bounding box extraction, credential-scrubbed OCR.",
    description: "Inspects webcam frames, analyzes screen contents, performs OCR, and compares visual UI elements.",
    capabilities: ["screenshot_analysis", "credential_scrubbed_ocr", "ui_element_bounding", "visual_frame_diff", "multimodal_reasoning"],
    allowedTools: ["capture_screenshot", "analyze_image", "extract_ocr", "inspect_ui_elements", "webcam_frame_analysis"],
    maxConcurrency: 1,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 2, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 30000, maxPayloadBytes: 5242880 },
    inputSchema: { type: "object", required: ["imageData"], properties: { imageData: { type: "object" }, ocr: { type: "boolean" } } },
    outputSchema: { type: "object", required: ["screenAnalyzed", "detectedElements"], properties: { screenAnalyzed: { type: "boolean" }, detectedElements: { type: "array" } } }
  },
  {
    id: "memory-agent",
    name: "MEMORY AGENT",
    role: "Cognitive Knowledge & Memory Vault",
    responsibility: "Long-term factual memory, conversation recall, memory consolidation, and user isolation.",
    description: "Manages conversational memory, user preferences, factual extraction, consolidation, deduplication, and expiration.",
    capabilities: ["semantic_retrieval", "memory_consolidation", "relevance_ranking", "preference_storage", "account_isolation"],
    allowedTools: ["store_memory", "recall_memory", "consolidate_memories", "purge_expired_memories", "export_vault", "isolate_account_memory"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 1,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 20000, maxPayloadBytes: 1048576 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, key: { type: "string" }, value: { type: "any" } } },
    outputSchema: { type: "object", required: ["contextRetrieved", "recordsCount"], properties: { contextRetrieved: { type: "boolean" }, recordsCount: { type: "number" } } }
  },
  {
    id: "automation-agent",
    name: "TASK AUTOMATION AGENT",
    role: "Scheduled Routines & Background Workflows",
    responsibility: "Recurring task schedules, cron pipelines, webhook triggers, and autonomous task queues.",
    description: "Schedules recurring routines, executes cron-style automation pipelines, and dispatches webhook triggers.",
    capabilities: ["routine_scheduling", "cron_pipeline_dispatch", "webhook_trigger", "background_queue_management"],
    allowedTools: ["schedule_routine", "cancel_routine", "execute_cron", "dispatch_webhook", "trigger_workflow"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 30000, maxPayloadBytes: 524288 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, schedule: { type: "string" } } },
    outputSchema: { type: "object", required: ["taskScheduled", "jobId"], properties: { taskScheduled: { type: "boolean" }, jobId: { type: "string" } } }
  },
  {
    id: "document-agent",
    name: "DOCUMENT INTELLIGENCE AGENT",
    role: "Document Analysis & Knowledge Extraction",
    responsibility: "PDF, markdown, and text document ingestion, structured summarization, and citation management.",
    description: "Parses PDF, markdown, and text documents, generates structured knowledge summaries, and indexes document text.",
    capabilities: ["document_parsing", "pdf_extraction", "knowledge_summarization", "citation_tracking", "text_indexing"],
    allowedTools: ["parse_pdf", "extract_document_text", "index_document", "query_knowledge_base", "citation_tracker"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 40000, maxPayloadBytes: 10485760 },
    inputSchema: { type: "object", required: ["document"], properties: { document: { type: "object" }, format: { type: "string" } } },
    outputSchema: { type: "object", required: ["documentsParsed", "citationsFound"], properties: { documentsParsed: { type: "number" }, citationsFound: { type: "number" } } }
  },
  {
    id: "self-improvement-agent",
    name: "SELF-EVALUATION & IMPROVEMENT AGENT",
    role: "Performance Evaluation & Skill Registry",
    responsibility: "Failure mode analysis, autonomous skill synthesis, regression testing, and quality gates.",
    description: "Analyzes task outcomes, identifies recurring failure modes, drafts reusable skills, and tests against regressions.",
    capabilities: ["failure_root_cause_analysis", "reusable_skill_synthesis", "regression_testing", "safety_audit", "metric_evaluation"],
    allowedTools: ["evaluate_task_outcome", "register_skill", "test_skill", "audit_skill_safety", "analyze_failure", "propose_patch"],
    maxConcurrency: 1,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 2, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 35000, maxPayloadBytes: 1048576 },
    inputSchema: { type: "object", required: ["targetTask"], properties: { targetTask: { type: "string" }, outcome: { type: "string" } } },
    outputSchema: { type: "object", required: ["diagnosticsReviewed", "optimizationsProposed"], properties: { diagnosticsReviewed: { type: "boolean" }, optimizationsProposed: { type: "number" } } }
  },
  {
    id: "system-monitoring-agent",
    name: "SYSTEM MONITORING AGENT",
    role: "Host Health & Headroom Watchdog",
    responsibility: "Real-time host monitoring, RAM headroom enforcement (<85%), worker lease health.",
    description: "Tracks CPU load, monitors RAM usage against the 85% headroom threshold, and checks background worker health.",
    capabilities: ["ram_headroom_tracking", "cpu_load_monitoring", "worker_lease_audit", "proactive_load_shedding", "vital_telemetry"],
    allowedTools: ["check_cpu_ram", "headroom_alert", "worker_health", "audit_event_stream", "uptime_telemetry"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 1,
    retryPolicy: { maxRetries: 2, backoffFactor: 1.5, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 15000, maxPayloadBytes: 262144 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" } } },
    outputSchema: { type: "object", required: ["headroomNominal", "ramUsagePercent"], properties: { headroomNominal: { type: "boolean" }, ramUsagePercent: { type: "number" } } }
  },
  {
    id: "planning-agent",
    name: "PLANNING AGENT",
    role: "Strategic Task Decomposition",
    responsibility: "High-level goal decomposition into sequential and parallel DAG stages with rollback barriers.",
    description: "Decomposes complex goals into sequential and parallel execution DAGs with checkpoints and rollback paths.",
    capabilities: ["dag_generation", "resource_estimation", "dependency_ordering", "bottleneck_analysis", "concurrency_bounding"],
    allowedTools: ["create_execution_plan", "estimate_resources", "reorder_tasks", "evaluate_dependencies", "build_dag"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 1,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 500 },
    executionBoundaries: { timeoutMs: 30000, maxPayloadBytes: 1048576 },
    inputSchema: { type: "object", required: ["goal"], properties: { goal: { type: "string" }, maxStages: { type: "number" } } },
    outputSchema: { type: "object", required: ["planCreated", "stages"], properties: { planCreated: { type: "boolean" }, stages: { type: "array" } } }
  },
  {
    id: "integration-agent",
    name: "INTEGRATION MANAGEMENT AGENT",
    role: "Ecosystem Bridges & MCP Gateways",
    responsibility: "MCP tool discovery, Hermes Agent bridge, external API gateways, and protocol health.",
    description: "Manages connectivity to external gateways, MCP tools, Strata, Hermes, and Google Workspace integrations.",
    capabilities: ["mcp_server_discovery", "hermes_bridge_health", "gateway_routing", "credential_isolation", "protocol_handshake"],
    allowedTools: ["check_mcp_servers", "verify_bridge_health", "openrouter_proxy_status", "rea_gateway_query", "strata_status"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2,
    retryPolicy: { maxRetries: 3, backoffFactor: 2, initialDelayMs: 1000 },
    executionBoundaries: { timeoutMs: 30000, maxPayloadBytes: 1048576 },
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, bridge: { type: "string" } } },
    outputSchema: { type: "object", required: ["bridgesActive", "mcpServersReady"], properties: { bridgesActive: { type: "number" }, mcpServersReady: { type: "boolean" } } }
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
