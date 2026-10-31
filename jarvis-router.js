/**
 * ULTRON AI — JARVIS × ULTRON Integration Router
 *
 * Exposes REST endpoints for the 12-Agent Orchestrator, Brain Router,
 * Voice Engine, Vision Engine, Computer Control, Device Hub,
 * Coding Sandbox, Smart Home, and Emergency Stop.
 */

import express from "express";
import { BrainRouter } from "./core/brain-router.js";
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



const EMPLOYEE_ROLES = new Set(["gtm-engineer", "seo-aeo", "web-dev", "social-media", "ad-manager", "sales", "customer-satisfaction", "chief-of-staff"]);
const EMPLOYEE_MODES = new Set(["plan", "draft", "review", "report"]);

export function createJarvisRouter({ env = process.env, requireSupabaseUser, supabaseRest, privilegedSupabaseRest = supabaseRest, logger = console } = {}) {
  if (typeof requireSupabaseUser !== "function") {
    throw new TypeError("createJarvisRouter requires the authenticated Supabase user middleware.");
  }

  const ownerUserId = String(env.ULTRON_INTEGRATION_OWNER_USER_ID || "").trim();
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
      providerChain: chain.map(p => ({ name: p.name, model: p.model, type: p.type }))
    });
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

  // --- Multi-Device Hub ---
  router.post("/jarvis/devices/pair/request", requireOwner, (_req, res) => {
    res.status(503).json({
      error: {
        code: "DEVICE_PAIRING_NOT_CONFIGURED",
        message: "Physical companion pairing is not available until a persistent, authenticated device protocol is connected."
      }
    });
  });

  router.post("/jarvis/devices/pair/verify", requireOwner, (_req, res) => {
    res.status(503).json({
      error: {
        code: "DEVICE_PAIRING_NOT_CONFIGURED",
        message: "Physical companion pairing is not available until a persistent, authenticated device protocol is connected."
      }
    });
  });

  router.get("/jarvis/devices", requireOwner, (_req, res) => {
    res.json({ devices: [], connected: false, status: "NOT_CONFIGURED" });
  });

  router.post("/jarvis/notifications", requireOwner, (_req, res) => {
    res.status(503).json({
      error: {
        code: "DEVICE_NOT_CONNECTED",
        message: "No physical companion notification transport is configured."
      }
    });
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
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/voice/interrupt", requireOwner, (_req, res) => {
    const result = kokoroEngine.interrupt();
    res.json(result);
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
    const token = req.body?.resetToken;
    const result = robotController.clearEmergencyStop(token);
    if (!result.success) {
      return res.status(400).json(result);
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
  router.post("/telephony/incoming-call", express.urlencoded({ extended: true }), express.json(), (req, res) => {
    const from = req.body.From || req.body.from || req.body.caller || "";
    const to = req.body.To || req.body.to || "";
    const callSid = req.body.CallSid || req.body.callSid || req.body.callId;

    const callResult = telephonyGateway.handleIncomingCall({ callSid, from, to });
    res.setHeader("Content-Type", "text/xml");
    res.send(callResult.twiml);
  });

  router.post("/telephony/process-speech", express.urlencoded({ extended: true }), express.json(), async (req, res) => {
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

  router.post("/telephony/verify-pin", express.urlencoded({ extended: true }), express.json(), (req, res) => {
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

  router.post("/telephony/timeout-prompt", express.urlencoded({ extended: true }), (req, res) => {
    const callId = req.query.callId || req.body.callId;
    res.setHeader("Content-Type", "text/xml");
    res.send(telephonyGateway.generateSpeechResponseTwiML(callId, "I did not detect any speech. Are you still there, sir?"));
  });

  router.post("/telephony/status-callback", express.urlencoded({ extended: true }), express.json(), (req, res) => {
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
      res.json(outcome);
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

  return router;
}
