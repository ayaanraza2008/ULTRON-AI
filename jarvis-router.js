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
import { AUTONOMY_LEVELS } from "./autonomy-policy.js";

export function createJarvisRouter({ env = process.env, requireSupabaseUser } = {}) {
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
      emergencyStopActive: orchestrator.isHalted()
    });
  });

  router.post("/jarvis/agents/task", requireOwner, express.json(), (_req, res) => {
    res.status(503).json({
      error: {
        code: "JARVIS_TASK_EXECUTOR_UNAVAILABLE",
        message: "The experimental in-memory orchestrator has no real tool executor. Use the authenticated durable task worker until a real JARVIS executor is integrated."
      }
    });
  });

  router.get("/jarvis/agents/tasks/:id", requireOwner, (req, res) => {
    const task = orchestrator.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    const checkpoint = orchestrator.getCheckpoint(req.params.id);
    res.json({ task, checkpoint });
  });

  router.get("/jarvis/agents/tasks", requireOwner, (_req, res) => {
    res.json({ tasks: orchestrator.listTasks() });
  });

  // --- Emergency Stop / Global Kill Switch ---
  router.post("/jarvis/emergency/stop", requireOwner, express.json(), (req, res) => {
    const reason = req.body?.reason || "Emergency kill switch invoked via console";
    const result = orchestrator.emergencyStop(reason);
    computer.setEmergencyStop(true);
    res.json({ success: true, halted: true, result });
  });

  router.post("/jarvis/emergency/reset", requireOwner, (_req, res) => {
    orchestrator.resetEmergencyStop();
    computer.setEmergencyStop(false);
    res.json({ success: true, halted: false });
  });

  router.post("/jarvis/autonomy/level", requireOwner, express.json(), (req, res) => {
    const level = Number(req.body?.level);
    const success = orchestrator.setAutonomyLevel(level);
    if (!success) return res.status(400).json({ error: { message: "Invalid autonomy level (0-5 required)." } });
    res.json({ success: true, autonomyLevel: orchestrator.getAutonomyLevel(), config: AUTONOMY_LEVELS[level] });
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
    res.json({ reminders: productivity.listReminders() });
  });

  // --- Audit Trail ---
  router.get("/jarvis/audit", requireOwner, (_req, res) => {
    res.json({ logs: orchestrator.getAuditLogs() });
  });

  return router;
}
