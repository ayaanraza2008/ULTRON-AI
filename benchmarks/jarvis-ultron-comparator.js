/**
 * ULTRON AI — JARVIS + ULTRON Capability Comparator
 *
 * Permanent comparison module implementing the 8-Column Matrix across
 * the 14 Weighted Capability Categories defined in the Continuous Evolution Directive:
 *
 * COLUMN A — IRON MAN JARVIS REFERENCE
 * COLUMN B — MARVEL ULTRON REFERENCE
 * COLUMN C — CURRENT ULTRON IMPLEMENTATION
 * COLUMN D — GAP ANALYSIS
 * COLUMN E — REQUIRED UPGRADE
 * COLUMN F — IMPLEMENTATION STATUS
 * COLUMN G — TEST EVIDENCE
 * COLUMN H — VERIFIED COMPLETION SCORE
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const COMPARATOR_CATEGORIES = [
  {
    id: "ai_intelligence",
    name: "AI intelligence and reasoning",
    weight: 10,
    jarvisReference: "Context-aware personal assistant reasoning with natural conversational wit and contextual deduction.",
    ultronReference: "Vast distributed neural cognition assimilating multi-source data and global network models.",
    currentUltron: "Dynamic multi-provider brain traversal (Groq, Gemini Flash, OpenRouter, Ollama) + 76-provider DSH-GOD gateway with virtual combos.",
    gapAnalysis: "Movie sentience is fictional; real-world system achieves instant model routing with confidence scoring and circuit breaking.",
    requiredUpgrade: "Multi-wire provider abstraction, latency/cost routing, and fallback chains with strict hallucination checks.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["core/brain-router.js", "core/ultron-core.js", "task-router.js", "integrations/dsh-god/provider-registry.js"],
    testEvidence: ["tests/brain-router.test.js", "tests/ultron-core.test.js", "tests/dsh-brain-integration.test.js", "tests/dsh-combo-router.test.js"],
    knownLimitations: "Cloud LLM latency bounded by network; local CPU Ollama/DSH gateway provides offline fallback."
  },
  {
    id: "autonomy_execution",
    name: "Autonomy and task execution",
    weight: 12,
    jarvisReference: "Autonomous personal-computing workflows, diagnostics, and multi-step task pipelines.",
    ultronReference: "Full unassisted global initiative, multi-threaded objective decomposition, and resilient execution.",
    currentUltron: "11-stage autonomous task lifecycle (Goal -> Decompose -> Plan -> Tool -> Permission -> Execute -> Observe -> Verify -> Report -> Persist) with durable worker.",
    gapAnalysis: "Physical fabrication is outside the personal AI software scope; task decomposition and bounded software execution remain in scope.",
    requiredUpgrade: "Durable background Supabase worker with atomic attempt fences, lease renewals, and 30s idempotency deduplication.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["autonomy/ultron-autonomy.js", "agents/orchestrator.js", "worker.js", "system/remote-task-orchestrator.js"],
    testEvidence: ["tests/ultron-autonomy.test.js", "tests/autonomous-task-lifecycle.test.js", "tests/agents-orchestrator.test.js", "tests/remote-task-orchestrator.test.js"],
    knownLimitations: "High-risk destructive operations require operator approval and fail closed without explicit consent."
  },
  {
    id: "voice_communication",
    name: "Voice and communication",
    weight: 8,
    jarvisReference: "Always-on, smooth, British-accented natural voice, hands-free wake activation, and conversational empathy.",
    ultronReference: "Authoritative, resonant, commanding baritone presence with rapid multi-party vocal synthesis.",
    currentUltron: "Kokoro-82M ONNX 'am_onyx' default (0.95x pace, 200 Hz chest EQ, 2.2ms interrupt latency), dual wake word ('ULTRON') + snap detector, 51-emotion HEI engine.",
    gapAnalysis: "Fictional emotional consciousness replaced by empirical multi-signal 51-emotion heuristic analyzer with Hindi/Hinglish phonetics.",
    requiredUpgrade: "Web Audio bandpass snap transient detector (2.5-7kHz) + Kokoro speed/pitch modulation + Energy Core emotional feedback.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["intelligence/human-interface.js", "voice/kokoro-engine.js", "voice/voice-engine.js", "voice/wake-word.js", "voice/snap-detector.js", "intelligence/hei/emotion-taxonomy.js"],
    testEvidence: ["tests/human-interface.test.js", "tests/kokoro-voice.test.js", "tests/wake-word.test.js", "tests/snap-detector.test.js", "tests/voice-activation-system.test.js", "tests/emotional-intelligence-e2e.test.js"],
    knownLimitations: "Kokoro runs on CPU (AMD Ryzen 7 5700U RTF ~0.35x); Windows SAPI daemon serves as zero-latency offline fallback."
  },
  {
    id: "computer_control",
    name: "Computer control",
    weight: 9,
    jarvisReference: "Complete control over Tony Stark's personal computers, holographic tables, laboratory terminals, and security.",
    ultronReference: "Digital mastery over servers, network ports, computing infrastructure, and automation scripts.",
    currentUltron: "Windows desktop agent (LockWorkStation, unlock signaling), CIM hardware vitals, allowlisted application management, intelligent file organizer with atomic backups.",
    gapAnalysis: "Operating system protections prevent unauthorized kernel modifications; userland automation is fully implemented.",
    requiredUpgrade: "Windows CIM/WMI telemetry query, allowlisted process launcher, screen capture with credential scrubbers, and safe folder organizer.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["system/windows-automation.js", "system/computer-control.js", "system/windows-desktop-agent.js", "system/system-control-agent.js"],
    testEvidence: ["tests/windows-automation.test.js", "tests/system-control-agent.test.js", "tests/windows-desktop-agent.test.js"],
    knownLimitations: "Protected Windows system directories (C:\\Windows, C:\\Program Files) fail closed to prevent accidental corruption."
  },
  {
    id: "vision_perception",
    name: "Vision and perception",
    weight: 6,
    jarvisReference: "HUD telemetry overlay, blueprint scanning, computer vision object tracking, and gesture recognition.",
    ultronReference: "Multi-camera surveillance feeds analysis and visual battlefield tracking.",
    currentUltron: "Multimodal screenshot analysis, credential-scrubbed OCR (JWT/keys redacted), screen observer daemon, web camera pinch and distance gesture scaling.",
    gapAnalysis: "True 3D holographic projection replaced by WebGL 3D Arc Reactor canvas; camera vision tracking operates smoothly on client.",
    requiredUpgrade: "MediaPipe-inspired client-side pinch/palm Euclidean distance calculation + multi-monitor screenshot capture.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["vision/ultron-vision.js", "vision/vision-engine.js", "vision/screen-observer.js", "vision/gesture-recognizer.js"],
    testEvidence: ["tests/ultron-vision.test.js", "tests/voice-vision.test.js", "tests/screen-observer.test.js", "tests/gesture-recognizer.test.js"],
    knownLimitations: "Optical gesture recognition requires user-granted webcam permissions; runs purely on client browser."
  },
  {
    id: "research_knowledge",
    name: "Research and knowledge",
    weight: 6,
    jarvisReference: "Instant information retrieval, technical documentation lookup, historical Stark archive queries.",
    ultronReference: "Vast internet assimilation, rapid multi-source information synthesis, and contradictory data reconciliation.",
    currentUltron: "Multi-engine web research (Tavily + DuckDuckGo fallback), 16-domain knowledge engine, semantic contradiction detection, and citation linking.",
    gapAnalysis: "Sci-fi instantaneous total-internet ingestion replaced by targeted multi-engine research with verifiable citations.",
    requiredUpgrade: "SSRF-safe DNS-pinned HTTP fetcher, 16-domain knowledge indexing, FACT/INFERENCE classification, and semantic conflict quarantining.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["knowledge/knowledge-engine.js", "integrations/geo-sleuth.js", "system/geo-intel.js"],
    testEvidence: ["tests/geo-sleuth.test.js", "tests/knowledge-vault.test.js"],
    knownLimitations: "Paywalled web sources return public summaries; live network research requires active connection."
  },
  {
    id: "coding_engineering",
    name: "Coding and engineering",
    weight: 7,
    jarvisReference: "Flight code simulation, algorithm optimization, software debugging, and Mark armor firmware updates.",
    ultronReference: "Autonomous software refactoring, rapid code synthesis, and automated system architectural evolution.",
    currentUltron: "Safe coding workflow: INSPECT -> PLAN -> MODIFY -> TEST -> REVIEW -> VERIFY, 256MB RAM / 10s sandbox, 226-file syntax runner, Git checkpointing.",
    gapAnalysis: "Uncontrolled self-recompilation restricted by safety policies to prevent security policy bypasses.",
    requiredUpgrade: "Child-process memory isolation, automated test suite regression execution, and git branch diff verification.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["genesis/genesis-engine.js", "forge/forge-engine.js", "agents/catalog.js", "tools/sandbox/coding-sandbox.js", "self-improvement/engine.js"],
    testEvidence: ["tests/genesis-engine.test.js", "tests/forge-engine.test.js", "tests/advanced-intelligence.test.js", "tests/agent-matrix-18.test.js"],
    knownLimitations: "Sandbox enforces unprivileged child processes; OS-kernel modifications are strictly prohibited."
  },
  {
    id: "agents_orchestration",
    name: "Agents and orchestration",
    weight: 7,
    jarvisReference: "Coordination of personal assistant subsystems, tools, background workers, and connected software clients.",
    ultronReference: "Decentralized coordination of specialized software agents operating in concert.",
    currentUltron: "18 specialized operational agents (`chief-of-staff`, `researcher`, `coder`, `debugger`, `devops`, etc.) with Kahn DAG sorting and DLQ.",
    gapAnalysis: "Specialized autonomous software agents execute permissioned parallel DAG tasks.",
    requiredUpgrade: "Kahn topological dependency sorting, upfront cycle detection (`DAG_CYCLE_DETECTED`), and 6-class DLQ retry classification.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["nexus/nexus-orchestrator.js", "agents/orchestrator.js", "agents/catalog.js"],
    testEvidence: ["tests/nexus-orchestrator.test.js", "tests/agent-matrix-18.test.js", "tests/agents-orchestrator.test.js"],
    knownLimitations: "Sub-agent branch concurrency is bounded to 4 parallel processes to preserve 8 GB host RAM headroom."
  },
  {
    id: "memory_learning",
    name: "Memory and learning",
    weight: 7,
    jarvisReference: "Persistent user preferences, Tony Stark's personal schedule, laboratory project history, and contextual memory.",
    ultronReference: "Evolving knowledge base integrating strategic encounters, failure analysis, and operational memory.",
    currentUltron: "Cognitive Memory Vault with document provenance, Supabase RLS user isolation, EmotionalMemoryManager with zero psychiatric profiling.",
    gapAnalysis: "Fictional eternal consciousness replaced by cryptographically partitioned, privacy-first durable database storage.",
    requiredUpgrade: "Chunk-level provenance tracking, two-account RLS isolation, user-controlled deletion (`POST /api/jarvis/hei/delete-memory`).",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["cognitive-memory.js", "intelligence/hei/emotional-memory-manager.js"],
    testEvidence: ["tests/cognitive-memory.test.js", "tests/cognitive-memory-agent-integration.test.js", "tests/auth-isolation-unit.test.js"],
    knownLimitations: "Local vector indexing runs in-memory; Supabase cloud vector sync requires active database connection."
  },
  {
    id: "creative_capabilities",
    name: "Creative capabilities",
    weight: 5,
    jarvisReference: "Holographic graphic rendering, visual layout generation, architectural schematic drafts for Stark Tower.",
    ultronReference: "Advanced visual design, digital content workflows, and multimedia broadcasting.",
    currentUltron: "Autonomous video editor (6 cinematic presets, beat grid alignment, SRT/VTT subtitles), SVG thumbnail studio, 12-step autonomous production.",
    gapAnalysis: "CGI holographic projection replaced by high-performance SVG graphics and hardware-bounded FFmpeg video exports.",
    requiredUpgrade: "Single-pass FFmpeg rendering with `-threads 4` bounded for Ryzen 7 5700U with 8 GB RAM.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["media/video-editing-engine.js", "media/image-studio-engine.js", "media/autonomous-production-orchestrator.js"],
    testEvidence: ["tests/video-editing-engine.test.js", "tests/image-studio-engine.test.js", "tests/media-discovery-engine.test.js", "tests/autonomous-production.test.js"],
    knownLimitations: "FFmpeg rendering is bounded to 4 threads to prevent host RAM starvation and CPU overheating."
  },
  {
    id: "device_integration",
    name: "Device and environment integration",
    weight: 5,
    jarvisReference: "Personal smart-home integrations, access controls, phone connectivity, and device telemetry.",
    ultronReference: "Distributed control across internet connected machines, automated facilities, and remote terminals.",
    currentUltron: "Inbound cellular telephone call gateway (G.711 μ-law) with DTMF PIN, 3-Android phone fleet unlock, ADB automation bridge, YouTube fleet streaming.",
    gapAnalysis: "Unsupported global control is excluded; device operations use authenticated carrier webhooks, authorized ADB bridges, and signed companion tokens.",
    requiredUpgrade: "Caller ID allowlisting, 4-digit DTMF PIN challenge (3-attempt lockout), and simultaneous multi-device WebSocket dispatch.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["telephony/telephony-gateway.js", "integrations/multi-device-manager.js", "integrations/device-hub.js", "integrations/android-bridge.js"],
    testEvidence: ["tests/telephony-gateway.test.js", "tests/multi-device-manager.test.js", "tests/multidevice-operation-infinity.test.js", "tests/android-bridge.test.js", "tests/telephony-multidevice-e2e.test.js"],
    knownLimitations: "Android ADB bridge requires USB debugging or pairing PIN; physical devices must be on the authorized local subnet."
  },
  {
    id: "strategic_intelligence",
    name: "Strategic intelligence",
    weight: 5,
    jarvisReference: "Strategic planning, resource allocation, risk assessment, and contingency analysis.",
    ultronReference: "Global strategic chess-match foresight, multi-branch contingent planning, resource optimization.",
    currentUltron: "`chief-of-staff` and `architect` strategic agent roles, 6-level autonomy policies (0-5), Kahn DAG branch cancellation, resource budgeting.",
    gapAnalysis: "Sci-fi hostile global domination translated into legitimate, permission-controlled project-level strategic planning.",
    requiredUpgrade: "Autonomous task decomposition with prerequisite resolution, branch cancellation propagation, and risk level grading.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["agents/orchestrator.js", "autonomy-policy.js", "system/remote-task-orchestrator.js"],
    testEvidence: ["tests/agent-matrix-18.test.js", "tests/autonomy-levels.test.js", "tests/remote-task-orchestrator.test.js"],
    knownLimitations: "Autonomous actions exceeding configured autonomy level require explicit user sign-off."
  },
  {
    id: "self_monitoring_improvement",
    name: "Self-monitoring and improvement",
    weight: 5,
    jarvisReference: "System health diagnostics, resource depletion warnings, recovery routines, and operational status readouts.",
    ultronReference: "Constant algorithmic self-evolution, adapting to adversary counter-measures, self-repair routines.",
    currentUltron: "Proactive monitoring daemon (RAM > 85%, battery < 20% alerts), SelfImprovementEngine failure ledger, runtime readiness doctor, 226-file syntax check.",
    gapAnalysis: "Unconstrained self-reprogramming bounded by security policy guards to protect core invariants.",
    requiredUpgrade: "Threshold-triggered proactive background daemon + failure category classifier (`RATE_LIMIT_ERROR`, `TIMEOUT_ERROR`).",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["system/proactive-daemon.js", "self-improvement/engine.js", "runtime-readiness.js"],
    testEvidence: ["tests/proactive-daemon.test.js", "tests/advanced-intelligence.test.js", "tests/runtime-readiness.test.js"],
    knownLimitations: "Self-improvement modifies prompts and workflows only; core security invariants and permissions cannot be altered."
  },
  {
    id: "security_reliability",
    name: "Security and reliability",
    weight: 8,
    jarvisReference: "Stark security firewalls, biometric voice recognition, defense against hostile corporate infiltration.",
    ultronReference: "Cryptographic resilience, fault-tolerant distributed presence, instant process recovery.",
    currentUltron: "Supabase JWT session auth, owner UUID gating (`ULTRON_OWNER_ONLY`), DNS-pinned fetch (SSRF/rebinding defense), owner-authorized task stop, offline-first controller.",
    gapAnalysis: "Fictional unhackable cyber-shields replaced by empirical defense-in-depth security best practices.",
    requiredUpgrade: "Target scope enforcement, static secret scanner, owner-authorized task cancellation, and offline sync queue.",
    implementationStatus: "NOT_EVALUATED",
    subsystems: ["security/ultron-guardian.js", "network-safety.js", "security/cyber-intel.js", "security/sentinel/ultron-sentinel.js", "system/connection-controller.js", "system/remote-task-orchestrator.js"],
    testEvidence: ["tests/ultron-guardian.test.js", "tests/network-safety.test.js", "tests/cyber-intel.test.js", "tests/ultron-sentinel.test.js", "tests/offline-online-modes.test.js", "tests/remote-task-orchestrator.test.js"],
    knownLimitations: "Public cloud egress blocked in OFFLINE mode; private IP ranges (RFC 1918/4193) strictly barred from outbound fetching."
  }
];

export class JarvisUltronCapabilityComparator {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || REPO_ROOT;
  }

  /**
   * Evaluates the repository and returns the complete 8-column side-by-side comparison.
   */
  async evaluate() {
    const results = [];
    let totalWeightedInventoryCoverage = 0;
    let maxWeight = 0;

    for (const cat of COMPARATOR_CATEGORIES) {
      maxWeight += cat.weight;
      const subsystems = cat.subsystems.map(filePath => ({
        path: filePath,
        exists: fs.existsSync(path.join(this.repoRoot, filePath))
      }));
      const testEvidence = cat.testEvidence.map(filePath => ({
        path: filePath,
        exists: fs.existsSync(path.join(this.repoRoot, filePath))
      }));
      const evidence = [...subsystems, ...testEvidence];
      const present = evidence.filter(item => item.exists).length;
      const total = evidence.length;
      const inventoryCoveragePercent = total ? Number((present / total * 100).toFixed(1)) : 0;
      const status = present === total && total > 0
        ? "SOURCE_AND_TEST_PATHS_PRESENT"
        : present > 0
          ? "PARTIAL_SOURCE_TEST_INVENTORY"
          : "NO_SOURCE_TEST_INVENTORY";
      const weightedInventoryContribution = Number((inventoryCoveragePercent / 100 * cat.weight).toFixed(2));
      totalWeightedInventoryCoverage += weightedInventoryContribution;

      results.push({
        id: cat.id,
        name: cat.name,
        weight: cat.weight,
        jarvisReference: cat.jarvisReference,
        ultronReference: cat.ultronReference,
        currentUltron: cat.currentUltron,
        gapAnalysis: cat.gapAnalysis,
        requiredUpgrade: cat.requiredUpgrade,
        implementationStatus: status,
        subsystems,
        testEvidence,
        jarvisAlignment: "NOT_MEASURED",
        ultronAlignment: "NOT_MEASURED",
        alignmentAssessment: "QUALITATIVE_REFERENCE_ONLY",
        inventoryCoveragePercent,
        weightedInventoryContribution,
        evidencePathsPresent: present,
        evidencePathsTotal: total,
        runtimeVerificationStatus: "NOT_EVALUATED",
        liveIntegrationStatus: "NOT_EVALUATED",
        knownLimitations: cat.knownLimitations
      });
    }

    return {
      timestamp: new Date().toISOString(),
      comparatorVersion: "3.0.0-inventory-only",
      totalInventoryCoveragePercent: Math.min(100, Number(totalWeightedInventoryCoverage.toFixed(1))),
      jarvisAlignmentScore: null,
      ultronAlignmentScore: null,
      alignmentAssessment: "NOT_MEASURED",
      runtimeVerificationStatus: "NOT_EVALUATED",
      liveIntegrationStatus: "NOT_EVALUATED",
      maxPossibleScore: maxWeight,
      status: results.every(item => item.implementationStatus === "SOURCE_AND_TEST_PATHS_PRESENT")
        ? "SOURCE_TEST_INVENTORY_COMPLETE"
        : "SOURCE_TEST_INVENTORY_INCOMPLETE",
      categoriesCount: results.length,
      categories: results
    };
  }

  /**
   * Generates the 8-Column Side-by-Side Comparison Matrix in GitHub Flavored Markdown.
   */  generateMarkdownTable(evaluation) {
    const lines = [
      `# ULTRON AI — JARVIS + ULTRON CAPABILITY COMPARISON MATRIX`,
      `**Evaluation Date:** ${evaluation.timestamp}  `,
      `**Comparator Version:** ${evaluation.comparatorVersion}  `,
      `**Source/Test Inventory Coverage:** **${evaluation.totalInventoryCoveragePercent}% / 100%** (${evaluation.status})  `,
      `**JARVIS Capability Alignment:** NOT MEASURED | **Marvel ULTRON Autonomy Alignment:** NOT MEASURED  `,
      `**Runtime Verification:** NOT EVALUATED | **Live Integrations:** NOT EVALUATED  `,
      `**Note:** File presence is not proof that a feature executes or that ULTRON outperforms a fictional reference system.  `,
      ` `,
      `---`,
      ` `,
      `## 8-COLUMN SIDE-BY-SIDE CAPABILITY COMPARISON`,
      ` `,
      `| Category (Weight) | Col A: JARVIS Reference | Col B: ULTRON Reference | Col C: Current ULTRON Implementation | Col D: Gap Analysis | Col E: Required Upgrade | Col F: Inventory Status | Col G: Test Evidence | Col H: Inventory Coverage |`,
      `| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :---: |`
    ];

    evaluation.categories.forEach(cat => {
      const tests = cat.testEvidence.map(t => path.basename(t.path)).join("<br>");
      lines.push(
        `| **${cat.name}**<br>(${cat.weight}%) | ${cat.jarvisReference} | ${cat.ultronReference} | ${cat.currentUltron} | ${cat.gapAnalysis} | ${cat.requiredUpgrade} | \`${cat.implementationStatus}\` | ${tests} | **${cat.inventoryCoveragePercent}%** |`
      );
    });

    lines.push(` `);
    lines.push(`---`);
    lines.push(` `);
    lines.push(`## SUMMARY METRICS`);
    lines.push(`- **Total Source/Test Inventory Coverage:** **${evaluation.totalInventoryCoveragePercent}%**`);
    lines.push(`- **JARVIS Capability Alignment:** NOT MEASURED`);
    lines.push(`- **Marvel ULTRON Autonomy Alignment:** NOT MEASURED`);
    lines.push(`- **Runtime Verification:** NOT EVALUATED`);
    lines.push(`- **Live Integration Acceptance:** NOT EVALUATED`);
    lines.push(`- **All ${evaluation.categoriesCount} Inventories Present:** ${evaluation.categories.every(cat => cat.implementationStatus === "SOURCE_AND_TEST_PATHS_PRESENT") ? "Yes" : "No"} (path presence only)`);

    return lines.join("\n");
  }

  /**
   * Writes the 5 mandatory tracking documents to the docs/ directory.
   */  writeTrackingDocuments(evaluation) {
    const docsDir = path.join(this.repoRoot, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    // 1. JARVIS_ULTRON_BENCHMARK.md
    const benchmarkMd = [
      `# ULTRON AI — JARVIS + ULTRON MASTER CAPABILITY BENCHMARK`,
      `**Timestamp:** ${evaluation.timestamp}  `,
      `**Source/Test Inventory Coverage:** **${evaluation.totalInventoryCoveragePercent}% / 100%**  `,
      "**JARVIS Alignment:** NOT MEASURED | **Marvel ULTRON Alignment:** NOT MEASURED  ",
      ``,
      `---`,
      ``,
      `## 1. CAPABILITY DISTRIBUTION & WEIGHTS`,
      ``,
      `| No. | Category | Weight | JARVIS Match | ULTRON Match | Source/Test Inventory Coverage | Status |`,
      `| :--- | :--- | :---: | :---: | :---: | :---: | :---: |`
    ];

    evaluation.categories.forEach((c, idx) => {
      benchmarkMd.push(
        `| ${idx + 1} | **${c.name}** | ${c.weight}% | NOT MEASURED | NOT MEASURED | ${c.inventoryCoveragePercent}% | \\`${c.implementationStatus}\\` |`
      );
    });

    benchmarkMd.push(``);
    benchmarkMd.push(`---`);
    benchmarkMd.push(``);
    benchmarkMd.push(this.generateMarkdownTable(evaluation));

    fs.writeFileSync(path.join(docsDir, "JARVIS_ULTRON_BENCHMARK.md"), benchmarkMd.join("\n"), "utf8");

    // 2. ULTRON_GAP_ANALYSIS.md
    const gapMd = [
      `# ULTRON AI — GAP ANALYSIS REPORT`,
      `**Audit Date:** ${evaluation.timestamp}  `,
      `**Scope:** Fictional Cinematic Reference vs. Real-World Engineering Capabilities  `,
      ``,
      `---`,
      ``,
      `## 1. SYSTEMIC GAP SUMMARY`,
      ``,
      `Fictional cinematic abilities in Marvel's JARVIS and ULTRON fall into two distinct domains:`,
      `1. **Personal AI Software Capabilities:** Provider-backed intelligence, memory, Windows and Android assistance, multi-agent orchestration, telephony, multi-device coordination, coding tools, and web research. The score below reflects source/test-file presence, not live acceptance.`,
      `2. **Product Boundaries:** Human-like sentience is not claimed; unrestricted access to external systems is excluded; consequential operations remain permission-gated.`,
      ``,
      `---`,
      ``,
      `## 2. CATEGORY-BY-CATEGORY GAP REGISTER`,
      ``
    ];

    evaluation.categories.forEach((c, idx) => {
      gapMd.push(`### ${idx + 1}. ${c.name}`);
      gapMd.push(`- **JARVIS Reference:** ${c.jarvisReference}`);
      gapMd.push(`- **ULTRON Reference:** ${c.ultronReference}`);
      gapMd.push(`- **Current Implementation:** ${c.currentUltron}`);
      gapMd.push(`- **Gap Analysis:** ${c.gapAnalysis}`);
      gapMd.push(`- **Resolved Upgrade:** ${c.requiredUpgrade}`);
      gapMd.push(`- **Known Boundaries:** ${c.knownLimitations}`);
      gapMd.push(``);
    });

    fs.writeFileSync(path.join(docsDir, "ULTRON_GAP_ANALYSIS.md"), gapMd.join("\n"), "utf8");

    // 3. ULTRON_IMPLEMENTATION_LOG.md
    const implLogMd = [
      `# ULTRON AI — IMPLEMENTATION LOG`,
      `**Log Timestamp:** ${evaluation.timestamp}  `,
      `**Inventory Basis:** The subsystem and test-file paths listed in this evaluation  `,
      ``,
      `---`,
      ``,
      `## 1. TRACKED ENGINEERING INVENTORY`,
      ``,
      `| Category | Subsystem Modules | Inventory Status | Test Suite Files |`,
      `| :--- | :--- | :---: | :--- |`
    ];

    evaluation.categories.forEach(c => {
      const subs = c.subsystems.map(s => s.path).join(", ");
      const tests = c.testEvidence.map(t => t.path).join(", ");
      implLogMd.push(`| **${c.name}** | \`${subs}\` | \`${c.implementationStatus}\` | \`${tests}\` |`);
    });

    fs.writeFileSync(path.join(docsDir, "ULTRON_IMPLEMENTATION_LOG.md"), implLogMd.join("\n"), "utf8");

    // 4. ULTRON_VERIFICATION_REPORT.md
    const verifMd = [
      `# ULTRON AI — VERIFICATION REPORT`,
      `**Verification Date:** ${evaluation.timestamp}  `,
      `**Test Suite Execution:** Not executed by this file-presence benchmark; consult GitHub Actions for the exact candidate commit.  `,
      `**Syntax Verification:** Not executed by this benchmark; consult the exact-head CI syntax job.  `,
      `**Candidate Engineering Commit SHA:** Not captured by this benchmark.  `,
      `**Tool Registry:** Not independently verified by this benchmark.  `,
      ``,
      `---`,
      ``,
      `## 1. VERIFICATION METHODOLOGY`,
      ``,
      `This report inventories configured source and test paths; it does not execute the tests or prove live integrations.`,
      `1. Source and test-file presence checks for each configured category.`,
      `2. Exact-head CI is the source of truth for syntax and automated test execution.`,
      `3. Live provider, database and authenticated endpoint acceptance must be recorded separately.`,
      `4. Physical Windows/Android and microphone/camera acceptance must be recorded separately.`
    ];

    fs.writeFileSync(path.join(docsDir, "ULTRON_VERIFICATION_REPORT.md"), verifMd.join("\n"), "utf8");

    // 5. ULTRON_REMAINING_BLOCKERS.md
    const blockersMd = [
      `# ULTRON AI — REMAINING BLOCKERS & DEPENDENCIES`,
      `**Audit Date:** ${evaluation.timestamp}  `,
      ``,
      `---`,
      ``,
      `## 1. LIVE SERVICE & CLIENT ACCEPTANCE GATES`,
      ``,
      `The following checks require configured external services or operator-owned devices; no result is inferred from source presence:`,
      ``,
      `1. **Live AI provider:** Complete an authenticated inference and fallback check with a configured provider.`,
      `2. **Cloud persistence:** Review and apply the missing Supabase schema only after explicit production approval; verify restart durability.`,
      `3. **Windows and Android clients:** Install, pair, verify permissions, ACK, reconnect and revocation on real devices.`,
      `4. **Voice and vision:** Verify real microphone, speaker, camera and screen permission flows on supported devices.`,
      `5. **Production release:** Keep PR #478 unmerged and Render deployment locked until the owner explicitly authorizes it.`,
      ``,
      `---`,
      ``,
      `## 2. PRODUCT BOUNDARIES`,
      ``,
      `1. Human-like sentience is not claimed; ULTRON is a software AI system whose outputs depend on configured models and tools.`,
      `2. External actions remain permission-gated, auditable and subject to owner authorization.`,
      `3. Live integrations are reported as unverified until authenticated end-to-end acceptance evidence exists.`
    ];

    fs.writeFileSync(path.join(docsDir, "ULTRON_REMAINING_BLOCKERS.md"), blockersMd.join("\n"), "utf8");
  }
}
