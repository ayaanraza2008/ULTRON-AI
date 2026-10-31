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
import { DeviceHub } from "./integrations/device-hub.js";
import { CodingSandbox } from "./tools/sandbox/coding-sandbox.js";
import { SelfImprovementEngine } from "./self-improvement/engine.js";
import { SmartHomeHub } from "./integrations/smart-home.js";
import { ProductivitySuite } from "./integrations/productivity.js";
import { AUTONOMY_LEVELS, canExecuteAutonomously } from "./autonomy-policy.js";

export function createJarvisRouter({ env = process.env, requireSession = (_req, _res, next) => next() } = {}) {
  const router = express.Router();

  const brain = new BrainRouter({ env });
  const orchestrator = new AgentOrchestrator();
  const voice = new JarvisVoiceEngine();
  const vision = new JarvisVisionEngine();
  const computer = new WindowsComputerControl();
  const deviceHub = new DeviceHub();
  const sandbox = new CodingSandbox();
  const selfImprovement = new SelfImprovementEngine();
  const smartHome = new SmartHomeHub();
  const productivity = new ProductivitySuite();

  // Initialize computer sandbox
  computer.initialize().catch(() => {});
  sandbox.initialize().catch(() => {});

  // Pre-populate some demo smart home entities
  smartHome.registerMockDevice({ id: "light.lab_arc", name: "Arc Reactor Ambient Light", domain: "light", state: "on" });
  smartHome.registerMockDevice({ id: "switch.cooling_fan", name: "Hardware Auxiliary Fan", domain: "switch", state: "off" });

  // --- System & Hardware Telemetry ---
  router.get("/jarvis/telemetry", requireSession, (_req, res) => {
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
  router.post("/jarvis/brain/classify", requireSession, express.json(), (req, res) => {
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

  router.get("/jarvis/brain/health", requireSession, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ health: brain.getHealthSummary() });
  });

  // --- 12-Agent Catalog & Orchestration ---
  router.get("/jarvis/agents", requireSession, (_req, res) => {
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

  router.post("/jarvis/agents/task", requireSession, express.json(), async (req, res) => {
    try {
      const { title, targetAgentId, steps, input } = req.body || {};
      const task = orchestrator.createTask({ title, targetAgentId, steps, input });

      // Automatically dispatch step execution
      orchestrator.resumeTask(task.id, async (step) => {
        // Execute step logic based on target action
        return { executed: true, action: step.action, timestamp: new Date().toISOString() };
      }).then(completedTask => {
        selfImprovement.analyzeTaskOutcome(completedTask);
      }).catch(err => {
        selfImprovement.analyzeTaskOutcome({ ...task, status: "FAILED", error: err.message });
      });

      res.status(201).json({ success: true, task });
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/agents/tasks/:id", requireSession, (req, res) => {
    const task = orchestrator.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    const checkpoint = orchestrator.getCheckpoint(req.params.id);
    res.json({ task, checkpoint });
  });

  router.get("/jarvis/agents/tasks", requireSession, (_req, res) => {
    res.json({ tasks: orchestrator.listTasks() });
  });

  // --- Emergency Stop / Global Kill Switch ---
  router.post("/jarvis/emergency/stop", requireSession, express.json(), (req, res) => {
    const reason = req.body?.reason || "Emergency kill switch invoked via console";
    const result = orchestrator.emergencyStop(reason);
    computer.setEmergencyStop(true);
    res.json({ success: true, halted: true, result });
  });

  router.post("/jarvis/emergency/reset", requireSession, (_req, res) => {
    orchestrator.resetEmergencyStop();
    computer.setEmergencyStop(false);
    res.json({ success: true, halted: false });
  });

  router.post("/jarvis/autonomy/level", requireSession, express.json(), (req, res) => {
    const level = Number(req.body?.level);
    const success = orchestrator.setAutonomyLevel(level);
    if (!success) return res.status(400).json({ error: { message: "Invalid autonomy level (0-5 required)." } });
    res.json({ success: true, autonomyLevel: orchestrator.getAutonomyLevel(), config: AUTONOMY_LEVELS[level] });
  });

  // --- Coding Sandbox ---
  router.post("/jarvis/sandbox/run", requireSession, express.json(), async (req, res) => {
    const code = req.body?.code;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: { message: "Source code string is required." } });
    }
    const result = await sandbox.executeJavaScript(code);
    res.json({ result });
  });

  // --- Voice Engine ---
  router.get("/jarvis/voice/profile", requireSession, (_req, res) => {
    res.json({ currentProfile: voice.getProfile() });
  });

  router.post("/jarvis/voice/profile", requireSession, express.json(), (req, res) => {
    const profileId = req.body?.profileId;
    const result = voice.setProfile(profileId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  router.post("/jarvis/voice/format", requireSession, express.json(), (req, res) => {
    const text = req.body?.text || "";
    const spoken = voice.formatSpokenUpdate(text);
    res.json({ raw: text, spokenText: spoken });
  });

  router.post("/jarvis/voice/wakeword", requireSession, express.json(), (req, res) => {
    const phrase = req.body?.phrase || "";
    const result = voice.processWakeWord(phrase);
    res.json(result);
  });

  // --- Vision Engine ---
  router.post("/jarvis/vision/validate", requireSession, express.json(), (req, res) => {
    const result = vision.validateImageInput(req.body);
    res.json(result);
  });

  // --- Multi-Device Hub ---
  router.post("/jarvis/devices/pair/request", requireSession, express.json(), (req, res) => {
    const code = deviceHub.createPairingCode(req.body || {});
    res.json(code);
  });

  router.post("/jarvis/devices/pair/verify", requireSession, express.json(), (req, res) => {
    const result = deviceHub.verifyPairingCode(req.body?.code);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  router.get("/jarvis/devices", requireSession, (_req, res) => {
    res.json({ devices: deviceHub.listPairedDevices() });
  });

  router.post("/jarvis/notifications", requireSession, express.json(), (req, res) => {
    const notif = deviceHub.sendNotification(req.body || {});
    res.status(201).json(notif);
  });

  // --- Smart Home ---
  router.get("/jarvis/smarthome/devices", requireSession, (_req, res) => {
    res.json({ entities: smartHome.listEntities() });
  });

  router.post("/jarvis/smarthome/actuate", requireSession, express.json(), async (req, res) => {
    const { entityId, state, approved } = req.body || {};
    try {
      const result = await smartHome.setDeviceState(entityId, state, Boolean(approved));
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // --- Productivity ---
  router.get("/jarvis/productivity/briefing", requireSession, (_req, res) => {
    const telemetry = computer.getSystemTelemetry();
    const briefing = productivity.generateDailyBriefing({ telemetry });
    res.json({ briefing });
  });

  router.post("/jarvis/productivity/reminders", requireSession, express.json(), (req, res) => {
    try {
      const rem = productivity.addReminder(req.body || {});
      res.status(201).json(rem);
    } catch (err) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.get("/jarvis/productivity/reminders", requireSession, (_req, res) => {
    res.json({ reminders: productivity.listReminders() });
  });

  // --- Audit Trail ---
  router.get("/jarvis/audit", requireSession, (_req, res) => {
    res.json({ logs: orchestrator.getAuditLogs() });
  });

  return router;
}
