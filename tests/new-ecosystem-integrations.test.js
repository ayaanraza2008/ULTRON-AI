import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  freeLlmRegistry,
  FREE_PROVIDER_STATUS
} from "../integrations/free-llm-registry.js";

import {
  agencyAgentsMatrix,
  AGENCY_DOMAINS
} from "../agents/agency-agents-matrix.js";

import {
  diagramDesignEngine,
  DIAGRAM_TYPES
} from "../tools/diagram-design.js";

import {
  cybersecuritySkillsEngine,
  STRIDE_CATEGORIES
} from "../security/cybersecurity-skills.js";

import {
  immichConnector,
  getImmichReadiness,
  ImmichConnector
} from "../integrations/immich.js";

import {
  publicApisCatalog,
  API_AUTH_TYPES
} from "../integrations/public-apis-directory.js";

import {
  contentProvenanceAnalyzer,
  analyzeContentProvenance
} from "../intelligence/content-provenance.js";

import {
  NeuralSpeechGateway,
  neuralSpeechGateway
} from "../voice/neural-speech-adapters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

test("1. Free LLM Provider Discovery & Aggregator", async (t) => {
  await t.test("lists curated free providers", () => {
    const providers = freeLlmRegistry.listProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length >= 7, "Should list at least 7 curated free providers");
    
    const groq = providers.find(p => p.id === "groq-free");
    assert.ok(groq, "Groq free provider must exist");
    assert.equal(groq.status, FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY);
    assert.ok(groq.models.length > 0);

    const cactus = providers.find(p => p.id === "local-cactus-strata");
    assert.ok(cactus, "Local provider must exist");
    assert.equal(cactus.status, FREE_PROVIDER_STATUS.LOCAL_INFERENCE);
  });

  await t.test("recommends appropriate free provider for use cases", () => {
    // Recommend when credentials configured in env
    const mockEnv = { GROQ_API_KEY: "gsk_test123" };
    const rec = freeLlmRegistry.recommendFreeProvider({ estimatedTokens: 2000, env: mockEnv });
    assert.ok(rec.recommended, "Should recommend an available provider");
    assert.equal(rec.recommended.id, "groq-free");

    // Recommend local fallback when no keys are provided
    const emptyRec = freeLlmRegistry.recommendFreeProvider({ estimatedTokens: 500, env: {} });
    assert.ok(emptyRec.recommended);
    assert.equal(emptyRec.recommended.id, "local-cactus-strata");
  });

  await t.test("provider registration checks required fields", () => {
    const p = freeLlmRegistry.getProvider("groq-free");
    assert.ok(p);
    assert.equal(p.status, FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY);
    assert.ok(p.rateLimitRpm > 0);
  });
});

test("2. Agency-Agents Capability Matrix", async (t) => {
  await t.test("lists defined agency roles with bounded responsibilities", () => {
    const roles = agencyAgentsMatrix.listRoles();
    assert.ok(Array.isArray(roles));
    assert.ok(roles.length >= 6, "Should define specialized agency roles");

    const secEngineer = agencyAgentsMatrix.getRole("cyber-defense-analyst");
    assert.ok(secEngineer);
    assert.equal(secEngineer.domain, AGENCY_DOMAINS.CYBERSECURITY_DEFENSE);
    assert.ok(Array.isArray(secEngineer.responsibilities));
    assert.ok(secEngineer.requiredReviewGate.length > 0, "High impact actions must require approval");
  });

  await t.test("assembles cross-functional agency team for a project", () => {
    const team = agencyAgentsMatrix.assembleTeam("software_launch");
    assert.equal(team.length, 4);
    assert.ok(team.some(m => m.id === "fullstack-architect"));
    assert.ok(team.some(m => m.id === "cyber-defense-analyst"));
  });

  await t.test("generates safe role prompt directive with safety constraints", () => {
    const directive = agencyAgentsMatrix.generateRoleDirective("sre-devops-lead", { projectName: "ULTRON CI" });
    assert.ok(typeof directive === "string");
    assert.ok(directive.includes("ULTRON SPECIALIZED AGENT ROLE:"));
    assert.ok(directive.includes("Site Reliability & Cloud Infrastructure Lead"));
    assert.ok(directive.includes("CORE RESPONSIBILITIES:"));
  });
});

test("3. Diagram Design Generator", async (t) => {
  await t.test("generates valid Mermaid flowchart and sequence diagrams", () => {
    const flow = diagramDesignEngine.generateFlowchart({
      title: "Authentication Pipeline",
      nodes: [
        { id: "A", label: "Client Request" },
        { id: "B", label: "Rate Limiter" },
        { id: "C", label: "Auth Middleware" }
      ],
      edges: [
        { from: "A", to: "B", label: "HTTPS" },
        { from: "B", to: "C", label: "Allowed" }
      ]
    });

    assert.ok(flow.rawMermaid.includes("flowchart TD"));
    assert.ok(flow.rawMermaid.includes("A -->|\"HTTPS\"| B"));
    assert.equal(flow.type, DIAGRAM_TYPES.FLOWCHART);

    const seq = diagramDesignEngine.generateSequenceDiagram({
      title: "Voice Pipeline",
      participants: ["User", "VoiceGateway", "LLM"],
      messages: [
        { from: "User", to: "VoiceGateway", text: "Voice audio stream" },
        { from: "VoiceGateway", to: "LLM", text: "Transcribed prompt" }
      ]
    });

    assert.ok(seq.rawMermaid.includes("sequenceDiagram"));
    assert.ok(seq.rawMermaid.includes("User->>VoiceGateway: Voice audio stream"));
    assert.equal(seq.type, DIAGRAM_TYPES.SEQUENCE);
  });

  await t.test("generates clean and sanitized standalone SVG architecture diagram", () => {
    const svgResult = diagramDesignEngine.generateArchitectureSvg({
      title: "ULTRON Core Subsystems",
      components: [
        { name: "Frontend / HUD", desc: "Three.js HUD, Floating Core" },
        { name: "Intelligence", desc: "Brain Router, Self-Evolution" },
        { name: "Integrations", desc: "Sandbox, Device Hub, APIs" }
      ]
    });

    assert.ok(svgResult.svg.startsWith("<svg"));
    assert.ok(svgResult.svg.endsWith("</svg>"));
    assert.ok(svgResult.svg.includes("ULTRON Core Subsystems"));
    assert.ok(!svgResult.svg.includes("<script>"), "SVG must never contain executable scripts");
  });

  await t.test("validates Mermaid syntax safely", () => {
    const validCheck = diagramDesignEngine.validateMermaid("flowchart TD\n  A --> B");
    assert.equal(validCheck.valid, true);

    const invalidCheck = diagramDesignEngine.validateMermaid("unknownSyntax XYZ");
    assert.equal(invalidCheck.valid, false);
  });
});

test("4. Defensive Cybersecurity Skills & Threat Modeling", async (t) => {
  await t.test("performs structured STRIDE threat modeling analysis", () => {
    const stride = cybersecuritySkillsEngine.generateStrideAssessment({
      systemName: "Device Hub Pairing Endpoint",
      components: ["Pairing Endpoint", "Device Hub"],
      dataFlows: ["Companion IP to Hub", "Token to Companion"]
    });

    assert.equal(stride.systemName, "Device Hub Pairing Endpoint");
    assert.equal(stride.threatCount, 6);
    assert.ok(stride.threats.some(t => t.category === STRIDE_CATEGORIES.SPOOFING));
    assert.ok(stride.threats.some(t => t.category === STRIDE_CATEGORIES.TAMPERING));
    assert.ok(stride.threats.some(t => t.category === STRIDE_CATEGORIES.ELEVATION_OF_PRIVILEGE));
  });

  await t.test("computes DREAD risk score with calibrated risk levels", () => {
    const dreadHigh = cybersecuritySkillsEngine.scoreDreadRisk({
      damage: 9,
      reproducibility: 8,
      exploitability: 8,
      affectedUsers: 10,
      discoverability: 7
    });
    assert.equal(dreadHigh.dreadScore, 8.4);
    assert.equal(dreadHigh.riskLevel, "CRITICAL");

    const dreadLow = cybersecuritySkillsEngine.scoreDreadRisk({
      damage: 2,
      reproducibility: 3,
      exploitability: 2,
      affectedUsers: 2,
      discoverability: 1
    });
    assert.equal(dreadLow.dreadScore, 2.0);
    assert.equal(dreadLow.riskLevel, "LOW");
  });

  await t.test("retrieves defensive playbooks for security mechanisms", () => {
    const playbook = cybersecuritySkillsEngine.explainSecurityMechanism("single_use_tokens");
    assert.ok(playbook.found);
    assert.ok(playbook.title.includes("Single-Use Cryptographic Nonce"));
    assert.ok(playbook.summary.length > 0);
    assert.ok(playbook.mitigationRecommendation.length > 0);
  });
});

test("5. Immich Private Media Connector", async (t) => {
  await t.test("reports readiness and validates configuration", () => {
    const unconfigured = getImmichReadiness({});
    assert.equal(unconfigured.configured, false);
    assert.equal(unconfigured.state, "owner_guard_required");

    const configured = getImmichReadiness({
      IMMICH_BASE_URL: "https://photos.example.com",
      IMMICH_API_KEY: "secret-key-12345",
      ULTRON_INTEGRATION_OWNER_USER_ID: "owner-usr-001"
    });
    assert.equal(configured.configured, true);
    assert.equal(configured.state, "configured_unverified");
  });

  await t.test("enforces owner authorization gate", () => {
    const connector = new ImmichConnector({
      env: {
        ULTRON_INTEGRATION_OWNER_USER_ID: "verified-owner-id"
      }
    });

    assert.throws(() => {
      connector.assertOwnerAccess("unauthorized-user-id");
    }, /ACCESS_DENIED/);

    assert.doesNotThrow(() => {
      connector.assertOwnerAccess("verified-owner-id");
    });
  });
});

test("6. Public APIs Discovery Catalog", async (t) => {
  await t.test("lists curated open data public APIs with security classifications", () => {
    const apis = publicApisCatalog.listApis();
    assert.ok(Array.isArray(apis));
    assert.ok(apis.length >= 7, "Catalog should have at least 7 curated open public APIs");

    const meteo = apis.find(a => a.id === "open-meteo");
    assert.ok(meteo);
    assert.equal(meteo.authType, API_AUTH_TYPES.NONE);
    assert.equal(meteo.https, true);

    const nvd = apis.find(a => a.id === "nvd-cve-api");
    assert.ok(nvd);
    assert.equal(nvd.category, "Cybersecurity & Intel");
  });

  await t.test("searches catalog by keyword", () => {
    const geoApis = publicApisCatalog.searchApis("nominatim");
    assert.ok(geoApis.length > 0);
    assert.equal(geoApis[0].id, "nominatim-osm");
  });

  await t.test("blocks SSRF targets in public API directory validator", () => {
    assert.equal(publicApisCatalog.validateCandidateUrl("http://169.254.169.254/latest").safe, false);
    assert.equal(publicApisCatalog.validateCandidateUrl("http://10.0.0.1/admin").safe, false);
    assert.equal(publicApisCatalog.validateCandidateUrl("https://api.open-meteo.com/v1/forecast").safe, true);
  });
});

test("7. Content Authenticity & Statistical Provenance Analyzer", async (t) => {
  await t.test("calculates linguistic metrics and returns calibrated score with disclaimer", () => {
    const sampleText = `
      The autonomous system utilizes a distributed consensus protocol to verify state transitions.
      In contrast, human operators frequently switch between high-level strategic reasoning and low-level tactical adjustments.
      Sentence lengths vary widely here! Short ones. Then a substantially longer and more structurally intricate sentence that elaborates on the empirical distribution of words across varied domains.
      Notice the shifting cadences and distinct vocabulary selections throughout this test paragraph.
    `;

    const result = analyzeContentProvenance(sampleText);
    assert.equal(result.status, "ANALYZED");
    assert.ok(typeof result.burstiness === "number");
    assert.ok(typeof result.typeTokenRatio === "number");
    assert.ok(typeof result.trigramRepetition === "number");
    assert.ok(typeof result.aiProbabilityScore === "number");
    assert.ok(result.disclaimer.includes("Statistical metrics cannot definitively prove authorship"));
  });

  await t.test("handles short or empty text safely without throwing", () => {
    const shortResult = analyzeContentProvenance("Too short");
    assert.equal(shortResult.status, "INSUFFICIENT_TEXT");
    assert.equal(shortResult.aiProbabilityScore, 0.5);
  });
});

test("8. Neural Speech Gateway & Voice Safety Controls", async (t) => {
  await t.test("OmniVoice synthesis gracefully handles unconfigured state", async () => {
    const result = await neuralSpeechGateway.synthesizeOmniVoice({ text: "Test voice" });
    assert.equal(result.success, false);
    assert.equal(result.fallbackToKokoro, true);
    assert.ok(result.error.includes("OMNIVOICE_UNCONFIGURED"));
  });

  await t.test("Chatterbox adapter enforces mandatory voice-cloning consent gating", async () => {
    const testGateway = new NeuralSpeechGateway({
      env: {
        CHATTERBOX_BASE_URL: "https://voice.example.com",
        CHATTERBOX_API_KEY: "secret-key"
      }
    });

    // Attempting voice synthesis without verified consent record must fail closed
    const unconsented = await testGateway.synthesizeChatterbox({
      text: "Test voice clone",
      voiceProfileId: "profile-1",
      consentRecord: { authorized: false }
    });
    assert.equal(unconsented.success, false);
    assert.equal(unconsented.fallbackToKokoro, true);
    assert.ok(unconsented.error.includes("CONSENT_VERIFICATION_REQUIRED"));
  });
});

test("9. World Intelligence Bridge Origin Security", async (t) => {
  const bridgePath = path.join(REPO_ROOT, "integrations", "world-intelligence-bridge.js");
  const bridgeCode = fs.readFileSync(bridgePath, "utf-8");

  await t.test("contains verified Render frontend and loopback origins, rejects retired origin", () => {
    assert.ok(
      bridgeCode.includes("https://ultron-core-interface.onrender.com"),
      "Production frontend origin must be present"
    );
    assert.ok(
      !bridgeCode.includes("https://ultron-ai-zvd7.onrender.com"),
      "Stale retired Render origin must NOT be present"
    );
    assert.ok(
      bridgeCode.includes("http://localhost:3000") && bridgeCode.includes("http://localhost:10000"),
      "Loopback dev origins must be present"
    );
  });

  await t.test("declares all required globe action primitives", () => {
    const requiredActions = [
      "set_layer_visibility",
      "zoom_to_globe",
      "adjust_camera_zoom",
      "fly_to_location",
      "set_visual_style",
      "stop_tracking",
      "set_context_mode",
      "get_current_view_state",
      "track_entity"
    ];
    for (const action of requiredActions) {
      assert.ok(bridgeCode.includes(`'${action}'`), `Action ${action} must be allowlisted`);
    }
  });
});

test("10. 56-Repository Machine-Readable Manifest Integrity", async (t) => {
  await t.test("verifies all 56 repositories are cataloged with required fields", () => {
    const manifestPath = path.join(REPO_ROOT, "reports", "repository-integration-registry.json");
    assert.ok(fs.existsSync(manifestPath), "repository-integration-registry.json must exist");

    const content = fs.readFileSync(manifestPath, "utf-8");
    const registry = JSON.parse(content);

    assert.ok(Array.isArray(registry), "registry must be a JSON array");
    assert.equal(registry.length, 56, "Must contain exactly 56 repositories");

    const validStatuses = new Set([
      "INTEGRATED_VERIFIED",
      "INTEGRATED_PARTIAL",
      "REFERENCE_OR_SKILL_ONLY",
      "ADAPTER_ONLY",
      "CONFIGURED_UNVERIFIED",
      "BLOCKED_EXTERNAL_DEPENDENCY"
    ]);

    const seenRepos = new Set();

    for (const entry of registry) {
      assert.ok(entry.upstream, `Entry missing upstream identifier: ${JSON.stringify(entry)}`);
      assert.ok(!seenRepos.has(entry.upstream.toLowerCase()), `Duplicate upstream detected: ${entry.upstream}`);
      seenRepos.add(entry.upstream.toLowerCase());

      assert.ok(entry.id, `Missing id for ${entry.upstream}`);
      assert.ok(entry.license, `Missing license for ${entry.upstream}`);
      assert.ok(entry.upstreamCommit, `Missing upstreamCommit for ${entry.upstream}`);
      assert.ok(entry.integrationMode, `Missing integrationMode for ${entry.upstream}`);
      assert.ok(validStatuses.has(entry.status), `Invalid status ${entry.status} for ${entry.upstream}`);
      assert.ok(typeof entry.securityReview === "string", `Missing securityReview for ${entry.upstream}`);
      assert.ok(Array.isArray(entry.capabilities), `Missing capabilities array for ${entry.upstream}`);
      assert.ok(Array.isArray(entry.tests), `Missing tests array for ${entry.upstream}`);
    }
  });
});
