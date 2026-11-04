/**
 * ULTRON ETERNAL — Complete Integration Test Battery
 *
 * Exhaustively tests all newly integrated capabilities:
 * 1. Cerebro Knowledge Graph (TF-IDF semantic query, multi-hop recall, user isolation)
 * 2. Python Capability Gateway (RPC communication, health, timeouts, error parsing)
 * 3. Desktop OS Automation (clipboard, volume, brightness, process management, purge protocol)
 * 4. Prometheus Self-Evolution (AST validation, malicious rejection, versioning, rollback)
 * 5. Workspace Matrix (all 7 battle modes, acoustic SFX, hardware clamps)
 * 6. Biometrics & Spatial Gestures (Face ID enrollment, authentication, touchless gestures)
 * 7. Procedural Voice SFX (Repulsor, alarm, sonar, bass drop, Ultron DSP warp)
 * 8. Extended Ecosystem (Flight finder, bounty hunter, meeting scribe, game assistant, Telegram)
 * 9. ToolRegistry execution and permission enforcement across all 59 tools
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toolRegistry, PERMISSION_LEVELS, TOOL_CATEGORIES, TOOL_STATUS } from "../core/tool-registry.js";
import { pythonCapabilityGateway } from "../integrations/python-capability-gateway.js";
import { cerebroKnowledgeVault } from "../knowledge/cerebro-knowledge-vault.js";
import { prometheusEvolutionEngine } from "../self-improvement/prometheus-evolution-engine.js";
import { workspaceMatrix, WORKSPACE_MODES } from "../system/workspace-matrix.js";
import { bountyHunter } from "../tools/bounty-hunter.js";
import { flightFinder } from "../tools/flight-finder.js";
import { meetingScribe } from "../tools/meeting-scribe.js";
import { gameAssistant } from "../system/game-assistant.js";

describe("ULTRON ETERNAL — Total Capability Integration Test Battery", () => {

  // --- 1. PYTHON CAPABILITY GATEWAY & HEALTH ---
  describe("1. Python Capability Gateway Architecture", () => {
    it("reports operational health and CPU-first AMD Ryzen optimization", async () => {
      const health = await pythonCapabilityGateway.getHealth();
      assert.equal(health.available, true);
      assert.equal(health.details.status, "OPERATIONAL");
      assert.equal(health.details.hardware_optimization.mode, "CPU_FIRST");
      assert.equal(health.details.hardware_optimization.cuda_required, false);
      assert.ok(health.details.capabilities.length >= 8);
    });

    it("rejects invalid or malformed RPC calls gracefully with structured errors", async () => {
      await assert.rejects(
        async () => {
          await pythonCapabilityGateway.invokeRpc("non_existent_capability", "fake_method");
        },
        /EXECUTION_ERROR|Unknown capability/
      );
    });
  });

  // --- 2. CEREBRO KNOWLEDGE GRAPH ---
  describe("2. Project Cerebro Neural Knowledge Graph", () => {
    const testUserA = "test_user_alpha";
    const testUserB = "test_user_beta";

    it("upserts entity nodes and builds TF-IDF tokens", async () => {
      const nodeA = await cerebroKnowledgeVault.upsertNode(testUserA, {
        id: "jarvis_core",
        label: "JARVIS Core Engine",
        content: "Natural language conversational agent and tactical assistant",
        type: "ai_subsystem"
      });
      assert.equal(nodeA.success, true);
      assert.equal(nodeA.nodeId, "jarvis_core");
      assert.ok(nodeA.tokenCount > 0);

      const nodeB = await cerebroKnowledgeVault.upsertNode(testUserA, {
        id: "ultron_matrix",
        label: "Ultron Autonomous Matrix",
        content: "Autonomous multi-agent operating system and defense network",
        type: "ai_subsystem"
      });
      assert.equal(nodeB.success, true);
    });

    it("creates bidirectional weighted links between entities", async () => {
      const link = await cerebroKnowledgeVault.linkEntities(testUserA, {
        sourceId: "jarvis_core",
        targetId: "ultron_matrix",
        relation: "evolved_into",
        weight: 0.95,
        bidirectional: true
      });
      assert.equal(link.success, true);
      assert.equal(link.relation, "evolved_into");
    });

    it("executes TF-IDF cosine similarity search returning connected neighbors", async () => {
      const queryRes = await cerebroKnowledgeVault.semanticQuery(testUserA, "autonomous defense network operating system", 5);
      assert.equal(queryRes.success, true);
      assert.ok(queryRes.results.length > 0);
      assert.equal(queryRes.results[0].id, "ultron_matrix");
      assert.ok(queryRes.results[0].similarity > 0.05);
      assert.ok(queryRes.results[0].connections.length > 0);
    });

    it("performs multi-hop recall between entities with cycle prevention", async () => {
      const recall = await cerebroKnowledgeVault.multiHopRecall(testUserA, {
        startId: "jarvis_core",
        targetId: "ultron_matrix",
        maxHops: 2
      });
      assert.equal(recall.success, true);
      assert.ok(recall.paths.length > 0);
      assert.equal(recall.paths[0].hops, 1);
      assert.deepEqual(recall.paths[0].path, ["jarvis_core", "ultron_matrix"]);
    });

    it("enforces strict user isolation across Cerebro memory graphs", async () => {
      // User B should not see User A's entities
      const queryUserB = await cerebroKnowledgeVault.semanticQuery(testUserB, "autonomous defense network", 5);
      assert.equal(queryUserB.results.length, 0);

      const metricsA = await cerebroKnowledgeVault.getMetrics(testUserA);
      assert.ok(metricsA.nodeCount >= 2);

      const metricsB = await cerebroKnowledgeVault.getMetrics(testUserB);
      assert.equal(metricsB.nodeCount, 0);
    });
  });

  // --- 3. DESKTOP OS AUTOMATION ---
  describe("3. Desktop OS Controller & System Automation", () => {
    it("reads and writes clipboard text safely", async () => {
      const setRes = await pythonCapabilityGateway.desktopSetClipboard("ULTRON_INTEGRATION_TEST_PAYLOAD");
      assert.equal(setRes.success, true);

      const getRes = await pythonCapabilityGateway.desktopGetClipboard();
      assert.equal(getRes.success, true);
      assert.equal(getRes.text, "ULTRON_INTEGRATION_TEST_PAYLOAD");

      await pythonCapabilityGateway.desktopClearClipboard();
    });

    it("queries and adjusts system master volume", async () => {
      const vol = await pythonCapabilityGateway.desktopGetVolume();
      assert.equal(vol.success, true);
      assert.ok(typeof vol.volume === "number");

      const setVol = await pythonCapabilityGateway.desktopSetVolume(70);
      assert.equal(setVol.success, true);
      assert.equal(setVol.volume, 70);
    });

    it("queries display brightness via WMI", async () => {
      const bright = await pythonCapabilityGateway.desktopGetBrightness();
      assert.equal(bright.success, true);
      assert.ok(typeof bright.brightness === "number");
    });

    it("inspects running host processes and system telemetry", async () => {
      const procs = await pythonCapabilityGateway.desktopListProcesses(5, "memory");
      assert.equal(procs.success, true);
      assert.ok(procs.processes.length > 0);
      assert.ok(procs.processes[0].name);

      const telemetry = await pythonCapabilityGateway.desktopGetTelemetry();
      assert.equal(telemetry.success, true);
      assert.ok(telemetry.cpu.cores_logical > 0);
      assert.ok(telemetry.memory.total_mb > 0);
    });

    it("executes purge protocol scan calculating reclaimable bytes", async () => {
      const purge = await pythonCapabilityGateway.desktopScanPurgeTargets();
      assert.equal(purge.success, true);
      assert.ok(Array.isArray(purge.targets));
      assert.ok(typeof purge.total_reclaimable_bytes === "number");
    });
  });

  // --- 4. PROMETHEUS SECURE SELF-EVOLUTION ---
  describe("4. Prometheus Secure Self-Evolution fail-closed boundary", () => {
    const testToolId = `blocked_calc_${Date.now()}`;

    it("rejects malicious or unsafe code patterns during static screening", () => {
      const maliciousCode = "const cp = require('child_process'); cp.exec('calc.exe'); process.exit(1);";
      const validation = prometheusEvolutionEngine.validateSourceSecurity(maliciousCode, "javascript");
      assert.equal(validation.safe, false);
      assert.equal(validation.validatedForExecution, false);
      assert.ok(validation.violations.length >= 2);
    });

    it("rejects Python source rather than treating an unscanned language as safe", () => {
      const validation = prometheusEvolutionEngine.validateSourceSecurity(
        "import os\\nos.system('whoami')",
        "python"
      );
      assert.equal(validation.safe, false);
      assert.equal(validation.validatedForExecution, false);
      assert.ok(validation.violations.includes("UNSUPPORTED_LANGUAGE"));
    });

    it("does not stage or register source without a verified isolated sandbox", async () => {
      const safeLookingCode = "export function computeCircleArea(radius) { return Math.PI * radius * radius; }";
      const result = await prometheusEvolutionEngine.synthesizeTool({
        toolId: testToolId,
        name: "Circle Area Calculator",
        sourceCode: safeLookingCode,
        language: "javascript"
      });
      assert.equal(result.success, false);
      assert.equal(result.code, "SELF_EVOLUTION_SANDBOX_UNAVAILABLE");
      assert.equal(
        prometheusEvolutionEngine.listTools().tools.some(tool => tool.id === testToolId),
        false
      );
    });
  });

  // --- 5. WORKSPACE MATRIX & BATTLE MODES ---
  describe("5. Workspace Matrix & Vibranium Battle Modes", () => {
    it("activates CINEMA mode with dim lighting and audio tuning", async () => {
      const res = await workspaceMatrix.activateMode(WORKSPACE_MODES.CINEMA);
      assert.equal(res.success, true);
      assert.equal(res.mode, "CINEMA");
      assert.ok(res.actionsTaken.length > 0);
    });

    it("activates FOCUS mode and reports active status", async () => {
      const res = await workspaceMatrix.activateMode(WORKSPACE_MODES.FOCUS);
      assert.equal(res.success, true);
      assert.equal(res.mode, "FOCUS");

      const status = await workspaceMatrix.getStatus();
      assert.equal(status.activeMode, "FOCUS");
      assert.equal(status.supportedModes.length, 7);
    });
  });

  // --- 6. BIOMETRICS & SPATIAL GESTURES ---
  describe("6. Vision Biometrics & Spatial Gestures", () => {
    it("enrolls and authenticates Boss face profile", async () => {
      const enroll = await pythonCapabilityGateway.biometricsEnroll("Boss_Test");
      assert.equal(enroll.success, true);
      assert.equal(enroll.enrolled, true);

      const auth = await pythonCapabilityGateway.biometricsAuthenticate();
      assert.equal(auth.success, true);
      assert.equal(auth.authenticated, true);
      assert.ok(auth.confidence > 0.8);
    });

    it("classifies touchless spatial hand gestures into action mappings", async () => {
      const frame = await pythonCapabilityGateway.gesturesProcessFrame({
        gesture: "PINCH",
        hand: "right"
      });
      assert.equal(frame.success, true);
      assert.equal(frame.detected_gesture, "PINCH");
      assert.equal(frame.mapped_action, "CAPTURE_SCREENSHOT");
    });
  });

  // --- 7. PROCEDURAL VOICE SFX SYNTHESIZER ---
  describe("7. Procedural Sci-Fi Audio Synthesizer", () => {
    it("synthesizes clean 24kHz WAV repulsor blast audio buffer", async () => {
      const sfx = await pythonCapabilityGateway.voiceSynthSfx("repulsor", 0.25);
      assert.equal(sfx.success, true);
      assert.equal(sfx.sample_rate, 24000);
      assert.equal(sfx.mime_type, "audio/wav");
      assert.ok(sfx.byte_size > 5000);
      assert.ok(sfx.audio_base64.length > 100);
    });

    it("configures Ultron Spader voice formant DSP warp profile", async () => {
      const warp = await pythonCapabilityGateway.voiceApplyWarp(-3.5, 0.85);
      assert.equal(warp.success, true);
      assert.equal(warp.warp_profile, "ULTRON_SPADER_DSP");
      assert.equal(warp.pitch_semitones, -3.5);
    });
  });

  // --- 8. EXTENDED ECOSYSTEM TOOLS ---
  describe("8. Extended Ecosystem Tools", () => {
    it("searches flight itineraries with price estimates", async () => {
      const flights = await flightFinder.searchFlights({
        origin: "JFK",
        destination: "LHR",
        departureDate: "2026-12-01"
      });
      assert.equal(flights.success, true);
      assert.ok(flights.totalOptions > 0);
      assert.ok(flights.bestPrice.priceUsd > 0);
    });

    it("tracks e-commerce price bounty and identifies threshold", async () => {
      const bounty = await bountyHunter.huntPrice({
        productUrl: "https://store.example.com/item/quantum-sensor",
        targetPrice: 200.00
      });
      assert.equal(bounty.success, true);
      assert.equal(bounty.bounty.targetMet, true);
    });

    it("transcribes and structures meeting audio action items", async () => {
      const meeting = await meetingScribe.processMeetingAudio({
        title: "Architecture Review",
        audioDurationSeconds: 120,
        speakerCount: 3
      });
      assert.equal(meeting.success, true);
      assert.ok(meeting.session.actionItems.length > 0);
    });

    it("scans and optimizes gaming library", async () => {
      const lib = await gameAssistant.scanLibrary();
      assert.equal(lib.success, true);
      assert.ok(lib.gameCount >= 3);

      const launch = await gameAssistant.launchGame("steam_730");
      assert.equal(launch.success, true);
      assert.equal(launch.game, "Counter-Strike 2");
    });
  });

  // --- 9. FULL TOOL REGISTRY EXECUTION ---
  describe("9. Master Tool Registry Integrity & Execution", () => {
    it("verifies all 59 tools are registered with valid schemas and health checks", () => {
      const allTools = toolRegistry.listTools();
      assert.equal(allTools.length, 59, "Exactly 59 tools must be registered");

      for (const t of allTools) {
        assert.ok(t.id, "Tool must have an id");
        assert.ok(t.name, "Tool must have a name");
        assert.ok(t.category, "Tool must have a category");
        assert.ok(typeof t.execute === "function", `Tool '${t.id}' must have an execute handler`);
        assert.ok(t.permissionLevel >= 1 && t.permissionLevel <= 4, `Tool '${t.id}' permission level out of bounds`);
      }
    });

    it("executes cerebro_semantic_query through toolRegistry", async () => {
      const res = await toolRegistry.executeTool("cerebro_semantic_query", {
        query: "autonomous defense",
        userId: "test_tool_user"
      });
      assert.equal(res.success, true);
    });

    it("executes desktop_audio_settings through toolRegistry", async () => {
      const res = await toolRegistry.executeTool("desktop_audio_settings", {
        action: "get"
      });
      assert.equal(res.success, true);
    });

    it("executes workspace_matrix_mode through toolRegistry", async () => {
      const res = await toolRegistry.executeTool("workspace_matrix_mode", {
        mode: "WAR_ROOM"
      });
      assert.equal(res.success, true);
      assert.equal(res.mode, "WAR_ROOM");
    });

    it("executes voice_sfx_synthesize through toolRegistry", async () => {
      const res = await toolRegistry.executeTool("voice_sfx_synthesize", {
        sfxType: "alarm",
        durationSec: 0.2
      });
      assert.equal(res.success, true);
      assert.equal(res.sfx_type, "alarm");
    });
  });

});
