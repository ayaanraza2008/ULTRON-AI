/**
 * ULTRON AI — JARVIS Capability Benchmark Engine
 *
 * Implements the 14-Category Weighted Scoring Model defined in
 * Section 24 of the Ultimate Master Upgrade Directive:
 *
 * 1. Core AI intelligence and reasoning (10%)
 * 2. Context, memory and personalization (8%)
 * 3. Autonomous task execution (12%)
 * 4. Voice and conversational intelligence (8%)
 * 5. Computer and OS assistance (10%)
 * 6. Research and information retrieval (6%)
 * 7. Coding and software engineering (7%)
 * 8. Vision and multimodal intelligence (6%)
 * 9. Agent orchestration (6%)
 * 10. Creative media workflows (5%)
 * 11. Device and integration ecosystem (5%)
 * 12. Automation and scheduling (5%)
 * 13. Security and permissions (7%)
 * 14. Reliability and self-monitoring (5%)
 * TOTAL: 100%
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const JARVIS_BENCHMARK_SPEC = [
  {
    id: "core_intelligence",
    name: "Core AI intelligence and reasoning",
    weight: 10,
    subsystems: ["core/brain-router.js", "task-router.js", "integrations/dsh-god/provider-registry.js"],
    acceptanceCriteria: [
      "Multi-provider chain traversal across Groq, Gemini Flash, OpenRouter, and Ollama",
      "Dynamic task complexity classification (Low, Medium, High, Vision)",
      "Circuit breaker with automatic failure cooldown",
      "Confidence estimation and hallucination prevention scoring",
      "76-provider universal gateway integration (DSH-GOD) with virtual combos"
    ],
    testFiles: [
      "tests/brain-router.test.js",
      "tests/task-router.test.js",
      "tests/dsh-brain-integration.test.js",
      "tests/dsh-combo-router.test.js"
    ],
    knownLimitations: "Cloud model latency is network-dependent; local CPU Ollama/DSH gateway provides offline continuity without cloud dependency."
  },
  {
    id: "context_memory",
    name: "Context, memory and personalization",
    weight: 8,
    subsystems: ["cognitive-memory.js", "intelligence/hei/emotional-memory-manager.js"],
    acceptanceCriteria: [
      "Cognitive memory vault with semantic relevance retrieval",
      "Document provenance tracking at chunk, page, and offset level",
      "Strict two-account Row-Level Security (RLS) isolation on Supabase",
      "Privacy-first emotional memory manager with zero permanent psychiatric profiling",
      "One-click memory deletion and active conversation context reset"
    ],
    testFiles: [
      "tests/cognitive-memory.test.js",
      "tests/cognitive-memory-agent-integration.test.js",
      "tests/auth-isolation-unit.test.js"
    ],
    knownLimitations: "Local vector indexing runs in-memory; Supabase cloud vector sync requires active database connection."
  },
  {
    id: "autonomous_execution",
    name: "Autonomous task execution",
    weight: 12,
    subsystems: ["agents/orchestrator.js", "worker.js", "system/remote-task-orchestrator.js"],
    acceptanceCriteria: [
      "11-stage autonomous task lifecycle (Goal -> Decompose -> Plan -> Select Tools -> Check Permissions -> Execute -> Observe -> Verify -> Report -> Persist)",
      "Durable background worker with atomic attempt fences and lease renewals",
      "30-second task idempotency token deduplication",
      "Multi-step progress reporting with rollback awareness on failure",
      "Autonomous research-to-report pipeline with verifiable citations"
    ],
    testFiles: [
      "tests/autonomous-task-lifecycle.test.js",
      "tests/agents-orchestrator.test.js",
      "tests/remote-task-orchestrator.test.js"
    ],
    knownLimitations: "High-risk destructive operations require operator approval and fail closed without explicit consent."
  },
  {
    id: "voice_conversational",
    name: "Voice and conversational intelligence",
    weight: 8,
    subsystems: ["voice/kokoro-engine.js", "voice/voice-engine.js", "voice/wake-word.js", "voice/snap-detector.js", "voice/voice-activation-system.js"],
    acceptanceCriteria: [
      "Kokoro-82M ONNX speech synthesis with permanent default voice 'am_onyx'",
      "Subprocess interruption latency benchmarked < 50ms (measured at ~2.2ms)",
      "Dual hands-free activation via 'ULTRON' wake word and acoustic finger-snap transient detection (2.5-7kHz bandpass)",
      "Multilingual phonetic mapping for English, Hindi, and Roman Hinglish",
      "Dynamic Kokoro speed (0.85x to 1.05x) and 7+ acoustic personality modes"
    ],
    testFiles: [
      "tests/kokoro-voice.test.js",
      "tests/wake-word.test.js",
      "tests/snap-detector.test.js",
      "tests/voice-activation-system.test.js",
      "tests/voice-activation-e2e.test.js"
    ],
    knownLimitations: "Kokoro ONNX runs on CPU (AMD Ryzen 7 5700U RTF ~0.35x); Windows SAPI daemon provides zero-latency offline fallback."
  },
  {
    id: "computer_os_assistance",
    name: "Computer and OS assistance",
    weight: 10,
    subsystems: ["system/windows-automation.js", "system/computer-control.js", "system/windows-desktop-agent.js"],
    acceptanceCriteria: [
      "Desktop workstation lock/unlock signaling via user32 APIs",
      "Hardware telemetry inspection via Windows CIM/WMI (battery, CPU, RAM, storage, volume)",
      "Permission-gated application launching and termination via strict allowlist",
      "Intelligent file search, directory traversal, and non-destructive folder organizer",
      "Full desktop screen capture with sensitive credential scrubbing"
    ],
    testFiles: [
      "tests/windows-automation.test.js",
      "tests/system-control-agent.test.js",
      "tests/windows-desktop-agent.test.js"
    ],
    knownLimitations: "Protected Windows system directories (C:\\Windows, C:\\Program Files) fail closed to prevent accidental corruption."
  },
  {
    id: "research_retrieval",
    name: "Research and information retrieval",
    weight: 6,
    subsystems: ["knowledge/knowledge-engine.js", "integrations/geo-sleuth.js", "system/geo-intel.js"],
    acceptanceCriteria: [
      "Multi-engine web research with Tavily and DuckDuckGo fallback",
      "16-domain knowledge engine with fact vs. inference classification",
      "Automated semantic contradiction detection on knowledge indexing",
      "Exact source citation extraction, publication date attribution, and SSRF-safe HTTP fetching"
    ],
    testFiles: [
      "tests/geo-sleuth.test.js",
      "tests/knowledge-vault.test.js"
    ],
    knownLimitations: "Paywalled web sources return sanitized snippets; live network search requires active connection."
  },
  {
    id: "coding_software_engineering",
    name: "Coding and software engineering",
    weight: 7,
    subsystems: ["agents/catalog.js", "tools/sandbox/coding-sandbox.js"],
    acceptanceCriteria: [
      "Inspect -> Plan -> Modify -> Test -> Review -> Verify workflow",
      "Isolated code execution sandbox capped at 256MB RAM with 10s SIGKILL timeout",
      "Syntax integrity verification across 223+ repository source files",
      "Version control checkpoints, change diff inspection, and rollback safety"
    ],
    testFiles: [
      "tests/advanced-intelligence.test.js",
      "tests/agent-matrix-18.test.js"
    ],
    knownLimitations: "Sandbox enforces unprivileged child processes; OS-kernel modifications are strictly prohibited."
  },
  {
    id: "vision_multimodal",
    name: "Vision and multimodal intelligence",
    weight: 6,
    subsystems: [
      "vision/vision-engine.js",
      "vision/screen-observer.js",
      "vision/gesture-recognizer.js",
      "vision/ultron-vision.js",
      "vision/ultron-eyes-manager.js",
      "public/ultron-eyes.js"
    ],
    acceptanceCriteria: [
      "Multimodal screenshot and image analysis with automated credential scrubbers (JWT, API keys)",
      "Multi-monitor screen observer daemon with visual change detection",
      "Document parsing and text extraction for PDF and DOCX files",
      "Web camera pinch and two-hand distance gesture recognition for holographic core scaling",
      "ULTRON EYES native live camera sensory subsystem with default camera preselection, device switching, and bounded sampling",
      "Human-like visual perception pipeline (object classification & 2D localization, multi-frame tracking, scene understanding, privacy-preserving activity perception, OCR, change detection, and spatial approximations)",
      "Visual reasoning Q&A engine connected to ULTRON CORE, separating direct observations from model inferences with uncertainty scoring and consequential action approval gates",
      "Session-based visual memory with explicit purge controls and zero permanent camera archiving without authorization"
    ],
    testFiles: [
      "tests/voice-vision.test.js",
      "tests/screen-observer.test.js",
      "tests/gesture-recognizer.test.js",
      "tests/ultron-vision.test.js",
      "tests/ultron-eyes.test.js",
      "tests/ultron-eyes-routes.test.js"
    ],
    knownLimitations: "Live camera capture requires explicit user consent and platform permission; runs with CPU-bounded 1-5 FPS adaptive sampling to protect 8GB RAM."
  },
  {
    id: "agent_orchestration",
    name: "Agent orchestration",
    weight: 6,
    subsystems: ["agents/orchestrator.js", "agents/catalog.js"],
    acceptanceCriteria: [
      "18 specialized operational agents with explicit schemas and responsibilities",
      "Directed Acyclic Graph (DAG) topological sorting with Kahn's algorithm",
      "Upfront DAG cycle detection preventing deadlock loops",
      "Dead-Letter Queue (DLQ) with 6-class root-cause classification and retry caps"
    ],
    testFiles: [
      "tests/agent-matrix-18.test.js",
      "tests/agents-orchestrator.test.js"
    ],
    knownLimitations: "Sub-agent branch concurrency is bounded to 4 parallel processes to preserve 8 GB host RAM headroom."
  },
  {
    id: "creative_media_workflows",
    name: "Creative media workflows",
    weight: 5,
    subsystems: ["media/video-editing-engine.js", "media/image-studio-engine.js", "media/autonomous-production-orchestrator.js"],
    acceptanceCriteria: [
      "Autonomous video editor with 6 cinematic presets (Cinematic, Dark Mystery, Action, Reels 9:16, Gaming, Travel)",
      "Rhythmic beat grid snapping, color grading filter curves, and SRT/WebVTT subtitle generation",
      "High-impact SVG thumbnail studio with glowing borders and color LUT presets",
      "12-step autonomous production pipeline from natural prompt to rendered export"
    ],
    testFiles: [
      "tests/video-editing-engine.test.js",
      "tests/image-studio-engine.test.js",
      "tests/media-discovery-engine.test.js",
      "tests/autonomous-production.test.js"
    ],
    knownLimitations: "FFmpeg rendering is bounded to 4 threads to prevent CPU overheating on AMD Ryzen 7 5700U."
  },
  {
    id: "device_integration_ecosystem",
    name: "Device and integration ecosystem",
    weight: 5,
    subsystems: ["telephony/telephony-gateway.js", "integrations/multi-device-manager.js", "integrations/android-bridge.js"],
    acceptanceCriteria: [
      "Carrier inbound voice webhook handling with G.711 μ-law bidirectional audio transcoding",
      "Caller ID allowlisting and 4-digit DTMF security PIN challenge with lockout",
      "Multi-device fleet synchronization (Primary PC + 3 Android phones) with simultaneous screen unlock",
      "Fleet-wide synchronized media playback launch across connected endpoints",
      "Android ADB automation bridge with companion WebSocket fallback"
    ],
    testFiles: [
      "tests/telephony-gateway.test.js",
      "tests/multi-device-manager.test.js",
      "tests/android-bridge.test.js",
      "tests/telephony-multidevice-e2e.test.js"
    ],
    knownLimitations: "Android ADB bridge requires USB debugging or pairing PIN; physical devices must be on the authorized local subnet."
  },
  {
    id: "automation_scheduling",
    name: "Automation and scheduling",
    weight: 5,
    subsystems: ["integrations/productivity-services.js", "system/proactive-daemon.js", "worker.js"],
    acceptanceCriteria: [
      "Configurable scheduled tasks and recurring daily/weekly routines",
      "Proactive system monitoring daemon with vitals threshold alerts (RAM > 85%, battery < 20%)",
      "Non-bypassable audit logging for background automation tasks",
      "Event-triggered execution with automatic pause, resume, and timeout limits"
    ],
    testFiles: [
      "tests/productivity-services.test.js",
      "tests/proactive-daemon.test.js",
      "tests/worker.test.js"
    ],
    knownLimitations: "Background scheduled tasks depend on continuous worker polling or system cron triggers."
  },
  {
    id: "security_permissions",
    name: "Security and permissions",
    weight: 7,
    subsystems: [
      "network-safety.js",
      "security/cyber-intel.js",
      "security/ultron-guardian.js",
      "security/target-authorization-gateway.js",
      "security/code-shield.js",
      "security/cyber-web.js",
      "security/cyber-ai-redteam.js",
      "security/cyber-recon.js",
      "security/cyber-scanner.js",
      "security/cyber-incident.js",
      "security/cyber-reporter.js",
      "security/cyber-core.js",
      "public/cyber-dashboard.js",
      "server.js"
    ],
    acceptanceCriteria: [
      "Supabase JWT session validation and owner UUID gate on all JARVIS control routes",
      "Strict target scope enforcement restricting defensive security scans to localhost/approved targets",
      "DNS-pinned network safety fetch preventing SSRF and DNS rebinding attacks",
      "HMAC-SHA256 signature verification on remote companion commands with replay defense",
      "Zero plain secrets in repository code, logs, or git revision history",
      "Target Authorization Gateway requiring proof of ownership and emergency stop cessation controls",
      "13-specialist cybersecurity agent network coordinating Recon, Scanning, Web, Code SAST, AI Red-Team, and Incident Response",
      "Code Shield static security testing (SAST) detecting CWE-78, CWE-89, CWE-79, CWE-22, CWE-918, CWE-798, and CycloneDX SBOM generation",
      "Web & API security assessment engine auditing CSP, HSTS, CORS, cookie flags, and JWT algorithm vulnerabilities",
      "AI Red-Team security suite validating prompt injection resistance, tool privilege barriers, and canary secret protection"
    ],
    testFiles: [
      "tests/network-safety.test.js",
      "tests/cyber-intel.test.js",
      "tests/auth-isolation-unit.test.js",
      "tests/server-health.test.js",
      "tests/target-authorization.test.js",
      "tests/code-shield.test.js",
      "tests/cyber-web.test.js",
      "tests/cyber-ai-redteam.test.js",
      "tests/cyber-core.test.js",
      "tests/cyber-routes.test.js"
    ],
    knownLimitations: "Public cloud egress blocked in OFFLINE mode; private IP ranges (RFC 1918/4193) strictly barred from outbound fetching; scans restricted to authorized scopes."
  },
  {
    id: "reliability_self_monitoring",
    name: "Reliability and self-monitoring",
    weight: 5,
    subsystems: ["system/connection-controller.js", "system/remote-task-orchestrator.js", "runtime-readiness.js"],
    acceptanceCriteria: [
      "True offline + online connection controller supporting 3 operational modes (ONLINE, OFFLINE, HYBRID)",
      "Bounded offline sync queue (up to 100 items) flushing automatically upon reconnection",
      "Owner-authorized emergency stop cancels active ULTRON tasks and blocks new work until reset",
      "Graceful server shutdown with SIGTERM signal handling and clean socket draining",
      "Self-improvement failure analysis ledger with protected core file boundaries"
    ],
    testFiles: [
      "tests/offline-online-modes.test.js",
      "tests/remote-task-orchestrator.test.js",
      "tests/runtime-readiness.test.js",
      "tests/server-shutdown.test.js"
    ],
    knownLimitations: "Emergency stop is scoped to ULTRON software tasks and does not claim control over external hardware."
  }
];

export class JarvisCapabilityBenchmark {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || REPO_ROOT;
  }

  /**
   * Evaluates the repository against the 14-category JARVIS capability benchmark.
   */
  async evaluate() {
    const results = [];
    let totalWeightedInventoryCoverage = 0;
    let maxWeight = 0;

    for (const spec of JARVIS_BENCHMARK_SPEC) {
      maxWeight += spec.weight;
      const subsystems = spec.subsystems.map(filePath => ({
        path: filePath,
        exists: fs.existsSync(path.join(this.repoRoot, filePath))
      }));
      const testFiles = spec.testFiles.map(filePath => ({
        path: filePath,
        exists: fs.existsSync(path.join(this.repoRoot, filePath))
      }));
      const evidence = [...subsystems, ...testFiles];
      const present = evidence.filter(item => item.exists).length;
      const total = evidence.length;
      const inventoryCoveragePercent = total ? Number((present / total * 100).toFixed(1)) : 0;
      const status = present === total && total > 0
        ? "SOURCE_AND_TEST_PATHS_PRESENT"
        : present > 0
          ? "PARTIAL_SOURCE_TEST_INVENTORY"
          : "NO_SOURCE_TEST_INVENTORY";
      const weightedInventoryContribution = Number((inventoryCoveragePercent / 100 * spec.weight).toFixed(2));
      totalWeightedInventoryCoverage += weightedInventoryContribution;
      results.push({
        id: spec.id,
        name: spec.name,
        weight: spec.weight,
        inventoryCoveragePercent,
        weightedInventoryContribution,
        evidencePathsPresent: present,
        evidencePathsTotal: total,
        status,
        acceptanceCriteriaStatus: "NOT_EVALUATED",
        subsystems,
        testFiles,
        acceptanceCriteria: spec.acceptanceCriteria,
        knownLimitations: spec.knownLimitations
      });
    }

    return {
      timestamp: new Date().toISOString(),
      benchmarkVersion: "2.0.0-inventory-only",
      totalInventoryCoveragePercent: Math.min(100, Number(totalWeightedInventoryCoverage.toFixed(1))),
      maxPossibleScore: maxWeight,
      overallStatus: results.every(item => item.status === "SOURCE_AND_TEST_PATHS_PRESENT")
        ? "SOURCE_TEST_INVENTORY_COMPLETE"
        : "SOURCE_TEST_INVENTORY_INCOMPLETE",
      runtimeVerificationStatus: "NOT_EVALUATED",
      liveIntegrationStatus: "NOT_EVALUATED",
      categoriesCount: results.length,
      categories: results
    };
  }

  /**
   * Generates a clean Markdown scorecard report.
   */  generateMarkdownReport(evaluation) {
    const lines = [
      `# ULTRON AI — JARVIS CAPABILITY BENCHMARK SCORECARD`,
      `**Evaluated At:** ${evaluation.timestamp}  `,
      `**Benchmark Version:** ${evaluation.benchmarkVersion}  `,
      `**Source/Test Inventory Coverage:** **${evaluation.totalInventoryCoveragePercent}% / 100%**  `,
      `**Status:** **${evaluation.overallStatus}**  `,
      ``,
      `---`,
      ``,
      `## 1. WEIGHTED CATEGORY SCORECARD`,
      ``,
      `| No. | Capability Category | Weight | Inventory (%) | Weighted Inventory (%) | Status | Test Suites |`,
      `| :--- | :--- | :---: | :---: | :---: | :---: | :--- |`
    ];

    evaluation.categories.forEach((cat, idx) => {
      const tests = cat.testFiles.map(t => path.basename(t.path)).join(", ");
      lines.push(
        `| ${idx + 1} | **${cat.name}** | ${cat.weight}% | ${cat.inventoryCoveragePercent}% | ${cat.weightedInventoryContribution}% | \`${cat.status}\` | ${tests} |`
      );
    });

    lines.push(``);
    lines.push(`**TOTAL SOURCE/TEST INVENTORY COVERAGE:** **${evaluation.totalInventoryCoveragePercent}%** (path presence only; not capability completion)`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 2. CATEGORY ACCEPTANCE CRITERIA & EVIDENCE`);
    lines.push(``);

    evaluation.categories.forEach((cat, idx) => {
      lines.push(`### ${idx + 1}. ${cat.name} (${cat.weight}% Weight — Inventory Coverage: ${cat.inventoryCoveragePercent}%)`);
      lines.push(`- **Status:** \`${cat.status}\` | **Weighted Contribution:** ${cat.weightedInventoryContribution}%`);
      lines.push(`- **Subsystems:** ${cat.subsystems.map(s => `\`${s.path}\``).join(", ")}`);
      lines.push(`- **Test Files:** ${cat.testFiles.map(t => `\`${t.path}\``).join(", ")}`);
      lines.push(`- **Acceptance Criteria:** NOT EVALUATED by file-presence inventory.`);
      cat.acceptanceCriteria.forEach(ac => lines.push(`  - ${ac}`));
      lines.push(`- **Known Real-World Limitations:** ${cat.knownLimitations}`);
      lines.push(``);
    });

    return lines.join("\n");
  }
}
