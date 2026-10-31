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
import { proactiveDaemon } from "./system/proactive-daemon.js";
import { screenObserver } from "./vision/screen-observer.js";

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
        note: "The 12-agent catalogue is capability metadata. The durable task endpoint currently executes supported AI Employee plan/draft/review/report roles; it does not dispatch arbitrary per-agent tool steps."
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
  router.post("/jarvis/voice/speak", requireSession, express.json(), async (req, res) => {
    const { text, rate, volume } = req.body || {};
    const result = await windowsSpeechDaemon.speak(text, { rate, volume });
    res.json(result);
  });

  router.post("/jarvis/voice/offline-intent", requireSession, express.json(), (req, res) => {
    const { utterance } = req.body || {};
    const match = windowsSpeechDaemon.matchOfflineIntent(utterance);
    res.json(match);
  });

  // --- Windows Automation & Hardware Control ---
  router.get("/jarvis/pc/battery", requireSession, async (_req, res) => {
    const battery = await windowsAutomation.getBatteryStatus();
    res.json(battery);
  });

  router.post("/jarvis/pc/volume", requireSession, express.json(), async (req, res) => {
    const { action, value } = req.body || {};
    try {
      const result = await windowsAutomation.setSystemVolume(action, value);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/pc/lock", requireSession, async (_req, res) => {
    try {
      const result = await windowsAutomation.lockWorkstation();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post("/jarvis/pc/screenshot", requireSession, async (_req, res) => {
    try {
      const capture = await windowsAutomation.captureScreen();
      res.json(capture);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/pc/active-window", requireSession, async (_req, res) => {
    const win = await windowsAutomation.getActiveWindowTitle();
    res.json(win);
  });

  // --- Proactive Daemon ---
  router.get("/jarvis/proactive/status", requireSession, (_req, res) => {
    res.json({
      status: proactiveDaemon.getStatus(),
      recentAlerts: proactiveDaemon.getRecentAlerts()
    });
  });

  router.post("/jarvis/proactive/tick", requireSession, async (_req, res) => {
    const result = await proactiveDaemon.tick();
    res.json(result);
  });

  router.post("/jarvis/proactive/toggle", requireSession, express.json(), (req, res) => {
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
  router.get("/jarvis/screen/inspect", requireSession, async (_req, res) => {
    try {
      const inspection = await screenObserver.inspectCurrentScreen();
      res.json(inspection);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}
