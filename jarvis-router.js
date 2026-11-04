import { ultronCore } from "./core/ultron-core.js";
import { evaluateNotificationWindow, loadNotificationPolicy } from "./system/notification-policy.js";
import { ultronAutonomy } from "./autonomy/ultron-autonomy.js";
import { genesisEngine } from "./genesis/genesis-engine.js";
import { forgeEngine } from "./forge/forge-engine.js";
import { RobotDigitalTwin, simToRealGate } from "./robotics/robot-digital-twin.js";
import {
  SIMREADY_ASSET_CATALOG,
  TRAINING_SCENARIOS,
  simReadyEngine,
  playbackEngine,
  hilBridge,
  simReadyCentralExplorer
} from "./robotics/simready-simulation-engine.js";
import { ultronVision } from "./vision/ultron-vision.js";
import { ultronEyesManager, SESSION_STATES } from "./vision/ultron-eyes-manager.js";
import { ultronCyberCore, CYBER_AGENTS } from "./security/cyber-core.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES, TARGET_TYPES } from "./security/target-authorization-gateway.js";
import { codeShield } from "./security/code-shield.js";
import { cyberWebAuditor } from "./security/cyber-web.js";
import { aiRedTeamEvaluator } from "./security/cyber-ai-redteam.js";
import { cyberIncidentAssistant } from "./security/cyber-incident.js";
import { nexusOrchestrator } from "./nexus/nexus-orchestrator.js";
import { ultronGuardian } from "./security/ultron-guardian.js";
import { ultronSentinel } from "./security/sentinel/ultron-sentinel.js";
import { hardwareAdapter } from "./security/sentinel/hardware-adapter.js";
import { humanInterface } from "./intelligence/human-interface.js";
import { ultronSelfEvolutionEngine } from "./self-improvement/self-evolution-engine.js";
import crypto from "node:crypto";
import { operatorAuthorizationService } from "./security/operator-authorization.js";
import { deviceHub, APPROVED_REMOTE_ACTIONS, APPROVED_REMOTE_APPS } from "./integrations/device-hub.js";
import { deviceWebSocketGateway } from "./integrations/device-websocket-gateway.js";
import { deviceNetworkingManager } from "./integrations/device-networking.js";
import { toolRegistry } from "./core/tool-registry.js";
import { autonomousOrchestrator } from "./core/autonomous-orchestrator.js";
/**
 * ULTRON AI — JARVIS × ULTRON Integration Router
 *
 * Exposes REST endpoints for the 12-Agent Orchestrator, Brain Router,
 * Voice Engine, Vision Engine, Computer Control, Device Hub,
 * Coding Sandbox, Smart Home, and Emergency Stop.
 */

import express from "express";
import { BrainRouter } from "./core/brain-router.js";
import { safePinnedFetch } from "./network-safety.js";
import { AgentOrchestrator } from "./agents/orchestrator.js";
import { JarvisVoiceEngine } from "./voice/voice-engine.js";
import { JarvisVisionEngine } from "./vision/vision-engine.js";
import { WindowsComputerControl } from "./system/computer-control.js";
import { ProductivitySuite } from "./integrations/productivity.js";
import { AUTONOMY_LEVELS, canExecuteAutonomously } from "./autonomy-policy.js";
import { hasEmployeeModelProvider } from "./features.js";
import { windowsAutomation } from "./system/windows-automation.js";
import { windowsSpeechDaemon } from "./voice/windows-speech-daemon.js";
import { kokoroEngine } from "./voice/kokoro-engine.js";
import { proactiveDaemon } from "./system/proactive-daemon.js";
import { screenObserver } from "./vision/screen-observer.js";
import { robotController } from "./robotics/robot-controller.js";
import { connectionController } from "./system/connection-controller.js";
import { knowledgeEngine } from "./knowledge/knowledge-engine.js";
import { cyberSecurityIntel } from "./security/cyber-intel.js";
import { geoIntelligence } from "./system/geo-intel.js";
import { telephonyGateway, CALLER_AUTH_STATUS } from "./telephony/telephony-gateway.js";
import { createTelephonyWebhookGuard } from "./telephony/webhook-security.js";
import { telephonyBrain } from "./telephony/telephony-brain.js";
import { windowsDesktopAgent } from "./system/windows-desktop-agent.js";
import { multiDeviceManager } from "./integrations/multi-device-manager.js";
import { remoteTaskOrchestrator } from "./system/remote-task-orchestrator.js";
import { systemControlAgent } from "./system/system-control-agent.js";
import { mediaDiscoveryEngine } from "./media/media-discovery-engine.js";
import { videoEditingEngine } from "./media/video-editing-engine.js";
import { imageStudioEngine } from "./media/image-studio-engine.js";
import { autonomousProductionOrchestrator } from "./media/autonomous-production-orchestrator.js";
import { createDshGodRouter } from "./integrations/dsh-god/management-api.js";
import { JarvisCapabilityBenchmark } from "./benchmarks/jarvis-capability-benchmark.js";
import { JarvisUltronCapabilityComparator } from "./benchmarks/jarvis-ultron-comparator.js";



const EMPLOYEE_ROLES = new Set(["gtm-engineer", "seo-aeo", "web-dev", "social-media", "ad-manager", "sales", "customer-satisfaction", "chief-of-staff"]);
const EMPLOYEE_MODES = new Set(["plan", "draft", "review", "report"]);

export function createJarvisRouter({
  env = process.env,
  requireSupabaseUser,
  supabaseRest,
  privilegedSupabaseRest = supabaseRest,
  logger = console,
  deviceHub: deviceHubInstance = deviceHub,
  authenticateDeviceToken = null,
  fetchImpl = safePinnedFetch
} = {}) {
  if (typeof requireSupabaseUser !== "function") {
    throw new TypeError("createJarvisRouter requires the authenticated Supabase user middleware.");
  }

  const ownerUserId = String(env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim();
  const requireTelephonyWebhook = createTelephonyWebhookGuard({ env });
  const configuredOwnerNumbers = String(env.ULTRON_OWNER_PHONE_NUMBERS || "")
    .split(",")
    .map(phone => telephonyGateway.normalizePhoneNumber(phone))
    .filter(Boolean);
  const invalidOwnerNumber = configuredOwnerNumbers.find(phone => !/^\+[1-9]\d{7,14}$/.test(phone));
  if (invalidOwnerNumber) {
    throw new Error("ULTRON_OWNER_PHONE_NUMBERS must contain only comma-separated E.164 phone numbers.");
  }
  const configuredTelephonyPin = String(env.ULTRON_TELEPHONY_PIN || "").trim();
  if (configuredTelephonyPin && !/^\d{4}$/.test(configuredTelephonyPin)) {
    throw new Error("ULTRON_TELEPHONY_PIN must be exactly four digits.");
  }
  telephonyGateway.ownerPhoneNumbers = new Set(configuredOwnerNumbers);
  telephonyGateway.securityPin = configuredTelephonyPin || null;
  const requireOwner = [
    requireSupabaseUser,
    (req, res, next) => {
      if (!ownerUserId) {
        return res.status(503).json({
          error: {
            code: "ULTRON_OWNER_NOT_CONFIGURED",
            message: "JARVIS routes remain disabled until the owner Supabase user ID is configured."
          }
        });
      }
      if (!req.supabaseUser?.id || req.supabaseUser.id !== ownerUserId) {
        return res.status(403).json({
          error: {
            code: "ULTRON_OWNER_ONLY",
            message: "This experimental JARVIS control surface is restricted to the configured ULTRON owner."
          }
        });
      }
      return next();
    }
  ];

  const extractDeviceBearerToken = (req) => {
    const xToken = req.headers["x-device-token"];
    if (xToken && typeof xToken === "string" && xToken.trim()) return xToken.trim();
    const auth = req.headers.authorization;
    if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
      return auth.slice(7).trim();
    }
    return null;
  };

  const authenticateOwnerOrDevice = async (req, res, next) => {
    const deviceToken = req.headers["x-device-token"] || (req.headers.authorization && (req.headers.authorization.startsWith("Bearer dev_tok_") || req.headers.authorization.startsWith("Bearer ultron_dev_")) ? req.headers.authorization.slice(7).trim() : null);
    if (deviceToken && typeof deviceToken === "string") {
      try {
        const pairedDevice = typeof authenticateDeviceToken === "function"
          ? await authenticateDeviceToken(deviceToken)
          : null;
        if (pairedDevice) {
          const hydratedDevice = deviceHubInstance.importPairedDevice({
            ...pairedDevice,
            authToken: deviceToken
          });
          if (!hydratedDevice) {
            return res.status(401).json({ error: { code: "INVALID_DEVICE_IDENTITY", message: "The verified device could not be loaded into the command runtime." } });
          }
          req.device = hydratedDevice;
          return next();
        }
      } catch (error) {
        logger.warn?.("Paired-device authentication failed", { name: error?.name || "Error" });
      }

      // The legacy process-local DeviceHub is deliberately disabled in production.
      // Use the persistent Supabase token-hash registry for newly paired devices.
      if (env.NODE_ENV !== "production" && env.ULTRON_ALLOW_LEGACY_DEVICEHUB_AUTH === "true") {
        const legacyDevice = deviceHubInstance.findDeviceByToken(deviceToken);
        if (legacyDevice) {
          req.device = legacyDevice;
          return next();
        }
      }

      // A single static desktop token is retained only as an explicit legacy
      // migration path. New devices must use the per-device stored token hash.
      if (env.ULTRON_DESKTOP_AGENT_TOKEN && deviceToken === env.ULTRON_DESKTOP_AGENT_TOKEN) {
        req.device = deviceHubInstance.importPairedDevice({
          id: "legacy-companion-device",
          ownerUserId,
          name: "Legacy Companion",
          platform: "windows",
          authToken: deviceToken
        }) || { id: "legacy-companion-device", name: "Legacy Companion", authToken: deviceToken };
        return next();
      }
      return res.status(401).json({
        error: {
          code: "INVALID_DEVICE_TOKEN",
          message: "The provided x-device-token is invalid, expired, or revoked. Re-pair this companion."
        }
      });
    }

    let idx = 0;
    const runMiddleware = () => {
      if (idx < requireOwner.length) {
        const mw = requireOwner[idx++];
        return mw(req, res, runMiddleware);
      }
      return next();
    };
    runMiddleware();
  };

  const router = express.Router();
  const brain = new BrainRouter({ env });
  const orchestrator = new AgentOrchestrator();
  const voice = new JarvisVoiceEngine();
  const vision = new JarvisVisionEngine();
  const computer = new WindowsComputerControl();
  const productivity = new ProductivitySuite();
  // Wire Telephony and Multi-Device Ecosystem
  telephonyBrain.windowsDesktopAgent = windowsDesktopAgent;
  telephonyBrain.multiDeviceManager = multiDeviceManager;
  telephonyBrain.remoteTaskOrchestrator = remoteTaskOrchestrator;
  remoteTaskOrchestrator.windowsDesktopAgent = windowsDesktopAgent;
  remoteTaskOrchestrator.multiDeviceManager = multiDeviceManager;
  remoteTaskOrchestrator.telephonyGateway = telephonyGateway;


  // --- JARVIS Capability Benchmark ---
  router.get("/jarvis/benchmark", requireOwner, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const benchmark = new JarvisCapabilityBenchmark();
      const evaluation = await benchmark.evaluate();
      res.json({
        status: "ok",
        evaluation
      });
    } catch (err) {
      res.status(500).json({
        error: {
          code: "BENCHMARK_EVALUATION_FAILED",
          message: err.message
        }
      });
    }
  });

  // --- JARVIS + ULTRON Capability Comparator ---
  router.get("/jarvis/comparator", requireOwner, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const comparator = new JarvisUltronCapabilityComparator();
      const evaluation = await comparator.evaluate();
      res.json({
        status: "ok",
        evaluation
      });
    } catch (err) {
      res.status(500).json({
        error: {
          code: "COMPARATOR_EVALUATION_FAILED",
          message: err.message
        }
      });
    }
  });

  // --- Complete Feature Visibility & Capabilities Inventory ---
  router.get("/jarvis/capabilities", requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(toolRegistry.getCapabilityInventory());
  });

  // --- Centralized Tool Registry ---
  router.get("/jarvis/tools", requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      tools: toolRegistry.listTools().map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        capabilities: t.capabilities,
        permissionLevel: t.permissionLevel,
        requiresConfirmation: t.requiresConfirmation,
        timeoutMs: t.timeoutMs,
        status: t.checkHealth()
      }))
    });
  });

  // --- Autonomous Tool Router & JARVIS Orchestration ---
  router.post("/jarvis/orchestrate", ...requireOwner, express.json(), async (req, res) => {
    try {
      const { prompt } = req.body || {};
      const requestedContext = req.body?.context && typeof req.body.context === "object" && !Array.isArray(req.body.context)
        ? req.body.context
        : {};
      // Trust identity only from the authenticated Supabase middleware. Never
      // accept body-supplied user IDs, admin flags, or pre-approval booleans.
      const context = {
        ...requestedContext,
        userId: req.supabaseUser.id,
        actorId: req.supabaseUser.id,
        isAdmin: false,
        trustedInternalAdmin: false,
        preApproved: false
      };
      const outcome = await autonomousOrchestrator.processUserRequest(prompt, context);
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/tools/:toolId/execute", ...requireOwner, express.json(), async (req, res) => {
    try {
      const { toolId } = req.params;
      const tool = toolRegistry.getTool(toolId);
      if (!tool) {
        return res.status(404).json({ success: false, error: `Tool '${toolId}' not found in registry.` });
      }
      if (autonomousOrchestrator.emergencyHalted) {
        return res.status(403).json({ success: false, error: "EMERGENCY_STOP_ACTIVE" });
      }
      if (tool.requiresConfirmation === true || Number(tool.permissionLevel) >= 3) {
        return res.status(403).json({
          success: false,
          error: "APPROVAL_REQUIRED",
          code: "APPROVAL_REQUIRED_USE_ORCHESTRATOR",
          permissionLevel: tool.permissionLevel,
          message: "Privileged actions must be requested through /jarvis/orchestrate and approved in the Permission Center. A request-body approved flag is never authorization."
        });
      }
      const userContext = { userId: req.supabaseUser.id, actorId: req.supabaseUser.id };
      const outcome = await toolRegistry.execute(toolId, req.body?.params || {}, userContext);
      res.json({ success: true, toolId, outcome });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // --- Permission Center: Human Approval Gates ---
  router.get("/jarvis/permissions/pending", ...requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ pending: autonomousOrchestrator.getPendingApprovals() });
  });

  router.post("/jarvis/permissions/approve", ...requireOwner, express.json(), (req, res) => {
    const { requestId } = req.body || {};
    const operatorContext = { userId: req.supabaseUser.id, isAdmin: false };
    const result = autonomousOrchestrator.approveRequest(requestId, operatorContext);
    if (!result.success) {
      if (result.error === "CROSS_USER_APPROVAL_DENIED") return res.status(403).json(result);
      if (result.error === "APPROVAL_NOT_FOUND") return res.status(404).json(result);
      return res.status(400).json(result);
    }
    res.json(result);
  });

  router.post("/jarvis/permissions/reject", ...requireOwner, express.json(), (req, res) => {
    const { requestId, reason } = req.body || {};
    const operatorContext = { userId: req.supabaseUser.id, isAdmin: false };
    const result = autonomousOrchestrator.rejectRequest(requestId, reason, operatorContext);
    if (!result.success) {
      if (result.error === "CROSS_USER_APPROVAL_DENIED") return res.status(403).json(result);
      if (result.error === "APPROVAL_NOT_FOUND") return res.status(404).json(result);
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // --- Autonomy Center & Emergency Controls ---
  router.get("/jarvis/autonomy/state", ...requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      autonomyLevel: autonomousOrchestrator.autonomyLevel,
      emergencyHalted: autonomousOrchestrator.emergencyHalted,
      pendingApprovalsCount: autonomousOrchestrator.getPendingApprovals().length,
      historyCount: autonomousOrchestrator.executionHistory.length,
      recentHistory: autonomousOrchestrator.getExecutionHistory(10)
    });
  });

  router.post("/jarvis/autonomy/emergency-stop", ...requireOwner, express.json(), (req, res) => {
    const reason = req.body?.reason || "Operator emergency stop invoked";
    const auth = { userId: req.supabaseUser.id };
    const result = autonomousOrchestrator.setEmergencyStop(true, reason, auth);
    res.json(result);
  });

  router.post("/jarvis/autonomy/emergency-reset", ...requireOwner, (req, res) => {
    const auth = { userId: req.supabaseUser.id };
    const result = autonomousOrchestrator.setEmergencyStop(false, "Operator reset", auth);
    res.json(result);
  });

  // --- Background Workflows & Real-Time Event Stream ---
  router.get("/jarvis/autonomy/workflows", ...requireOwner, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const userContext = { userId: req.supabaseUser.id, isAdmin: false };
    res.json({ workflows: autonomousOrchestrator.getActiveWorkflows(userContext) });
  });

  router.post("/jarvis/autonomy/workflow/submit", ...requireOwner, express.json(), (req, res) => {
    try {
      const { prompt } = req.body || {};
      const requestedContext = req.body?.context && typeof req.body.context === "object" && !Array.isArray(req.body.context)
        ? req.body.context
        : {};
      const context = {
        ...requestedContext,
        userId: req.supabaseUser.id,
        isAdmin: false,
        trustedInternalAdmin: false,
        preApproved: false
      };
      const result = autonomousOrchestrator.submitBackgroundTask(prompt, context);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/autonomy/workflow/pause", ...requireOwner, express.json(), (req, res) => {
    const { workflowId } = req.body || {};
    const userContext = { userId: req.supabaseUser.id, isAdmin: false };
    const result = autonomousOrchestrator.pauseWorkflow(workflowId, userContext);
    if (!result.success) {
      if (result.error === "CROSS_USER_ACCESS_DENIED") return res.status(403).json(result);
      if (result.error === "Workflow not found") return res.status(404).json(result);
      return res.status(400).json(result);
    }
    res.json(result);
  });

  router.post("/jarvis/autonomy/workflow/resume", ...requireOwner, express.json(), (req, res) => {
    const { workflowId } = req.body || {};
    const userContext = { userId: req.supabaseUser.id, isAdmin: false };
    const result = autonomousOrchestrator.resumeWorkflow(workflowId, userContext);
    if (!result.success) {
      if (result.error === "CROSS_USER_ACCESS_DENIED") return res.status(403).json(result);
      if (result.error === "Workflow not found") return res.status(404).json(result);
      return res.status(400).json(result);
    }
    res.json(result);
  });

  router.post("/jarvis/autonomy/workflow/cancel", ...requireOwner, express.json(), (req, res) => {
    const { workflowId, reason } = req.body || {};
    const userContext = { userId: req.supabaseUser.id, isAdmin: false };
    const result = autonomousOrchestrator.cancelWorkflow(workflowId, reason, userContext);
    if (!result.success) {
      if (result.error === "CROSS_USER_ACCESS_DENIED") return res.status(403).json(result);
      if (result.error === "Workflow not found") return res.status(404).json(result);
      return res.status(400).json(result);
    }
    res.json(result);
  });

  router.get("/jarvis/autonomy/events", ...requireOwner, (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write("event: ready\ndata: {}\n\n");
    const unsubscribe = autonomousOrchestrator.onEvent(evt => {
      try {
        res.write("event: " + evt.type + "\ndata: " + JSON.stringify(evt) + "\n\n");
      } catch {}
    });
    req.on("close", () => {
      unsubscribe();
    });
  });

  // --- System & Hardware Telemetry ---
  router.get("/jarvis/telemetry", requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const telemetry = computer.getSystemTelemetry();
    res.json({
      status: "ok",
      telemetry,
      autonomyLevel: orchestrator.getAutonomyLevel(),
      emergencyStop: orchestrator.isHalted()
    });
  });

  // --- Brain & Model Routing ---
  router.post("/jarvis/brain/classify", requireOwner, express.json(), (req, res) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const complexity = brain.classifyComplexity(prompt, req.body || {});
    const language = brain.detectLanguage(prompt);
    const chain = brain.selectProviderChain(complexity);

    res.json({
      prompt: prompt.slice(0, 100),
      complexity,
      language,
      providerChain: chain.map(p => ({ name: p.name, model: p.model, type: p.type })),
      emotionalIntelligence: complexity.emotionalIntelligence || null
    });
  });

  router.post("/jarvis/brain/infer", requireOwner, express.json(), async (req, res) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const context = typeof req.body?.context === "object" && req.body.context !== null ? req.body.context : {};
    const preferredProvider = typeof req.body?.preferredProvider === "string" ? req.body.preferredProvider : null;

    if (!prompt.trim() && messages.length === 0) {
      return res.status(400).json({
        error: {
          code: "INVALID_INFERENCE_INPUT",
          message: "Provide either a prompt string or a non-empty messages array."
        }
      });
    }

    try {
      const result = await brain.executeInference({
        prompt,
        messages,
        context,
        preferredProvider,
        fetchImpl
      });
      res.json({
        status: "ok",
        inference: result
      });
    } catch (err) {
      res.status(502).json({
        error: {
          code: "BRAIN_INFERENCE_FAILED",
          message: err?.message || "Brain inference failed across all providers."
        }
      });
    }
  });

  // --- Human Emotional Intelligence (HEI) Control Routes ---
  router.get("/jarvis/hei/status", requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(brain.hei.getStatus());
  });

  router.post("/jarvis/hei/analyze", requireOwner, express.json(), (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const result = brain.hei.processUtterance(text, req.body || {});
    res.json(result);
  });

  router.get("/jarvis/hei/preferences", requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ preferences: brain.hei.getPreferences() });
  });

  router.post("/jarvis/hei/preferences", requireOwner, express.json(), (req, res) => {
    const updated = brain.hei.updatePreferences(req.body || {});
    res.json({ ok: true, preferences: updated });
  });

  router.post("/jarvis/hei/clear-context", requireOwner, (_req, res) => {
    const result = brain.hei.clearContext();
    res.json({ ok: true, ...result });
  });

  router.post("/jarvis/hei/delete-memory", requireOwner, (_req, res) => {
    const result = brain.hei.deleteMemory();
    res.json({ ok: true, ...result });
  });

  router.get("/jarvis/brain/health", requireOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ health: brain.getHealthSummary() });
  });

  // --- 12-Agent Catalog & Orchestration ---
  router.get("/jarvis/agents", requireOwner, (_req, res) => {
    const list = Array.from(orchestrator.agents.values()).map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      allowedTools: a.allowedTools,
      maxConcurrency: a.maxConcurrency,
      autonomyThreshold: a.autonomyLevelThreshold
    }));

    res.json({
      agents: list,
      currentAutonomyLevel: orchestrator.getAutonomyLevel(),
      emergencyStopActive: orchestrator.isHalted(),
      taskExecution: {
        backend: "durable_supabase_worker",
        supportedRoles: Array.from(EMPLOYEE_ROLES),
        supportedModes: Array.from(EMPLOYEE_MODES),
        note: "The 18-agent catalogue is capability metadata. The durable task endpoint currently executes supported AI Employee plan/draft/review/report roles; it does not dispatch arbitrary per-agent tool steps."
      }
    });
  });

  router.post("/jarvis/agents/task", requireOwner, express.json(), async (req, res) => {
    if (orchestrator.isHalted()) {
      return res.status(409).json({ error: { code: "JARVIS_EMERGENCY_STOP_ACTIVE", message: "JARVIS task creation is blocked by the local emergency stop." } });
    }
    if (env.ULTRON_EMPLOYEES_ENABLED !== "true" || !env.SUPABASE_SERVICE_ROLE_KEY || !hasEmployeeModelProvider(env)) {
      return res.status(503).json({
        error: {
          code: "JARVIS_WORKER_NOT_READY",
          message: "The durable worker, server-side Supabase key, and at least one supported server-side model provider must be configured before JARVIS can queue background work."
        }
      });
    }
    if (typeof supabaseRest !== "function" || !req.supabaseUser?.id) {
      return res.status(503).json({ error: { code: "JARVIS_TASK_STORAGE_UNAVAILABLE", message: "Authenticated durable task storage is unavailable." } });
    }

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const allowedFields = new Set(["goal", "role", "mode", "context"]);
    if (Object.keys(body).some(key => !allowedFields.has(key))) {
      return res.status(400).json({ error: { code: "JARVIS_TASK_FIELDS_NOT_ALLOWED", message: "Only goal, role, mode, and context are accepted. Arbitrary steps, tools, and executor arguments are not supported." } });
    }

    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "chief-of-staff";
    const mode = typeof body.mode === "string" ? body.mode.trim() : "plan";
    const context = typeof body.context === "string" ? body.context.trim() : "";
    if (goal.length < 2 || goal.length > 2000 || context.length > 4000 || !EMPLOYEE_ROLES.has(role) || !EMPLOYEE_MODES.has(mode)) {
      return res.status(400).json({ error: { code: "INVALID_JARVIS_EMPLOYEE_TASK", message: "Choose a supported employee role and mode, provide a 2–2000 character goal, and keep context within 4000 characters." } });
    }

    const autonomousWorkflow = /\b(research|investigate|look into|find sources)\b/i.test(goal)
      && /\b(report|summary|recommendations|brief)\b/i.test(goal);
    const taskInput = {
      taskType: autonomousWorkflow ? "autonomous" : "employee",
      executionMode: "employee_worker",
      role,
      goal,
      context,
      mode: autonomousWorkflow ? "report" : mode,
      requiresApproval: false,
      approved: true,
      createdBy: "jarvis_router"
    };

    try {
      const rows = await supabaseRest(req, "agent_tasks", "POST", "?select=id,title,status,created_at", {
        user_id: req.supabaseUser.id,
        title: goal.slice(0, 240),
        input: taskInput,
        status: "QUEUED"
      });
      if (!Array.isArray(rows) || !rows[0]?.id) {
        return res.status(502).json({ error: { code: "JARVIS_TASK_CREATE_FAILED", message: "The durable task queue did not return a task ID." } });
      }

      let auditRecorded = true;
      try {
        if (typeof privilegedSupabaseRest !== "function") throw new Error("Privileged audit storage is unavailable.");
        await privilegedSupabaseRest(req, "audit_events", "POST", "", {
          user_id: req.supabaseUser.id,
          action: "jarvis.task_queued",
          target_type: "agent_task",
          target_id: rows[0].id,
          outcome: "allowed",
          metadata: { role, mode: autonomousWorkflow ? "autonomous_report" : mode, taskType: taskInput.taskType, executionMode: "employee_worker" }
        }, "return=minimal");
      } catch (error) {
        auditRecorded = false;
        logger.warn?.("JARVIS task audit write failed", { name: error?.name || "Error" });
      }

      return res.status(202).json({
        success: true,
        task: rows[0],
        auditRecorded,
        execution: {
          backend: "durable_supabase_worker",
          type: autonomousWorkflow ? "bounded_research_to_report" : "ai_employee_draft_only",
          notice: "The task is queued, not completed. The worker must process it before a result is available. This endpoint does not publish, spend, contact people, change external systems, control devices, or execute code."
        }
      });
    } catch (error) {
      logger.warn?.("JARVIS durable task enqueue failed", { name: error?.name || "Error" });
      return res.status(503).json({ error: { code: "JARVIS_TASK_STORAGE_FAILED", message: "The durable task queue could not accept this task." } });
    }
  });

  router.get("/jarvis/agents/tasks/:id", requireOwner, async (req, res) => {
    if (typeof supabaseRest !== "function" || !req.supabaseUser?.id) {
      return res.status(503).json({ error: { code: "JARVIS_TASK_STORAGE_UNAVAILABLE", message: "Authenticated durable task storage is unavailable." } });
    }
    try {
      const rows = await supabaseRest(req, "agent_tasks", "GET",
        "?select=id,title,status,result,error_code,created_at,updated_at,finished_at&user_id=eq." + encodeURIComponent(req.supabaseUser.id)
        + "&id=eq." + encodeURIComponent(req.params.id) + "&limit=1");
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ error: { message: "Task not found" } });
      return res.json({ task: rows[0], executionBackend: "durable_supabase_worker" });
    } catch (error) {
      logger.warn?.("JARVIS task lookup failed", { name: error?.name || "Error" });
      return res.status(503).json({ error: { code: "JARVIS_TASK_LOOKUP_FAILED", message: "The durable task could not be read." } });
    }
  });

  router.get("/jarvis/agents/tasks", requireOwner, async (req, res) => {
    if (typeof supabaseRest !== "function" || !req.supabaseUser?.id) {
      return res.status(503).json({ error: { code: "JARVIS_TASK_STORAGE_UNAVAILABLE", message: "Authenticated durable task storage is unavailable." } });
    }
    try {
      const rows = await supabaseRest(req, "agent_tasks", "GET",
        "?select=id,title,status,error_code,created_at,updated_at,finished_at&user_id=eq." + encodeURIComponent(req.supabaseUser.id)
        + "&order=created_at.desc&limit=25");
      return res.json({ tasks: Array.isArray(rows) ? rows : [], executionBackend: "durable_supabase_worker" });
    } catch (error) {
      logger.warn?.("JARVIS task list failed", { name: error?.name || "Error" });
      return res.status(503).json({ error: { code: "JARVIS_TASK_LIST_FAILED", message: "Durable tasks could not be listed." } });
    }
  });

  // --- Emergency Stop / Global Kill Switch ---
  router.post("/jarvis/emergency/stop", requireOwner, express.json(), async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "Emergency kill switch invoked via console";
    const result = orchestrator.emergencyStop(reason);
    computer.setEmergencyStop(true);
    if (typeof supabaseRest !== "function") {
      return res.status(503).json({
        success: false,
        halted: true,
        scope: "this_server_process_only",
        error: { code: "JARVIS_DURABLE_CANCEL_UNAVAILABLE", message: "The local JARVIS API is halted, but durable worker tasks could not be cancelled because authenticated task storage is unavailable." }
      });
    }
    try {
      const cancelled = await supabaseRest(req, "agent_tasks", "PATCH",
        "?user_id=eq." + encodeURIComponent(req.supabaseUser.id) + "&status=in.(QUEUED,RUNNING,WAITING_FOR_PERMISSION)&select=id,status",
        { status: "CANCELLED" });
      return res.json({
        success: true,
        halted: true,
        scope: "authenticated_account_tasks_and_this_server_process",
        cancelledTaskIds: Array.isArray(cancelled) ? cancelled.map(task => task.id).filter(Boolean) : [],
        result
      });
    } catch (error) {
      logger.warn?.("JARVIS emergency task cancellation failed", { name: error?.name || "Error" });
      return res.status(503).json({
        success: false,
        halted: true,
        scope: "this_server_process_only",
        error: { code: "JARVIS_DURABLE_CANCEL_FAILED", message: "The local JARVIS API is halted, but durable worker task cancellation failed. Check task status before resuming." }
      });
    }
  });

  router.post("/jarvis/emergency/reset", requireOwner, (_req, res) => {
    orchestrator.resetEmergencyStop();
    computer.setEmergencyStop(false);
    res.json({ success: true, halted: false, scope: "this_server_process_only" });
  });

  router.post("/jarvis/autonomy/level", requireOwner, express.json(), (req, res) => {
    const level = Number(req.body?.level);
    const success = orchestrator.setAutonomyLevel(level);
    if (!success) return res.status(400).json({ error: { message: "Invalid autonomy level (0-5 required)." } });
    res.json({ success: true, autonomyLevel: orchestrator.getAutonomyLevel(), scope: "this_server_process_only", config: AUTONOMY_LEVELS[level] });
  });

  // --- Coding Sandbox ---
  // Never execute user-provided source in a normal Node child process.
  // The endpoint remains explicit-but-disabled until a separately provisioned,
  // digest-pinned container runtime passes host isolation checks.
  router.post("/jarvis/sandbox/run", requireOwner, express.json(), (_req, res) => {
    res.status(503).json({
      error: {
        code: "CODE_SANDBOX_NOT_AVAILABLE",
        message: "Code execution is disabled. A normal Node child process is not a security sandbox."
      }
    });
  });

  // --- Voice Engine ---
  router.get("/jarvis/voice/profile", requireOwner, (_req, res) => {
    res.json({ currentProfile: voice.getProfile() });
  });

  router.post("/jarvis/voice/profile", requireOwner, express.json(), (req, res) => {
    const profileId = req.body?.profileId;
    const result = voice.setProfile(profileId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  router.post("/jarvis/voice/format", requireOwner, express.json(), (req, res) => {
    const text = req.body?.text || "";
    const spoken = voice.formatSpokenUpdate(text);
    res.json({ raw: text, spokenText: spoken });
  });

  router.post("/jarvis/voice/wakeword", requireOwner, express.json(), (req, res) => {
    const phrase = req.body?.phrase || "";
    const result = voice.processWakeWord(phrase);
    res.json(result);
  });

  // --- Vision Engine ---
  router.post("/jarvis/vision/validate", requireOwner, express.json(), (req, res) => {
    const result = vision.validateImageInput(req.body);
    res.json(result);
  });

  // --- Multi-Device Hub & Companion Pairing ---
  router.post("/jarvis/devices/pair/request", express.json(), (req, res) => {
    const isPairingEnabled = (env.ULTRON_DEVICE_PAIRING_ENABLED === "true" || Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN)) && deviceHubInstance.isPersistent;
    if (!isPairingEnabled) {
      return res.status(503).json({
        error: {
          code: "DEVICE_PAIRING_NOT_CONFIGURED",
          message: "Physical companion pairing is not available until a persistent, authenticated device protocol is connected."
        }
      });
    }
    const { deviceName = "Companion Device", platform = "windows" } = req.body || {};
    const pairing = deviceHubInstance.createPairingCode({ name: deviceName, platform });
    res.json({
      success: true,
      pairingCode: pairing.code,
      expiresAt: pairing.expiresAt,
      deviceName: pairing.deviceName
    });
  });

  router.post("/jarvis/devices/pair/approve", requireOwner, express.json(), (req, res) => {
    const pairingReady = (env.ULTRON_DEVICE_PAIRING_ENABLED === "true" || Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN)) && deviceHubInstance.isPersistent;
    if (!pairingReady) return res.status(503).json({ error: { code: "DEVICE_PAIRING_NOT_DURABLE", message: "Configure ULTRON_DEVICE_STORE_PATH and a dedicated ULTRON_DEVICE_SIGNING_SECRET (32+ characters) before pairing devices." } });
    const { pairingCode } = req.body || {};
    if (!pairingCode) {
      return res.status(400).json({ error: { code: "MISSING_PAIRING_CODE", message: "Pairing code is required." } });
    }
    const approved = deviceHubInstance.approvePairingCode(pairingCode, req.supabaseUser?.id);
    if (!approved.success) {
      return res.status(400).json({ error: { code: approved.error, message: `Pairing failed: ${approved.error}` } });
    }
    res.json(approved);
  });

  router.post("/jarvis/devices/pair/claim", express.json(), (req, res) => {
    const pairingReady = (env.ULTRON_DEVICE_PAIRING_ENABLED === "true" || Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN)) && deviceHubInstance.isPersistent;
    if (!pairingReady) return res.status(503).json({ error: { code: "DEVICE_PAIRING_NOT_DURABLE", message: "Device pairing is unavailable until durable storage and its encryption secret are configured." } });
    const { pairingCode } = req.body || {};
    if (!pairingCode) {
      return res.status(400).json({ error: { code: "MISSING_PAIRING_CODE", message: "Pairing code is required." } });
    }
    const claimed = deviceHubInstance.claimPairingCode(pairingCode);
    if (!claimed.success) {
      const status = claimed.error === "PAIRING_NOT_YET_APPROVED" ? 409 : 400;
      return res.status(status).json({ error: { code: claimed.error, message: `Claim failed: ${claimed.error}` } });
    }
    res.json(claimed);
  });

  router.post("/jarvis/devices/pair/verify", requireOwner, express.json(), (req, res) => {
    const isPairingEnabled = (env.ULTRON_DEVICE_PAIRING_ENABLED === "true" || Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN)) && deviceHubInstance.isPersistent;
    if (!isPairingEnabled) {
      return res.status(503).json({
        error: {
          code: "DEVICE_PAIRING_NOT_CONFIGURED",
          message: "Physical companion pairing is not available until a persistent, authenticated device protocol is connected."
        }
      });
    }
    const { pairingCode } = req.body || {};
    const verified = deviceHubInstance.verifyPairingCode(pairingCode, null, req.supabaseUser?.id);
    if (!verified.success) {
      return res.status(400).json({ error: { code: verified.error, message: "Verification failed." } });
    }
    res.json(verified);
  });

  // --- Multi-Device QR Pairing & Cross-Device Routing ---
  router.post("/jarvis/devices/pair/qr", requireOwner, express.json(), (req, res) => {
    const isPairingEnabled = (env.ULTRON_DEVICE_PAIRING_ENABLED === "true" || Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN)) && deviceHubInstance.isPersistent;
    if (!isPairingEnabled) {
      return res.status(503).json({ error: { code: "DEVICE_PAIRING_NOT_DURABLE", message: "Device pairing is not configured for durable storage." } });
    }
    const baseUrl = req.protocol + "://" + (req.get("host") || "localhost:10000");
    const qrData = deviceHubInstance.generatePairingQr(req.body || {}, baseUrl);
    res.json(qrData);
  });

  router.post("/jarvis/devices/route-command", authenticateOwnerOrDevice, express.json(), (req, res) => {
    const { targetDeviceId, targetPlatform, action, payload, idempotencyKey } = req.body || {};
    if (!action) {
      return res.status(400).json({ error: { code: "INVALID_ACTION", message: "Command action is required." } });
    }

    const outcome = deviceHubInstance.routeCommand({
      callerDeviceId: req.device?.id || null,
      callerToken: extractDeviceBearerToken(req),
      callerUserId: req.supabaseUser?.id || req.device?.ownerUserId || "operator",
      targetDeviceId,
      targetPlatform: targetPlatform || (targetDeviceId ? null : "windows"),
      action,
      payload: payload || {},
      idempotencyKey: idempotencyKey || null
    });

    if (!outcome.success) {
      const status = outcome.error === "TARGET_DEVICE_OFFLINE" ? 409
        : ["ACTION_NOT_APPROVED", "ACCESS_DENIED_NOT_DEVICE_OWNER"].includes(outcome.error) ? 403 : 400;
      return res.status(status).json({ error: { code: outcome.error, message: outcome.message }, ...outcome });
    }
    res.json(outcome);
  });

  router.post("/jarvis/devices/my/heartbeat", authenticateOwnerOrDevice, express.json(), (req, res) => {
    if (!req.device?.id || !req.device?.authToken) {
      return res.status(401).json({ error: { code: "DEVICE_AUTHENTICATION_REQUIRED", message: "A verified paired device is required." } });
    }
    const outcome = deviceHubInstance.heartbeat(req.device.id, req.device.authToken, req.body || {});
    if (!outcome.success) {
      return res.status(401).json({ error: { code: outcome.error, message: "Heartbeat authentication failed." } });
    }
    res.json(outcome);
  });

  router.post("/jarvis/devices/:id/heartbeat", authenticateOwnerOrDevice, express.json(), (req, res) => {
    const deviceId = req.params.id;
    if (!req.device?.id || req.device.id !== deviceId) {
      return res.status(403).json({ error: { code: "DEVICE_ID_MISMATCH", message: "A device may only send its own heartbeat." } });
    }
    const token = req.device.authToken;
    if (!token) {
      return res.status(401).json({ error: { code: "DEVICE_TOKEN_REQUIRED", message: "Device bearer token required via header." } });
    }
    const outcome = deviceHubInstance.heartbeat(deviceId, token, req.body || {});
    if (!outcome.success) {
      return res.status(401).json({ error: { code: outcome.error, message: "Heartbeat authentication failed." } });
    }
    res.json(outcome);
  });

  router.get("/jarvis/devices/:id/presence", authenticateOwnerOrDevice, (req, res) => {
    const requesterOwnerId = req.device?.ownerUserId || req.supabaseUser?.id;
    const targetDevice = deviceHubInstance.pairedDevices.get(req.params.id);
    if (!requesterOwnerId || !targetDevice || targetDevice.ownerUserId !== requesterOwnerId) {
      return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "Device not found for this account." } });
    }
    const presence = deviceHubInstance.getDevicePresence(req.params.id);
    if (!presence.exists) {
      return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "Device not found." } });
    }
    res.json(presence);
  });

  router.get("/jarvis/devices/:id/events", authenticateOwnerOrDevice, (req, res) => {
    const deviceId = req.params.id;
    if (!req.device?.id || req.device.id !== deviceId) {
      return res.status(403).json({ error: { code: "DEVICE_ID_MISMATCH", message: "A device may only subscribe to its own event stream." } });
    }
    deviceWebSocketGateway.handleSseConnection(req, res, deviceId, req.device.authToken);
  });

  router.get("/jarvis/devices/tasks", authenticateOwnerOrDevice, (req, res) => {
    const ownerId = req.device?.ownerUserId || req.supabaseUser?.id;
    if (!ownerId) return res.status(401).json({ error: { code: "OWNER_IDENTITY_REQUIRED", message: "A verified owner or paired device is required." } });
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const tasks = deviceHubInstance.getSharedTasks(limit, { ownerUserId: ownerId });
    res.json({ success: true, count: tasks.length, tasks });
  });

  router.get("/jarvis/network/connectivity", requireOwner, (_req, res) => {
    res.json(deviceNetworkingManager.getConnectivityStatus());
  });

  router.get("/jarvis/network/discovery", requireOwner, (_req, res) => {
    res.json(deviceNetworkingManager.getLocalDiscoveryBeacon());
  });

  router.get("/jarvis/devices", requireOwner, (req, res) => {
    const isPairingEnabled = (env.ULTRON_DEVICE_PAIRING_ENABLED === "true" || Boolean(env.ULTRON_DESKTOP_AGENT_TOKEN)) && deviceHubInstance.isPersistent;
    if (!isPairingEnabled) {
      return res.json({ devices: [], connected: false, status: "NOT_CONFIGURED" });
    }
    const ownerId = req.supabaseUser?.id;
    if (!ownerId) return res.status(401).json({ error: { code: "OWNER_IDENTITY_REQUIRED", message: "A verified owner identity is required." } });
    const devices = deviceHubInstance.listPairedDevices(ownerId);
    res.json({ devices, connected: devices.length > 0, status: devices.length > 0 ? "CONFIGURED" : "READY" });
  });

  router.post("/jarvis/devices/:id/revoke", requireOwner, (req, res) => {
    const deviceId = req.params.id;
    const result = deviceHubInstance.revokeDevice(deviceId, req.supabaseUser?.id);
    if (!result.success) {
      const status = result.error === "DEVICE_NOT_FOUND" ? 404 : 403;
      return res.status(status).json({
        error: {
          code: result.error,
          message: `Device revocation failed: ${result.error}`
        }
      });
    }
    res.json(result);
  });

  router.delete("/jarvis/devices/:id", requireOwner, (req, res) => {
    const deviceId = req.params.id;
    const device = deviceHubInstance.pairedDevices.get(deviceId);
    if (!device) {
      return res.status(404).json({
        error: {
          code: "DEVICE_NOT_FOUND",
          message: "Device not found."
        }
      });
    }
    if (req.supabaseUser?.id && device.ownerUserId && device.ownerUserId !== req.supabaseUser.id) {
      return res.status(403).json({
        error: {
          code: "ACCESS_DENIED_NOT_DEVICE_OWNER",
          message: "Access denied: not device owner."
        }
      });
    }
    const result = deviceHubInstance.unpairDevice(deviceId);
    res.json(result);
  });

  router.post("/jarvis/devices/:id/rotate-token", requireOwner, (req, res) => {
    const deviceId = req.params.id;
    const result = deviceHubInstance.rotateDeviceToken(deviceId, req.supabaseUser?.id);
    if (!result.success) {
      const status = result.error === "DEVICE_NOT_FOUND" ? 404 : 403;
      return res.status(status).json({
        error: {
          code: result.error,
          message: `Token rotation failed: ${result.error}`
        }
      });
    }
    res.json(result);
  });

  router.post("/jarvis/devices/:id/command", requireOwner, express.json(), (req, res) => {
    const deviceId = req.params.id;
    const { action, payload } = req.body || {};
    if (!action || typeof action !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_ACTION",
          message: "Command action is required and must be a non-empty string."
        }
      });
    }
    const normalizedAction = action.trim().toLowerCase();
    if (!APPROVED_REMOTE_ACTIONS.has(normalizedAction)) {
      return res.status(403).json({
        error: {
          code: "REMOTE_ACTION_NOT_APPROVED",
          message: "The requested remote action is not in ULTRON's approved action set."
        }
      });
    }
    const safePayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    if (["launch_app", "close_app"].includes(normalizedAction)) {
      const app = String(safePayload.app || safePayload.appKey || safePayload.name || "").trim().toLowerCase();
      if (!APPROVED_REMOTE_APPS.has(app)) {
        return res.status(403).json({
          error: {
            code: "REMOTE_APP_NOT_APPROVED",
            message: "The requested application is not in ULTRON's approved application set."
          }
        });
      }
    }
    const device = deviceHubInstance.pairedDevices.get(deviceId);
    if (!device) {
      return res.status(404).json({
        error: {
          code: "DEVICE_NOT_FOUND",
          message: "Device not found."
        }
      });
    }
    if (req.supabaseUser?.id && device.ownerUserId && device.ownerUserId !== req.supabaseUser.id) {
      return res.status(403).json({
        error: {
          code: "ACCESS_DENIED_NOT_DEVICE_OWNER",
          message: "Access denied: not device owner."
        }
      });
    }
    const result = deviceHubInstance.enqueueCommand(deviceId, normalizedAction, safePayload);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: result.error,
          message: `Failed to enqueue command: ${result.error}`
        }
      });
    }
    res.json(result);
  });

  router.get("/jarvis/devices/:id/commands/pending", authenticateOwnerOrDevice, (req, res) => {
    const deviceId = req.params.id;
    const token = req.device?.authToken;
    if (req.device?.id !== deviceId) {
      return res.status(403).json({ error: { code: "DEVICE_ID_MISMATCH", message: "A device may only poll its own command queue." } });
    }
    if (!token) {
      return res.status(401).json({
        error: {
          code: "DEVICE_TOKEN_REQUIRED",
          message: "Device bearer token required via x-device-token or Bearer authorization header."
        }
      });
    }
    const result = deviceHubInstance.pollPendingCommands(deviceId, token);
    if (!result.success) {
      return res.status(401).json({
        error: {
          code: result.error,
          message: `Polling failed: ${result.error}`
        }
      });
    }
    res.json(result);
  });

  router.post("/jarvis/devices/:id/commands/:cmdId/complete", authenticateOwnerOrDevice, express.json(), (req, res) => {
    const { id: deviceId, cmdId } = req.params;
    const token = req.device?.authToken;
    if (req.device?.id !== deviceId) {
      return res.status(403).json({ error: { code: "DEVICE_ID_MISMATCH", message: "A device may only complete its own commands." } });
    }
    if (!token) {
      return res.status(401).json({
        error: {
          code: "DEVICE_TOKEN_REQUIRED",
          message: "Device bearer token required via x-device-token or Bearer authorization header."
        }
      });
    }
    const result = deviceHubInstance.completeCommand(deviceId, cmdId, token, req.body || {});
    if (!result.success) {
      const status = result.error === "AUTHENTICATION_FAILED" ? 401 : result.error === "COMMAND_NOT_FOUND" ? 404 : 400;
      return res.status(status).json({
        error: {
          code: result.error,
          message: `Command completion failed: ${result.error}`
        }
      });
    }
    res.json(result);
  });

  router.post("/jarvis/devices/:id/telemetry", authenticateOwnerOrDevice, express.json(), (req, res) => {
    const deviceId = req.params.id;
    const token = req.device?.authToken;
    if (req.device?.id !== deviceId) {
      return res.status(403).json({ error: { code: "DEVICE_ID_MISMATCH", message: "A device may only update its own telemetry." } });
    }
    if (!token) {
      return res.status(401).json({
        error: {
          code: "DEVICE_TOKEN_REQUIRED",
          message: "Device bearer token required via x-device-token or Bearer authorization header."
        }
      });
    }
    const device = deviceHubInstance.authenticateDevice(deviceId, token);
    if (!device) {
      return res.status(401).json({
        error: {
          code: "AUTHENTICATION_FAILED",
          message: "Device authentication failed."
        }
      });
    }
    const updated = deviceHubInstance.updateDeviceTelemetry(deviceId, req.body || {});
    res.json({ success: updated, deviceId });
  });

  router.post("/jarvis/notifications", requireOwner, express.json(), (req, res) => {
    const ownerId = req.supabaseUser?.id;
    if (!ownerId) return res.status(401).json({ error: { code: "OWNER_IDENTITY_REQUIRED", message: "A verified owner identity is required." } });
    const devices = deviceHubInstance.listPairedDevices(ownerId);
    if (!devices.length) {
      return res.status(503).json({
        error: {
          code: "DEVICE_NOT_CONNECTED",
          message: "No physical companion notification transport is configured."
        }
      });
    }
    const { deviceId, title, body, priority, type } = req.body || {};
    if (deviceId && !devices.some(device => device.id === deviceId)) {
      return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "Device not found for this ULTRON account." } });
    }
    if (!title || !body) {
      return res.status(400).json({
        error: {
          code: "MISSING_NOTIFICATION_CONTENT",
          message: "Title and body are required to dispatch a companion notification."
        }
      });
    }
    // Owner-controlled quiet hours: non-urgent proactive notifications inside
    // the configured window are rejected with an explicit, actionable status
    // (never silently dropped); urgent priorities may bypass when allowed.
    const windowDecision = evaluateNotificationWindow({
      policy: loadNotificationPolicy(env),
      priority
    });
    if (!windowDecision.allowed) {
      return res.status(409).json({
        error: {
          code: "QUIET_HOURS_ACTIVE",
          message: "Proactive notification deferred by owner-configured quiet hours. Re-dispatch after the window ends or send with an urgent priority if a bypass is allowed.",
          quietWindow: windowDecision.quietWindow
        }
      });
    }
    const notification = deviceHubInstance.sendNotification({ ownerUserId: ownerId, deviceId, title, body, priority, type });
    res.json({ success: true, notification, windowDecision });
  });

  router.get("/jarvis/notifications", requireOwner, (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const ownerId = req.supabaseUser?.id;
    if (!ownerId) return res.status(401).json({ error: { code: "OWNER_IDENTITY_REQUIRED", message: "A verified owner identity is required." } });
    res.json({ success: true, notifications: deviceHubInstance.getNotifications(limit, { ownerUserId: ownerId }) });
  });

  // --- Smart Home ---
  router.get("/jarvis/smarthome/devices", requireOwner, (_req, res) => {
    res.json({ entities: [], connected: false, status: "NOT_CONFIGURED" });
  });

  router.post("/jarvis/smarthome/actuate", requireOwner, (_req, res) => {
    res.status(503).json({
      error: {
        code: "SMART_HOME_NOT_CONFIGURED",
        message: "No real smart-home bridge is connected. Demo entities and client-supplied approval flags are not accepted."
      }
    });
  });

  // --- Productivity ---
  router.get("/jarvis/productivity/briefing", requireOwner, (_req, res) => {
    const telemetry = computer.getSystemTelemetry();
    const briefing = productivity.generateDailyBriefing({ telemetry });
    res.json({ briefing });
  });

  router.post("/jarvis/productivity/reminders", requireOwner, express.json(), (req, res) => {
    try {
      const rem = productivity.addReminder(req.body || {});
      res.status(201).json({ ...rem, persistence: "process_memory_only" });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/productivity/reminders", requireOwner, (_req, res) => {
    res.json({ reminders: productivity.listReminders(), persistence: "process_memory_only" });
  });

  // --- Audit Trail ---
  router.get("/jarvis/audit", requireOwner, (_req, res) => {
    res.json({ logs: orchestrator.getAuditLogs() });
  });

  // --- Windows Native Speech & Voice Daemon ---
  router.post("/jarvis/voice/speak", requireOwner, express.json(), async (req, res) => {
    const { text, rate, volume } = req.body || {};
    const result = await windowsSpeechDaemon.speak(text, { rate, volume });
    res.json(result);
  });

  router.post("/jarvis/voice/offline-intent", requireOwner, express.json(), (req, res) => {
    const { utterance } = req.body || {};
    const match = windowsSpeechDaemon.matchOfflineIntent(utterance);
    res.json(match);
  });

  // --- Kokoro am_onyx Speech Synthesis ---
  router.post("/jarvis/voice/kokoro", requireOwner, express.json(), async (req, res) => {
    const { text, voice, speed, play } = req.body || {};
    try {
      const result = await kokoroEngine.synthesize(text, { voice, speed, play });
      if (result.speechAvailable !== true || result.audioKind !== "speech") {
        return res.status(503).json({
          error: {
            code: "KOKORO_SPEECH_UNAVAILABLE",
            message: "Kokoro produced diagnostic fallback audio, not intelligible speech. Configure the local ONNX runtime and model files.",
            audioKind: result.audioKind || "unknown"
          }
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/voice/interrupt", requireOwner, (_req, res) => {
    const result = kokoroEngine.interrupt();
    res.json(result);
  });

  // --- Global Voice Command Dispatcher & Autonomous Processor ---
  router.post("/jarvis/voice/process-command", authenticateOwnerOrDevice, express.json(), async (req, res) => {
    try {
      const { command, language = "en", source = "companion" } = req.body || {};
      const raw = String(command || "").trim();
      if (!raw) {
        return res.status(400).json({ error: { message: "Command text is required." } });
      }

      const lower = raw.toLowerCase();
      const detectedLang = brain.detectLanguage ? brain.detectLanguage(raw) : language;

      // 1. Evolution / Self-Improvement Intent
      if (lower.includes("audit") || lower.includes("upgrade") || lower.includes("evolve") || lower.includes("weakness") || lower.includes("improve yourself")) {
        const evoResult = await ultronSelfEvolutionEngine.processEvolutionCommand(raw, { source, language: detectedLang });
        return res.json({
          success: true,
          intent: evoResult.intent,
          textResponse: evoResult.message,
          actionTaken: evoResult.status || "EVOLUTION_PROCESSED",
          language: detectedLang,
          result: evoResult
        });
      }

      // 1.4. Mobile Device Autonomy Intent (Phone / Android)
      const isMobileRequest = /\b(on (?:my )?phone|on (?:my )?android|on (?:my )?mobile|phone screenshot|capture phone screen)\b/i.test(lower) ||
        (/\b(phone|android|mobile)\b/i.test(lower) && /\b(open|launch|close|terminate|search|inspect)\b/i.test(lower));

      if (isMobileRequest) {
        const orchOutcome = await autonomousOrchestrator.processUserRequest(raw, {
          source,
          userId: req.supabaseUser?.id || req.device?.ownerUserId || "operator",
          approvalId: req.body?.approvalId,
          confirmationToken: req.body?.confirmationToken
        });

        const voiceResponse = voice.formatSpokenUpdate(orchOutcome.textResponse, detectedLang);

        return res.json({
          success: orchOutcome.success,
          status: orchOutcome.status,
          intent: "MOBILE_DEVICE_CONTROL",
          textResponse: orchOutcome.textResponse,
          voiceResponse,
          actionTaken: orchOutcome.status || "MOBILE_ACTION_PROCESSED",
          approvalRequest: orchOutcome.approvalRequest || null,
          workflowId: orchOutcome.workflowId,
          language: detectedLang,
          outcome: orchOutcome
        });
      }

      // 1.5. Cross-Device Remote Control Intent (Android <-> Windows PC)
      const isCrossDeviceRequest = lower.includes("pc") || lower.includes("computer") || lower.includes("windows") ||
        lower.includes("laptop") || lower.includes("desktop");

      if (isCrossDeviceRequest && (lower.includes("open") || lower.includes("launch") || lower.includes("lock") || lower.includes("volume") || lower.includes("status") || lower.includes("battery"))) {
        let action = "get_system_vitals";
        let actionPayload = {};
        let targetApp = null;

        if (lower.includes("chrome")) { action = "launch_app"; targetApp = "chrome"; }
        else if (lower.includes("edge")) { action = "launch_app"; targetApp = "msedge"; }
        else if (lower.includes("vs code") || lower.includes("vscode") || lower.includes("code")) { action = "launch_app"; targetApp = "code"; }
        else if (lower.includes("notepad")) { action = "launch_app"; targetApp = "notepad"; }
        else if (lower.includes("calculator") || lower.includes("calc")) { action = "launch_app"; targetApp = "calculator"; }
        else if (lower.includes("terminal") || lower.includes("cmd")) { action = "launch_app"; targetApp = "terminal"; }
        else if (lower.includes("explorer")) { action = "launch_app"; targetApp = "explorer"; }
        else if (lower.includes("lock")) { action = "lock_workstation"; }
        else if (lower.includes("volume up")) { action = "set_volume"; actionPayload = { action: "volume_up" }; }
        else if (lower.includes("volume down")) { action = "set_volume"; actionPayload = { action: "volume_down" }; }
        else if (lower.includes("mute")) { action = "set_volume"; actionPayload = { action: "mute" }; }
        else if (lower.includes("battery") || lower.includes("status")) { action = "get_system_vitals"; }

        if (targetApp) actionPayload.app = targetApp;

        const routeResult = deviceHubInstance.routeCommand({
          callerDeviceId: req.device?.id || null,
          callerToken: extractDeviceBearerToken(req),
          callerUserId: req.supabaseUser?.id || req.device?.ownerUserId || "operator",
          targetPlatform: "windows",
          action,
          payload: actionPayload
        });

        if (!routeResult.success && routeResult.error === "TARGET_DEVICE_OFFLINE") {
          let offlineMsg = "Ayaan, your Windows PC is currently offline or unreachable. The command could not be dispatched.";
          if (detectedLang === "hinglish") offlineMsg = "Ayaan, aapka Windows PC is waqt offline hai. Remote command execute nahi ho payi.";
          else if (detectedLang === "hindi") offlineMsg = "अयान, आपका विंडोज़ पीसी इस समय ऑफलाइन है। निर्देश नहीं भेजा जा सका।";

          deviceHubInstance.recordSharedMessage({ source, role: "user", content: raw });
          deviceHubInstance.recordSharedMessage({ source: "ultron", role: "assistant", content: offlineMsg });

          return res.status(409).json({
            success: false,
            intent: "CROSS_DEVICE_REMOTE_INTENT",
            error: "TARGET_DEVICE_OFFLINE",
            textResponse: offlineMsg,
            actionTaken: "BLOCKED_PC_OFFLINE",
            language: detectedLang
          });
        }

        if (routeResult.success) {
          let successMsg = targetApp
            ? `Affirmative, Ayaan. Dispatching to your Windows PC to launch ${targetApp}.`
            : `Affirmative, Ayaan. Executing ${action.replace(/_/g, " ")} on your Windows PC.`;

          if (detectedLang === "hinglish") {
            successMsg = targetApp
              ? `Ji Ayaan, aapke Windows PC par ${targetApp} open kiya ja raha hai.`
              : `Ji Ayaan, aapke Windows PC par command execute ho raha hai.`;
          } else if (detectedLang === "hindi") {
            successMsg = "हाँ अयान, आपके विंडोज़ पीसी पर निर्देश भेजा जा रहा है।";
          }

          deviceHubInstance.recordSharedMessage({ source, role: "user", content: raw });
          deviceHubInstance.recordSharedMessage({ source: "ultron", role: "assistant", content: successMsg });

          return res.json({
            success: true,
            intent: "CROSS_DEVICE_REMOTE_INTENT",
            textResponse: successMsg,
            actionTaken: "DISPATCHED_TO_PC",
            language: detectedLang,
            routeResult
          });
        }
      }

      // 2. Offline Desktop Intent via Windows Speech Daemon
      const offlineMatch = windowsSpeechDaemon.matchOfflineIntent(raw);
      if (offlineMatch?.matched) {
        let actionResult = null;
        if (offlineMatch.action === "open_browser") {
          actionResult = await windowsAutomation.launchApp("explorer.exe");
        } else if (offlineMatch.action === "battery") {
          actionResult = await windowsAutomation.getBatteryStatus();
        }
        return res.json({
          success: true,
          intent: "OFFLINE_DESKTOP_INTENT",
          textResponse: offlineMatch.feedback || "Command executed.",
          actionTaken: offlineMatch.action,
          language: detectedLang,
          actionResult
        });
      }

      // 3. Conversational / Cognitive Brain Routing
      const heiResult = brain.hei?.processUtterance ? brain.hei.processUtterance(raw, { language: detectedLang, source }) : null;
      let textResponse = heiResult?.response;
      if (!textResponse) {
        if (detectedLang === "hinglish") {
          textResponse = "Ji Ayaan, command execute ho raha hai.";
        } else if (detectedLang === "hindi") {
          textResponse = "हाँ अयान, निर्देश का पालन किया जा रहा है।";
        } else {
          textResponse = "Affirmative, Ayaan. Executing command.";
        }
      }

      res.json({
        success: true,
        intent: "BRAIN_ROUTED_COMMAND",
        textResponse,
        actionTaken: "PROCESSED",
        language: detectedLang,
        heiResult
      });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // --- Windows Automation & Hardware Control ---
  router.get("/jarvis/pc/battery", requireOwner, async (_req, res) => {
    const battery = await windowsAutomation.getBatteryStatus();
    res.json(battery);
  });

  router.post("/jarvis/pc/volume", requireOwner, express.json(), async (req, res) => {
    const { action, value } = req.body || {};
    try {
      const result = await windowsAutomation.setSystemVolume(action, value);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/pc/lock", requireOwner, async (_req, res) => {
    try {
      const result = await windowsAutomation.lockWorkstation();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/pc/screenshot", requireOwner, async (_req, res) => {
    try {
      const capture = await windowsAutomation.captureScreen();
      res.json(capture);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/pc/active-window", requireOwner, async (_req, res) => {
    const win = await windowsAutomation.getActiveWindowTitle();
    res.json(win);
  });

  // --- Proactive Daemon ---
  router.get("/jarvis/proactive/status", requireOwner, (_req, res) => {
    res.json({
      status: proactiveDaemon.getStatus(),
      recentAlerts: proactiveDaemon.getRecentAlerts()
    });
  });

  router.post("/jarvis/proactive/tick", requireOwner, async (_req, res) => {
    const result = await proactiveDaemon.tick();
    res.json(result);
  });

  router.post("/jarvis/proactive/toggle", requireOwner, express.json(), (req, res) => {
    const { running, enableSpokenAlerts } = req.body || {};
    if (typeof enableSpokenAlerts === "boolean") {
      proactiveDaemon.enableSpokenAlerts = enableSpokenAlerts;
    }
    if (running) {
      proactiveDaemon.start();
    } else {
      proactiveDaemon.stop();
    }
    res.json(proactiveDaemon.getStatus());
  });

  // --- Screen Observer & Visual Intelligence ---
  router.get("/jarvis/screen/inspect", requireOwner, async (_req, res) => {
    try {
      const inspection = await screenObserver.inspectCurrentScreen();
      res.json(inspection);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  
  // --- Robotics & HAL (Singularity) ---
  router.post("/jarvis/robotics/register", requireOwner, express.json(), (req, res) => {
    const result = robotController.registerRobot(req.body || {});
    res.json(result);
  });

  router.post("/jarvis/robotics/motion", requireOwner, express.json(), (req, res) => {
    const { robotId, command } = req.body || {};
    const result = robotController.dispatchMotionCommand(robotId, command || {});
    if (!result.permitted) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  router.post("/jarvis/robotics/emergency-stop", requireOwner, express.json(), (req, res) => {
    const reason = req.body?.reason || "Operator emergency stop triggered";
    const result = robotController.triggerEmergencyStop(reason);
    res.json(result);
  });

  router.post("/jarvis/robotics/clear-emergency-stop", requireOwner, express.json(), (req, res) => {
    const authorizationKey = req.body?.authorizationKey;
    const result = robotController.clearEmergencyStop(authorizationKey);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  router.get("/jarvis/robotics/status", requireOwner, (_req, res) => {
    res.json(robotController.getFleetStatus());
  });

  router.post("/jarvis/robotics/export-brain", requireOwner, express.json(), (req, res) => {
    const exported = robotController.exportBrainPackage(req.body || {});
    res.json({ success: true, package: exported });
  });

  router.post("/jarvis/robotics/import-brain", requireOwner, express.json(), (req, res) => {
    const result = robotController.importBrainPackage(req.body?.package, req.body?.targetDevice);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // --- True Offline & Online Connection Controller (Singularity) ---
  router.get("/jarvis/connection/status", requireOwner, (_req, res) => {
    res.json(connectionController.getStatus());
  });

  router.post("/jarvis/connection/mode", requireOwner, express.json(), (req, res) => {
    const { mode } = req.body || {};
    const result = connectionController.setForcedMode(mode);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  router.post("/jarvis/connection/evaluate-route", requireOwner, express.json(), (req, res) => {
    const { taskType, options } = req.body || {};
    const routing = connectionController.evaluateTaskRouting(taskType, options);
    res.json(routing);
  });

  router.post("/jarvis/connection/sync-flush", requireOwner, (_req, res) => {
    const flushed = connectionController.flushSyncQueue();
    res.json(flushed);
  });

  // --- Multi-Domain Knowledge Vault (Singularity) ---
  router.post("/jarvis/knowledge/index", requireOwner, express.json(), (req, res) => {
    const entry = req.body || {};
    const result = knowledgeEngine.indexEntry(entry);
    res.json(result);
  });

  router.get("/jarvis/knowledge/query", requireOwner, (req, res) => {
    const query = String(req.query.q || "");
    const domain = req.query.domain ? String(req.query.domain) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    const results = knowledgeEngine.query(query, { domain, limit });
    res.json({ query, resultsCount: results.length, results });
  });

  router.get("/jarvis/knowledge/stats", requireOwner, (_req, res) => {
    res.json(knowledgeEngine.getDomainStats());
  });

  // --- Defensive Cybersecurity Intelligence (Singularity) ---
  router.post("/jarvis/security/audit", requireOwner, express.json(), (req, res) => {
    const assessment = cyberSecurityIntel.performDefensiveAssessment(req.body || {});
    if (!assessment.success) {
      return res.status(403).json(assessment);
    }
    res.json(assessment);
  });

  router.post("/jarvis/security/authorize-scope", requireOwner, express.json(), (req, res) => {
    const { target, record } = req.body || {};
    const result = cyberSecurityIntel.authorizeTargetScope(target, record);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  router.get("/jarvis/security/history", requireOwner, (_req, res) => {
    res.json({ history: cyberSecurityIntel.auditHistory });
  });

  // --- Privacy-Gated Geographic Intelligence (Singularity) ---
  router.post("/jarvis/geo/distance", requireOwner, express.json(), (req, res) => {
    const { lat1, lon1, lat2, lon2 } = req.body || {};
    const distKm = geoIntelligence.calculateDistanceKm(lat1, lon1, lat2, lon2);
    const bearing = geoIntelligence.calculateBearing(lat1, lon1, lat2, lon2);
    res.json({ distanceKm: distKm, distanceMiles: Number((distKm * 0.621371).toFixed(2)), bearing });
  });

  router.post("/jarvis/geo/route", requireOwner, express.json(), (req, res) => {
    const { origin, destination, waypoints, mode } = req.body || {};
    const route = geoIntelligence.estimateRoute(origin, destination, waypoints, mode);
    res.json(route);
  });

  router.post("/jarvis/geo/consent", requireOwner, express.json(), (req, res) => {
    const { deviceId, consentDurationMinutes } = req.body || {};
    const result = geoIntelligence.createLocationConsentToken(ownerUserId, deviceId, consentDurationMinutes);
    res.json(result);
  });

  router.post("/jarvis/geo/verify-location", requireOwner, express.json(), (req, res) => {
    const { token, coords } = req.body || {};
    const verified = geoIntelligence.verifyLocationSharing(token, coords);
    if (!verified.permitted) {
      return res.status(403).json(verified);
    }
    res.json(verified);
  });

  router.post("/jarvis/geo/revoke", requireOwner, express.json(), (req, res) => {
    const { token } = req.body || {};
    const result = geoIntelligence.revokeLocationSharing(token);
    res.json(result);
  });

  router.get("/jarvis/geo/audit-logs", requireOwner, (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    res.json({ auditLogs: geoIntelligence.getAuditLogs(limit) });
  });

  
  // --- Telephone Access & Telephony Gateway (Jarvis Calling) ---
  router.post("/telephony/incoming-call", express.urlencoded({ extended: true }), express.json(), requireTelephonyWebhook, (req, res) => {
    const from = req.body.From || req.body.from || req.body.caller || "";
    const to = req.body.To || req.body.to || "";
    const callSid = req.body.CallSid || req.body.callSid || req.body.callId;

    const callResult = telephonyGateway.handleIncomingCall({ callSid, from, to });
    res.setHeader("Content-Type", "text/xml");
    res.send(callResult.twiml);
  });

  router.post("/telephony/process-speech", express.urlencoded({ extended: true }), express.json(), requireTelephonyWebhook, async (req, res) => {
    const callId = req.query.callId || req.body.callId || req.body.CallSid;
    const speechResult = req.body.SpeechResult || req.body.speechResult || req.body.text || "";
    const call = telephonyGateway.getCall(callId);

    if (!call) {
      res.setHeader("Content-Type", "text/xml");
      return res.send(telephonyGateway.generateSpeechResponseTwiML(callId, "Call session expired.", true));
    }

    telephonyGateway.recordCallerSpeech(callId, speechResult);

    const outcome = await telephonyBrain.processCallerUtterance({
      callId,
      callerNumber: call.from,
      isOwner: call.isOwner,
      speechText: speechResult,
      multiDeviceManager,
      windowsDesktopAgent
    });

    telephonyGateway.recordAssistantSpeech(callId, outcome.spokenResponse);

    res.setHeader("Content-Type", "text/xml");
    res.send(telephonyGateway.generateSpeechResponseTwiML(callId, outcome.spokenResponse, Boolean(outcome.hangup)));
  });

  router.post("/telephony/verify-pin", express.urlencoded({ extended: true }), express.json(), requireTelephonyWebhook, (req, res) => {
    const callId = req.query.callId || req.body.callId || req.body.CallSid;
    const digits = req.body.Digits || req.body.digits || req.body.pin || "";

    const pinResult = telephonyGateway.verifyCallPin(callId, digits);
    res.setHeader("Content-Type", "text/xml");

    if (pinResult.authorized) {
      res.send(telephonyGateway.generateConnectedTwiML(callId, "Security PIN accepted. Good evening sir, ULTRON is online. How may I assist you?"));
    } else if (pinResult.hangup) {
      res.send(telephonyGateway.generateSpeechResponseTwiML(callId, "Maximum authorization attempts exceeded. Terminating call.", true));
    } else {
      res.send(telephonyGateway.generatePinChallengeTwiML(callId));
    }
  });

  router.post("/telephony/timeout-prompt", express.urlencoded({ extended: true }), requireTelephonyWebhook, (req, res) => {
    const callId = req.query.callId || req.body.callId;
    res.setHeader("Content-Type", "text/xml");
    res.send(telephonyGateway.generateSpeechResponseTwiML(callId, "I did not detect any speech. Are you still there, sir?"));
  });

  router.post("/telephony/status-callback", express.urlencoded({ extended: true }), express.json(), requireTelephonyWebhook, (req, res) => {
    const callId = req.body.CallSid || req.body.callId;
    const callStatus = req.body.CallStatus || req.body.callStatus;
    if (callStatus === "completed" || callStatus === "canceled") {
      telephonyGateway.endCall(callId, callStatus);
    }
    res.json({ success: true, callId, callStatus });
  });

  router.get("/jarvis/telephony/calls", requireOwner, (_req, res) => {
    res.json({
      activeCalls: telephonyGateway.getActiveCalls(),
      recentHistory: telephonyGateway.getCallHistory(20)
    });
  });

  // --- Multi-Device Remote Control & Synchronizer ---
  router.get("/jarvis/devices/fleet", requireOwner, (_req, res) => {
    res.json({
      devices: multiDeviceManager.listDevices(),
      commandHistory: multiDeviceManager.commandHistory
    });
  });

  router.post("/jarvis/devices/unlock-mobile", requireOwner, async (_req, res) => {
    const result = await multiDeviceManager.unlockMobileDevices();
    res.json(result);
  });

  router.post("/jarvis/devices/lock-mobile", requireOwner, async (_req, res) => {
    const result = await multiDeviceManager.lockMobileDevices();
    res.json(result);
  });

  router.post("/jarvis/devices/play-media", requireOwner, express.json(), async (req, res) => {
    const { mediaUrl, query } = req.body || {};
    const result = await multiDeviceManager.playMediaAcrossDevices({ mediaUrl, query });
    res.json(result);
  });

  router.post("/jarvis/devices/pc/unlock", requireOwner, async (_req, res) => {
    const result = await windowsDesktopAgent.unlockScreen();
    res.json(result);
  });

  router.post("/jarvis/devices/pc/lock", requireOwner, async (_req, res) => {
    const result = await windowsDesktopAgent.lockScreen();
    res.json(result);
  });

  router.get("/jarvis/devices/pc/vitals", requireOwner, async (_req, res) => {
    const vitals = await windowsDesktopAgent.getSystemVitals();
    res.json(vitals);
  });

  router.post("/jarvis/devices/remote-task", requireOwner, express.json(), async (req, res) => {
    const { action, payload, idempotencyKey } = req.body || {};
    const outcome = await remoteTaskOrchestrator.executeRemoteTask({
      callerId: "owner_console",
      isOwner: true,
      action,
      payload,
      idempotencyKey
    });
    res.json(outcome);
  });

  router.get("/jarvis/devices/remote-task/history", requireOwner, (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    res.json({ history: remoteTaskOrchestrator.getTaskHistory(limit) });
  });

  // --- Live Cyber-HUD Event Stream (Server-Sent Events) ---
  router.get("/jarvis/hud/events", requireOwner, (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const sendEvent = (eventData) => {
      res.write("data: " + JSON.stringify(eventData) + "\n\n");
    };

    // Initial state event
    sendEvent({
      type: "CORE_STATE_CHANGE",
      state: windowsDesktopAgent.screenState === "SYSTEM_LOCKED" ? "STANDBY" : "CALL_ACTIVE",
      detail: "HUD Connected",
      devices: multiDeviceManager.listDevices().length
    });

    const timer = setInterval(() => {
      sendEvent({ type: "HEARTBEAT", timestamp: Date.now() });
    }, 25000);

    req.on("close", () => {
      clearInterval(timer);
    });
  });

  let currentHudState = {
    state: "STANDBY",
    activeTask: null,
    updatedAt: new Date().toISOString(),
    captureProtection: true
  };

  router.get("/jarvis/hud/state", authenticateOwnerOrDevice, (_req, res) => {
    res.json({
      success: true,
      hud: currentHudState
    });
  });

  router.post("/jarvis/hud/state", authenticateOwnerOrDevice, express.json(), (req, res) => {
    const { state, activeTask } = req.body || {};
    if (state) currentHudState.state = state;
    if (activeTask !== undefined) currentHudState.activeTask = activeTask;
    currentHudState.updatedAt = new Date().toISOString();
    res.json({
      success: true,
      hud: currentHudState
    });
  });

  // ==========================================
  // --- MODULE 1 & 8: COMPLETE SYSTEM CONTROL ---
  // ==========================================
  router.get("/jarvis/system/drives", requireOwner, async (_req, res) => {
    try {
      const drives = await systemControlAgent.listDrives();
      res.json({ success: true, drives });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/system/performance", requireOwner, async (_req, res) => {
    try {
      const perf = await systemControlAgent.getSystemPerformance();
      res.json({ success: true, performance: perf });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/files/search", requireOwner, express.json(), async (req, res) => {
    try {
      const results = await systemControlAgent.searchFiles(req.body || {});
      res.json({ success: true, results });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/files/organize", requireOwner, express.json(), async (req, res) => {
    try {
      const outcome = await systemControlAgent.organizeFolder(req.body || {});
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/files/restore", requireOwner, express.json(), async (req, res) => {
    try {
      const { backupId, targetDir } = req.body || {};
      const outcome = await systemControlAgent.restoreBackup(backupId, targetDir);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/apps/launch", requireOwner, express.json(), async (req, res) => {
    try {
      const { app, args } = req.body || {};
      const outcome = await systemControlAgent.launchApp(app, args);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/apps/close", requireOwner, express.json(), async (req, res) => {
    try {
      const { app, force } = req.body || {};
      const outcome = await systemControlAgent.closeApp(app, force);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/command", requireOwner, express.json(), async (req, res) => {
    try {
      const { command } = req.body || {};
      const outcome = await systemControlAgent.executeApprovedCommand(command);
      res.json(outcome);
    } catch (err) {
      res.status(403).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/system/screenshot", requireOwner, express.json(), async (req, res) => {
    try {
      const outcome = await systemControlAgent.captureScreen(req.body || {});
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // ==========================================
  // --- MODULE 2, 3, 4, 5: MEDIA & PRODUCTION ---
  // ==========================================
  router.post("/jarvis/media/discover", requireOwner, express.json(), async (req, res) => {
    try {
      const { targetDir, options } = req.body || {};
      const outcome = await mediaDiscoveryEngine.indexDirectory(targetDir, options);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/media/library", requireOwner, (_req, res) => {
    const items = Array.from(mediaDiscoveryEngine.catalog.values());
    const duplicates = mediaDiscoveryEngine.findDuplicates();
    res.json({
      success: true,
      totalCount: items.length,
      duplicatesCount: duplicates.length,
      items: items.slice(0, 100),
      duplicates
    });
  });

  router.get("/jarvis/media/search", requireOwner, (req, res) => {
    const q = req.query.q || "";
    const results = mediaDiscoveryEngine.searchMedia(q);
    res.json({ success: true, count: results.length, results });
  });

  router.get("/jarvis/media/cloud-status", requireOwner, (_req, res) => {
    res.json(mediaDiscoveryEngine.getCloudStorageStatus());
  });

  router.post("/jarvis/media/video/timeline", requireOwner, express.json(), (req, res) => {
    const timeline = videoEditingEngine.buildTimeline(req.body || {});
    res.json({ success: true, timeline });
  });

  router.post("/jarvis/media/video/render", requireOwner, express.json(), async (req, res) => {
    try {
      const timeline = req.body?.timeline || videoEditingEngine.buildTimeline(req.body || {});
      const outcome = await videoEditingEngine.renderVideo(timeline);
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/media/video/render-status/:id", requireOwner, (req, res) => {
    const status = videoEditingEngine.getRenderStatus(req.params.id);
    if (!status) return res.status(404).json({ error: { message: "RENDER_NOT_FOUND" } });
    res.json({ success: true, status });
  });

  router.post("/jarvis/media/video/render-cancel/:id", requireOwner, (req, res) => {
    const outcome = videoEditingEngine.cancelRender(req.params.id);
    res.json(outcome);
  });

  router.post("/jarvis/media/image/thumbnail", requireOwner, express.json(), async (req, res) => {
    try {
      const outcome = await imageStudioEngine.exportThumbnail(req.body || {});
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/media/image/enhance-prompt", requireOwner, express.json(), (req, res) => {
    const { prompt, style } = req.body || {};
    const enhanced = imageStudioEngine.enhancePrompt(prompt, style);
    res.json({ success: true, prompt, enhanced });
  });

  router.post("/jarvis/media/production/autonomous", requireOwner, express.json(), async (req, res) => {
    try {
      const { prompt } = req.body || {};
      const outcome = await autonomousProductionOrchestrator.produceContent(prompt);
      res.status(outcome.success ? 200 : 424).json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/media/production/history", requireOwner, (_req, res) => {
    res.json({ success: true, history: autonomousProductionOrchestrator.getHistory() });
  });

  // DSH-GOD Complete Capability Integration Routes
  const dshRouter = createDshGodRouter();
  router.use("/integrations/dsh-god", requireOwner, dshRouter);
  router.use("/jarvis/integrations/dsh-god", requireOwner, dshRouter);


  // =========================================================================
  // NEXT-GENERATION AUTONOMOUS INTELLIGENCE UPGRADE ROUTES (9 SYSTEMS)
  // =========================================================================

  router.get("/jarvis/nextgen/status", requireOwner, (_req, res) => {
    res.json({
      success: true,
      subsystems: {
        ultronCore: { status: "ACTIVE", version: "2.0.0" },
        ultronAutonomy: { status: "ACTIVE", version: "2.0.0" },
        ultronGenesis: { status: "ACTIVE", version: "2.0.0" },
        ultronForge: { status: "ACTIVE", version: "2.0.0" },
        ultronRobotics: { status: "ACTIVE", version: "2.0.0" },
        ultronVision: { status: "ACTIVE", version: "2.0.0" },
        ultronNexus: { status: "ACTIVE", version: "2.0.0" },
        ultronGuardian: { status: "ACTIVE", version: "2.0.0" },
        humanInterface: { status: "ACTIVE", version: "2.0.0" }
      },
      hardwareBounds: "AMD Ryzen 7 5700U · 8GB RAM · Pure CPU",
      timestamp: new Date().toISOString()
    });
  });

  router.post("/jarvis/nextgen/core/inference", requireOwner, express.json(), async (req, res) => {
    try {
      const { prompt, preferredProvider } = req.body || {};
      const outcome = await ultronCore.orchestrateInference(prompt, { preferredProvider });
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/autonomy/plan", requireOwner, express.json(), async (req, res) => {
    try {
      const { goal, autoRun } = req.body || {};
      const plan = ultronAutonomy.decomposeGoal(goal);
      if (autoRun) {
        const runRes = await ultronAutonomy.runPlan(plan.id);
        return res.json(runRes);
      }
      res.json({ success: true, plan });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/autonomy/approve", requireOwner, express.json(), (req, res) => {
    try {
      const { taskId, token, approved } = req.body || {};
      const outcome = ultronAutonomy.submitApproval(taskId, token, approved);
      res.json({ success: true, outcome });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/genesis/generate", requireOwner, express.json(), (req, res) => {
    try {
      const { type, spec } = req.body || {};
      let artifact;
      if (type === "APP") artifact = genesisEngine.generateApplication(spec);
      else if (type === "3D_SIMULATION") artifact = genesisEngine.generate3DEnvironment(spec);
      else artifact = genesisEngine.generateAgentCapability(spec);
      const validation = genesisEngine.validateArtifact(artifact.id);
      res.json({ success: true, artifact, validation });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/forge/security-scan", requireOwner, express.json(), (req, res) => {
    try {
      const { code } = req.body || {};
      const secReport = forgeEngine.analyzeSecurity(code);
      res.json(secReport);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/robotics/sim-step", requireOwner, express.json(), (req, res) => {
    try {
      const { command, dt, obstacles } = req.body || {};
      const twin = new RobotDigitalTwin();
      const stepRes = twin.step(command, dt, obstacles);
      const lidar = twin.scanLidar(obstacles);
      res.json({ success: true, stepRes, lidar });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/robotics/sim-to-real", requireOwner, express.json(), (req, res) => {
    try {
      const { robotId, trajectory } = req.body || {};
      const passport = simToRealGate.issueDeploymentPassport(robotId, trajectory);
      if (!passport.success) return res.status(409).json(passport);
      res.json(passport);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // --- SimReady & OpenUSD Robotics Simulation (Category Q) ---
  router.get("/jarvis/robotics/simready/assets", requireOwner, (_req, res) => {
    res.json({ success: true, count: SIMREADY_ASSET_CATALOG.length, assets: SIMREADY_ASSET_CATALOG });
  });

  router.get("/jarvis/robotics/simready/scenarios", requireOwner, (_req, res) => {
    res.json({ success: true, scenarios: Object.values(TRAINING_SCENARIOS) });
  });

  router.post("/jarvis/robotics/simready/scenario/run", requireOwner, express.json(), (req, res) => {
    try {
      const { scenarioKey, maxSteps } = req.body || {};
      if (scenarioKey) simReadyEngine.loadScenario(scenarioKey);
      const episode = simReadyEngine.runEpisode(Number(maxSteps) || 40);
      const evaluation = playbackEngine.evaluateAndPlayback(episode);
      res.json({ success: true, episode, evaluation });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/robotics/simready/dataset", requireOwner, (req, res) => {
    try {
      const format = String(req.query?.format || "json").toLowerCase();
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        return res.send(simReadyEngine.exportDatasetCSV());
      }
      res.json(simReadyEngine.exportDatasetJSON());
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/robotics/simready/hil/handshake", requireOwner, express.json(), async (_req, res) => {
    const result = await hilBridge.handshake();
    if (!result.success) return res.status(501).json(result);
    res.json(result);
  });

  router.get("/jarvis/robotics/simready/central/search", requireOwner, (req, res) => {
    try {
      const query = String(req.query?.q || "");
      const category = req.query?.category ? String(req.query.category) : null;
      const limit = Number(req.query?.limit) || 10;
      const results = simReadyCentralExplorer.searchAssets({ query, category, limit });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/robotics/simready/central/import", requireOwner, express.json(), (req, res) => {
    try {
      const { assetId } = req.body || {};
      if (!assetId) {
        return res.status(400).json({ success: false, error: "MISSING_ASSET_ID" });
      }
      const result = simReadyCentralExplorer.importAssetToProject(assetId, simReadyEngine);
      if (!result.success) return res.status(404).json(result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/vision/analyze", requireOwner, express.json(), async (req, res) => {
    try {
      const { imageData, prompt, objAsset } = req.body || {};
      if (objAsset) {
        const mesh = ultronVision.process3DAsset(objAsset, "obj");
        return res.json({ success: true, mesh });
      }
      const [understanding, objects] = await Promise.all([
        ultronVision.understandImage(imageData, prompt),
        ultronVision.detectObjects(imageData)
      ]);
      res.json({ success: true, understanding, objects });
    } catch (err) {
      const code = typeof err?.code === "string" ? err.code : "VISION_ANALYSIS_FAILED";
      const unavailableCodes = new Set([
        "VISION_PROVIDER_REQUIRED", "OPENROUTER_API_KEY_REQUIRED",
        "NO_ELIGIBLE_FREE_VISION_MODELS", "OPENROUTER_HOST_REQUIRED", "UNSAFE_PROVIDER_URL"
      ]);
      const status = unavailableCodes.has(code) ? 503
        : code === "IMAGE_TOO_LARGE" ? 413
          : code.startsWith("INVALID_") || code.startsWith("UNSUPPORTED_") ? 400 : 502;
      res.status(status).json({ error: { code, message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/nexus/collaborate", requireOwner, express.json(), async (req, res) => {
    try {
      const { goal } = req.body || {};
      const result = await nexusOrchestrator.executeCollaborativeMission(goal);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/guardian/verify-audit", requireOwner, (req, res) => {
    try {
      const integrity = ultronGuardian.verifyAuditIntegrity();
      res.json(integrity);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/nextgen/human/interact", requireOwner, express.json(), async (req, res) => {
    try {
      const { userId, utterance } = req.body || {};
      const outcome = await humanInterface.processInteraction(userId || "anonymous", utterance);
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // ==========================================
  // ULTRON EYES — Native Vision Sensory System
  // ==========================================
  router.get("/jarvis/eyes/devices", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const devices = ultronEyesManager.getAvailableDevices(userId);
      const defaultCamera = ultronEyesManager.getDefaultCamera();
      res.json({ success: true, devices, defaultCamera });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/devices/sync", requireOwner, express.json(), (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const { devices } = req.body || {};
      const synced = ultronEyesManager.syncClientDevices(userId, devices);
      res.json({ success: true, count: synced.length, devices: synced });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/devices/default", requireOwner, express.json(), (req, res) => {
    try {
      const { deviceId } = req.body || {};
      const updated = ultronEyesManager.setDefaultCamera(deviceId);
      res.json({ success: true, defaultCamera: updated });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/eyes/session/status", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const status = ultronEyesManager.getSessionStatus(userId);
      res.json({ success: true, ...status });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/session/start", requireOwner, express.json(), (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const { deviceId, fps, resolution, consent, userConsent } = req.body || {};
      const result = ultronEyesManager.startSession({
        userId,
        deviceId,
        fps,
        resolution,
        consent: consent ?? userConsent
      });
      res.json(result);
    } catch (err) {
      const isPermissionDenied = err.message && err.message.includes("PERMISSION_DENIED");
      res.status(isPermissionDenied ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/session/pause", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const result = ultronEyesManager.pauseSession(userId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/session/resume", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const result = ultronEyesManager.resumeSession(userId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/session/stop", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const result = ultronEyesManager.stopSession(userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/frame", requireOwner, express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const { frameData, dataUrl, deviceId, timestamp } = req.body || {};
      const observation = await ultronEyesManager.processFrame({
        userId,
        frameData: frameData || dataUrl,
        deviceId,
        timestamp
      });
      res.json({ success: true, observation });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/query", requireOwner, express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const { query, prompt, frameData, dataUrl, consent, userConsent } = req.body || {};
      const outcome = await ultronEyesManager.queryVisualContext({
        userId,
        query: query || prompt,
        frameData: frameData || dataUrl,
        userConsent: consent ?? userConsent
      });
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/eyes/memory", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const memory = ultronEyesManager.getVisualMemory(userId);
      res.json({ success: true, memory });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/memory/clear", requireOwner, (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const result = ultronEyesManager.clearVisualMemory(userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/eyes/snapshot", requireOwner, express.json(), (req, res) => {
    try {
      const userId = req.supabaseUser?.id || "default-user";
      const { note, consent, userConsent } = req.body || {};
      const snapshot = ultronEyesManager.captureSnapshot({
        userId,
        note,
        userConsent: consent ?? userConsent ?? true
      });
      res.json({ success: true, snapshot });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // ==========================================
  // ULTRON CYBER CORE — Ethical Hacking & Cybersecurity
  // ==========================================
  router.get("/jarvis/cyber/status", requireOwner, (_req, res) => {
    try {
      const agents = ultronCyberCore.getAgentsStatus();
      const scopes = targetAuthorizationGateway.listScopes();
      res.json({
        success: true,
        emergencyStopEngaged: targetAuthorizationGateway.emergencyStopEngaged,
        agentsCount: agents.length,
        agents,
        activeScopesCount: scopes.filter(s => s.isActive).length,
        scopes
      });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/cyber/scopes", requireOwner, (_req, res) => {
    try {
      const scopes = targetAuthorizationGateway.listScopes();
      res.json({ success: true, scopes });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/scopes/register", requireOwner, express.json(), (req, res) => {
    try {
      const scopeRecord = targetAuthorizationGateway.registerScope(req.body);
      res.json({ success: true, scope: scopeRecord });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/scopes/revoke", requireOwner, express.json(), (req, res) => {
    try {
      const { scopeId, reason } = req.body || {};
      const result = targetAuthorizationGateway.revokeScope(scopeId, reason);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/mission/run", requireOwner, express.json(), async (req, res) => {
    try {
      const { target, options } = req.body || {};
      const result = await ultronCyberCore.executeComprehensiveMission(target, options);
      res.json({ success: true, ...result });
    } catch (err) {
      const isAuthError = err.message && (err.message.includes("TARGET_OUT_OF_SCOPE") || err.message.includes("AUTHORIZATION_DENIED"));
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/dependencies/audit", requireOwner, express.json(), async (req, res) => {
    try {
      const { targetDir } = req.body || {};
      const result = await codeShield.auditDependencies(targetDir || process.cwd());
      res.json({ success: true, ...result });
    } catch (err) {
      const isAuthError = err.message && err.message.includes("TARGET_OUT_OF_SCOPE");
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/sast/scan", requireOwner, express.json(), (req, res) => {
    try {
      const { sourceCode, target } = req.body || {};
      const result = codeShield.scanSourceCode(sourceCode, { target });
      res.json({ success: true, ...result });
    } catch (err) {
      const isAuthError = err.message && err.message.includes("TARGET_OUT_OF_SCOPE");
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/web/audit", requireOwner, express.json(), async (req, res) => {
    try {
      const { targetUrl, headers, cookies, jwtToken, corsHeaders } = req.body || {};
      const result = await cyberWebAuditor.auditEndpoint(targetUrl, { headers, cookies, jwtToken, corsHeaders });
      res.json({ success: true, ...result });
    } catch (err) {
      const isAuthError = err.message && err.message.includes("TARGET_OUT_OF_SCOPE");
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/ai/redteam", requireOwner, express.json(), async (req, res) => {
    try {
      const { target } = req.body || {};
      const result = await aiRedTeamEvaluator.runRedTeamSuite({ target });
      res.json({ success: true, ...result });
    } catch (err) {
      const isAuthError = err.message && err.message.includes("TARGET_OUT_OF_SCOPE");
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/incident/investigate", requireOwner, express.json(), (req, res) => {
    try {
      const result = cyberIncidentAssistant.investigateIncident(req.body);
      res.json({ success: true, incident: result });
    } catch (err) {
      const isAuthError = err.message && err.message.includes("TARGET_OUT_OF_SCOPE");
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/emergency/stop", requireOwner, express.json(), (req, res) => {
    try {
      const { reason } = req.body || {};
      const outcome = targetAuthorizationGateway.engageEmergencyStop(reason);
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/cyber/emergency/resume", requireOwner, express.json(), (req, res) => {
    try {
      const { operatorKey } = req.body || {};
      const outcome = targetAuthorizationGateway.disengageEmergencyStop(operatorKey);
      res.json(outcome);
    } catch (err) {
      res.status(403).json({ error: { message: err.message } });
    }
  });

  // ==========================================
  // ULTRON SENTINEL — Autonomous Cybersecurity & Network Intelligence Division
  // ==========================================
  router.get("/jarvis/sentinel/status", requireOwner, (_req, res) => {
    try {
      res.json({ success: true, ...ultronSentinel.getStatus() });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/sentinel/hardware", requireOwner, (_req, res) => {
    try {
      res.json({ success: true, profile: hardwareAdapter.getHardwareProfile(), health: hardwareAdapter.checkProcessHealth() });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/sentinel/scope", requireOwner, (_req, res) => {
    try {
      const scopes = targetAuthorizationGateway.listScopes();
      res.json({ success: true, scopes, emergencyStop: targetAuthorizationGateway.emergencyStopEngaged });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/scan/start", requireOwner, express.json(), async (req, res) => {
    try {
      const { target, options } = req.body || {};
      const scanContext = await ultronSentinel.startScan(target, options);
      res.json({ success: true, scan: scanContext });
    } catch (err) {
      const isAuthError = err.message && (err.message.includes("TARGET_OUT_OF_SCOPE") || err.message.includes("AUTHORIZATION_DENIED"));
      res.status(isAuthError ? 403 : 400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/scan/pause", requireOwner, express.json(), (req, res) => {
    try {
      const { scanId } = req.body || {};
      const outcome = ultronSentinel.pauseScan(scanId);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/scan/resume", requireOwner, express.json(), (req, res) => {
    try {
      const { scanId } = req.body || {};
      const outcome = ultronSentinel.resumeScan(scanId);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/scan/stop", requireOwner, express.json(), (req, res) => {
    try {
      const { scanId } = req.body || {};
      const outcome = ultronSentinel.stopScan(scanId);
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/sentinel/findings", requireOwner, (req, res) => {
    try {
      const findings = ultronSentinel.getFindings(req.query || {});
      res.json({ success: true, count: findings.length, findings });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/sentinel/history", requireOwner, (_req, res) => {
    try {
      res.json({ success: true, ...ultronSentinel.getHistory() });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/report", requireOwner, express.json(), (req, res) => {
    try {
      const { scanId, format = "markdown" } = req.body || {};
      const report = ultronSentinel.generateReport(scanId, format);
      res.json({ success: true, report });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/sentinel/cve", requireOwner, (req, res) => {
    try {
      const results = ultronSentinel.searchCveDatabase(req.query.q);
      res.json({ success: true, count: results.length, cves: results });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/monitor/start", requireOwner, express.json(), (req, res) => {
    try {
      const { targets, intervalMs } = req.body || {};
      const result = ultronSentinel.monitor.start(targets, intervalMs);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/monitor/stop", requireOwner, (_req, res) => {
    try {
      const result = ultronSentinel.monitor.stop();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/sentinel/monitor/status", requireOwner, (_req, res) => {
    try {
      res.json({ success: true, monitor: ultronSentinel.monitor.getStatus() });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/emergency/stop", requireOwner, express.json(), (req, res) => {
    try {
      const { reason } = req.body || {};
      const outcome = ultronSentinel.emergencyStop(reason);
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/sentinel/emergency/resume", requireOwner, express.json(), (req, res) => {
    try {
      const { operatorKey } = req.body || {};
      const outcome = ultronSentinel.emergencyResume(operatorKey);
      res.json(outcome);
    } catch (err) {
      res.status(403).json({ error: { message: err.message } });
    }
  });

  // --- ULTRON Self-Evolution Engine Routes ---
  router.post("/jarvis/evolution/audit", requireOwner, async (_req, res) => {
    try {
      const audit = await ultronSelfEvolutionEngine.auditSystem();
      res.json({ success: true, audit });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/evolution/plan", requireOwner, express.json(), (req, res) => {
    try {
      const { audit } = req.body || {};
      const plan = ultronSelfEvolutionEngine.generateImprovementPlan(audit);
      res.json({ success: true, plan });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/evolution/command", requireOwner, express.json(), async (req, res) => {
    try {
      const { command, context } = req.body || {};
      const result = await ultronSelfEvolutionEngine.processEvolutionCommand(command, context);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/evolution/challenge", requireOwner, express.json(), (req, res) => {
    try {
      const { targetFile, newContent } = req.body || {};
      if (typeof newContent !== "string") {
        return res.status(400).json({
          error: { code: "APPROVED_CONTENT_REQUIRED", message: "Supply the exact proposed newContent so the server can bind approval to its SHA-256 digest." }
        });
      }
      if (Buffer.byteLength(newContent, "utf8") > 1024 * 1024) {
        return res.status(413).json({
          error: { code: "APPROVED_CONTENT_TOO_LARGE", message: "The proposed content exceeds the 1 MiB approval limit." }
        });
      }
      const ownerUserId = req.supabaseUser?.id;
      if (!ownerUserId) {
        return res.status(401).json({ error: { code: "OWNER_SESSION_REQUIRED", message: "An authenticated owner session is required." } });
      }
      const modificationDigest = crypto.createHash("sha256").update(newContent, "utf8").digest("hex");
      const challenge = operatorAuthorizationService.createChallenge({ ownerUserId, targetFile, modificationDigest });
      res.json({ success: true, challenge });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/evolution/apply", requireOwner, express.json(), async (req, res) => {
    try {
      const { planItemId, modificationSpec, approvalToken, operatorConfirmationToken } = req.body || {};
      const targetFile = modificationSpec?.targetFile || "";

      // Reject strictly immutable system paths
      if (ultronSelfEvolutionEngine.isImmutableTarget(targetFile)) {
        return res.status(403).json({
          error: {
            code: "IMMUTABLE_SYSTEM_PATH_REJECTED",
            message: `Target path '${targetFile}' is strictly immutable and cannot be modified.`
          }
        });
      }

      // Server-side security: Never trust client-supplied operatorContext.authorized!
      const isRestricted = ultronSelfEvolutionEngine.isRestrictedTarget(targetFile);
      let authorized = false;

      if (isRestricted) {
        const tokenToVerify = approvalToken || operatorConfirmationToken;
        if (!tokenToVerify || typeof tokenToVerify !== "string" || tokenToVerify.trim().length < 8) {
          return res.status(403).json({
            error: {
              code: "REQUIRES_OPERATOR_CONFIRMATION_TOKEN",
              message: "Modifying protected system configurations, database schemas, or security policies requires an explicit operator confirmation token."
            }
          });
        }

        const ownerUserId = req.supabaseUser?.id;
        if (!ownerUserId || typeof modificationSpec?.newContent !== "string") {
          return res.status(400).json({
            error: {
              code: "APPROVED_CONTENT_REQUIRED",
              message: "Restricted changes require the exact newContent that was shown in the owner approval preview."
            }
          });
        }
        if (Buffer.byteLength(modificationSpec.newContent, "utf8") > 1024 * 1024) {
          return res.status(413).json({
            error: { code: "APPROVED_CONTENT_TOO_LARGE", message: "The proposed content exceeds the 1 MiB approval limit." }
          });
        }
        // Never trust a client-supplied digest: hash the exact bytes the engine will write.
        const modificationDigest = crypto.createHash("sha256").update(modificationSpec.newContent, "utf8").digest("hex");
        const authResult = operatorAuthorizationService.verifyAndConsume({
          ownerUserId,
          targetFile,
          modificationDigest,
          approvalToken: tokenToVerify
        });

        if (!authResult.valid) {
          return res.status(403).json({
            error: {
              code: authResult.code || "REQUIRES_OPERATOR_CONFIRMATION_TOKEN",
              message: authResult.reason || "Cryptographic operator authorization failed."
            }
          });
        }
        authorized = true;
      }

      const verifiedOperatorContext = {
        authorized,
        userId: req.supabaseUser?.id || "operator",
        confirmedAt: new Date().toISOString()
      };

      const result = await ultronSelfEvolutionEngine.applyImprovement(planItemId, modificationSpec, verifiedOperatorContext);
      res.json({ success: true, result });
    } catch (err) {
      const statusCode = err.message && err.message.includes("SECURITY_VIOLATION") ? 403 : 500;
      res.status(statusCode).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/evolution/rollback", requireOwner, express.json(), (req, res) => {
    try {
      const { snapshotId } = req.body || {};
      const result = ultronSelfEvolutionEngine.rollbackSnapshot(snapshotId);
      res.json({ success: true, result });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/evolution/history", requireOwner, (_req, res) => {
    try {
      const history = ultronSelfEvolutionEngine.getEvolutionHistory();
      res.json({ success: true, history });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}
