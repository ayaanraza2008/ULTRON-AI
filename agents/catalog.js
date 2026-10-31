/**
 * ULTRON AI — Specialized 12-Agent System Catalog
 *
 * Defines the roles, capabilities, allowlisted tools, and boundaries
 * for all 12 specialized autonomous engineering agents.
 */

export const ULTRON_AGENT_CATALOG = [
  {
    id: "ultron-core",
    name: "ULTRON CORE",
    role: "Central Intelligence & Orchestration",
    description: "Master coordinator that understands overall context, arbitrates agent delegation, and enforces global policies.",
    allowedTools: ["delegate_task", "query_memory", "get_system_status", "emergency_stop", "broadcast_notification"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 1
  },
  {
    id: "research-agent",
    name: "RESEARCH AGENT",
    role: "Information Discovery & Fact Verification",
    description: "Performs multi-source web investigations, reads documents, compares sources, and generates factual synthesis.",
    allowedTools: ["tavily_search", "duckduckgo_search", "extract_page_content", "read_document", "verify_facts"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "coding-agent",
    name: "CODING AGENT",
    role: "Software Engineering & Code Analysis",
    description: "Performs repository analysis, code generation, refactoring, bug fixing, and test authoring within isolated sandboxes.",
    allowedTools: ["read_source_file", "write_sandbox_code", "execute_sandbox_tests", "git_status", "prepare_diff"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 2
  },
  {
    id: "security-agent",
    name: "SECURITY AGENT",
    role: "Cybersecurity & Policy Auditing",
    description: "Monitors tool invocations, scans code for CVEs/secrets, audits network egress, and enforces permission gates.",
    allowedTools: ["audit_log_inspection", "scan_secrets", "verify_dns_safety", "check_permissions", "revoke_session"],
    maxConcurrency: 4,
    autonomyLevelThreshold: 0
  },
  {
    id: "system-agent",
    name: "SYSTEM AGENT",
    role: "Windows & PC Operations",
    description: "Manages local computer operations, process monitoring, file organization, clipboard, and hardware telemetry.",
    allowedTools: ["get_hardware_telemetry", "list_processes", "launch_app", "sandboxed_file_op", "clipboard_read_write"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3
  },
  {
    id: "memory-agent",
    name: "MEMORY AGENT",
    role: "Cognitive Knowledge & Memory Vault",
    description: "Manages conversational memory, user preferences, factual extraction, consolidation, deduplication, and expiration.",
    allowedTools: ["store_memory", "recall_memory", "consolidate_memories", "purge_expired_memories", "export_vault"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 1
  },
  {
    id: "voice-agent",
    name: "VOICE AGENT",
    role: "JARVIS Conversational Speech",
    description: "Handles wake-word events, speech-to-text transcription, natural voice synthesis, and multi-lingual voice cues.",
    allowedTools: ["wake_word_listen", "transcribe_speech", "synthesize_speech", "set_voice_profile", "stop_speaking"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 1
  },
  {
    id: "vision-agent",
    name: "VISION AGENT",
    role: "Multimodal & Environmental Awareness",
    description: "Inspects webcam frames, analyzes screen contents, performs OCR, and compares visual UI elements.",
    allowedTools: ["capture_screenshot", "analyze_image", "extract_ocr", "inspect_ui_elements", "webcam_frame_analysis"],
    maxConcurrency: 1, // Bounded to 1 to protect 8GB RAM headroom
    autonomyLevelThreshold: 2
  },
  {
    id: "automation-agent",
    name: "AUTOMATION AGENT",
    role: "Application & Browser Workflows",
    description: "Automates multi-step browser tasks, navigation, form filling, and background business routines.",
    allowedTools: ["browser_navigate", "browser_extract", "browser_fill_form", "schedule_routine", "cancel_routine"],
    maxConcurrency: 2,
    autonomyLevelThreshold: 3
  },
  {
    id: "planning-agent",
    name: "PLANNING AGENT",
    role: "Strategic Task Decomposition",
    description: "Decomposes complex goals into sequential and parallel execution DAGs with checkpoints and rollback paths.",
    allowedTools: ["create_execution_plan", "estimate_resources", "reorder_tasks", "evaluate_dependencies"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 1
  },
  {
    id: "execution-agent",
    name: "EXECUTION AGENT",
    role: "Approved Task Runner & Recovery",
    description: "Dispatches approved execution DAGs, tracks progress checkpoints, handles retries, and recovers from failures.",
    allowedTools: ["execute_step", "record_checkpoint", "resume_checkpoint", "retry_step", "rollback_step"],
    maxConcurrency: 3,
    autonomyLevelThreshold: 2
  },
  {
    id: "self-improvement-agent",
    name: "SELF-IMPROVEMENT AGENT",
    role: "Performance Evaluation & Skill Registry",
    description: "Analyzes task outcomes, identifies recurring failure modes, drafts reusable skills, and tests against regressions.",
    allowedTools: ["evaluate_task_outcome", "register_skill", "test_skill", "audit_skill_safety", "list_improvements"],
    maxConcurrency: 1,
    autonomyLevelThreshold: 2
  }
];

export function getAgentById(agentId) {
  return ULTRON_AGENT_CATALOG.find(agent => agent.id === agentId) || null;
}

export function listAvailableAgents(currentAutonomyLevel = 2) {
  return ULTRON_AGENT_CATALOG.filter(agent => currentAutonomyLevel >= agent.autonomyLevelThreshold);
}
