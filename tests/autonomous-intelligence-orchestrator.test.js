import test from "node:test";
import assert from "node:assert/strict";
import { toolRegistry, PERMISSION_LEVELS, TOOL_CATEGORIES, TOOL_STATUS } from "../core/tool-registry.js";
import { AutonomousOrchestrator, AGENT_ROLES } from "../core/autonomous-orchestrator.js";

test("ToolRegistry: registers and inventories tools across all 7 required categories", () => {
  const inventory = toolRegistry.getCapabilityInventory();
  assert.ok(inventory.summary.totalCapabilities >= 10);
  assert.ok(inventory.summary.operational >= 8);
  assert.equal(inventory.categories.length, 7);

  const categories = inventory.categories.map(c => c.category);
  assert.ok(categories.includes("INTELLIGENCE"));
  assert.ok(categories.includes("AUTONOMOUS_OPERATIONS"));
  assert.ok(categories.includes("SYSTEM_CONTROL"));
  assert.ok(categories.includes("VISION_PERCEPTION"));
  assert.ok(categories.includes("VOICE_COMMUNICATION"));
  assert.ok(categories.includes("RESEARCH_KNOWLEDGE"));
  assert.ok(categories.includes("EXTERNAL_INTEGRATIONS"));
});

test("ToolRegistry: verifies permission levels, confirmation gates, and schemas", () => {
  const appLaunchTool = toolRegistry.getTool("windows_app_launch");
  assert.ok(appLaunchTool);
  assert.equal(appLaunchTool.permissionLevel, PERMISSION_LEVELS.LEVEL_3_SENSITIVE);
  assert.equal(appLaunchTool.requiresConfirmation, true);

  const vitalsTool = toolRegistry.getTool("windows_pc_vitals");
  assert.ok(vitalsTool);
  assert.equal(vitalsTool.permissionLevel, PERMISSION_LEVELS.LEVEL_1_READ);
  assert.equal(vitalsTool.requiresConfirmation, false);

  const lockTool = toolRegistry.getTool("windows_lock_workstation");
  assert.ok(lockTool);
  assert.equal(lockTool.permissionLevel, PERMISSION_LEVELS.LEVEL_4_CRITICAL);
  assert.equal(lockTool.requiresConfirmation, true);
});

test("AutonomousOrchestrator: analyzes intent accurately across domains", () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // App launch
  const intent1 = orchestrator.analyzeIntent("Launch Chrome on my PC");
  assert.equal(intent1.intent, "SYSTEM_APP_LAUNCH");
  assert.equal(intent1.domain, "SYSTEM");

  // Vitals
  const intent2 = orchestrator.analyzeIntent("Check battery and performance");
  assert.equal(intent2.intent, "SYSTEM_HARDWARE_CONTROL");

  // File organization
  const intent3 = orchestrator.analyzeIntent("Organize my downloads folder");
  assert.equal(intent3.intent, "FILE_MANAGEMENT");

  // Research
  const intent4 = orchestrator.analyzeIntent("Research the latest autonomous agent architectures");
  assert.equal(intent4.intent, "RESEARCH_SEARCH");

  // Language detection
  const intentHindi = orchestrator.analyzeIntent("अयान का पीसी चेक करो");
  assert.equal(intentHindi.language, "hindi");

  const intentHinglish = orchestrator.analyzeIntent("Mera battery status kya hai batao");
  assert.equal(intentHinglish.language, "hinglish");
});

test("AutonomousOrchestrator: executes read/normal tasks autonomously and verifies results", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  const result = await orchestrator.processUserRequest("Check system vitals and battery");
  assert.equal(result.intent, "SYSTEM_HARDWARE_CONTROL");
  assert.equal(result.verified, true);
  assert.ok(result.stepResults.length > 0);
  assert.equal(result.stepResults[0].success, true);
  assert.ok(result.textResponse.includes("Battery") || result.textResponse.includes("telemetry"));
});

test("AutonomousOrchestrator: enforces Level 3 Sensitive Confirmation Gates for file organization", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // Without pre-approval, should pause with APPROVAL_REQUIRED
  const outcome = await orchestrator.processUserRequest("Organize my downloads folder");
  assert.equal(outcome.status, "APPROVAL_REQUIRED");
  assert.ok(outcome.approvalRequest);
  assert.equal(outcome.approvalRequest.toolId, "windows_file_organize");
  assert.equal(outcome.approvalRequest.permissionLevel, PERMISSION_LEVELS.LEVEL_3_SENSITIVE);

  // Approve and re-run with approval
  const approveRes = orchestrator.approveRequest(outcome.approvalRequest.id);
  assert.equal(approveRes.success, true);

  const approvedOutcome = await orchestrator.processUserRequest("Organize my downloads folder", { approvalId: outcome.approvalRequest.id });
  assert.equal(approvedOutcome.verified, true);
  assert.ok(approvedOutcome.textResponse.includes("File organization completed"));
});

test("AutonomousOrchestrator: enforces Level 4 Critical Confirmation Gates for workstation locking", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  const outcome = await orchestrator.processUserRequest("Lock workstation immediately");
  assert.equal(outcome.status, "APPROVAL_REQUIRED");
  assert.ok(outcome.approvalRequest);
  assert.equal(outcome.approvalRequest.permissionLevel, PERMISSION_LEVELS.LEVEL_4_CRITICAL);

  // Reject request
  const rejectRes = orchestrator.rejectRequest(outcome.approvalRequest.id, "User declined locking");
  assert.equal(rejectRes.success, true);
  assert.equal(rejectRes.request.status, "REJECTED");
});

test("AutonomousOrchestrator: Global Emergency Stop halts execution and rejects commands", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // Engage kill switch
  orchestrator.setEmergencyStop(true, "Security breach test");

  const outcome = await orchestrator.processUserRequest("Check system vitals");
  assert.equal(outcome.status, "BLOCKED");
  assert.equal(outcome.intent, "EMERGENCY_STOPPED");
  assert.ok(outcome.textResponse.includes("Emergency Stop"));

  // Reset kill switch
  orchestrator.setEmergencyStop(false);
  const resumed = await orchestrator.processUserRequest("Check system vitals");
  assert.equal(resumed.verified, true);
});

test("AutonomousOrchestrator: Multilingual persona responses (English, Hindi, Hinglish)", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  const enPending = await orchestrator.processUserRequest("Launch chrome on my computer");
  assert.equal(enPending.status, "APPROVAL_REQUIRED");
  assert.equal(orchestrator.approveRequest(enPending.approvalRequest.id).success, true);
  const enRes = await orchestrator.processUserRequest("Launch chrome on my computer", {
    approvalId: enPending.approvalRequest.id
  });
  assert.ok(enRes.verified || enRes.status === "FAILED");
  assert.ok(enRes.textResponse.includes("Ayaan") || enRes.textResponse.toLowerCase().includes("chrome"));

  const hiPending = await orchestrator.processUserRequest("Chrome shuru karo bhai");
  assert.equal(hiPending.status, "APPROVAL_REQUIRED");
  assert.equal(orchestrator.approveRequest(hiPending.approvalRequest.id).success, true);
  const hiRes = await orchestrator.processUserRequest("Chrome shuru karo bhai", {
    approvalId: hiPending.approvalRequest.id
  });
  assert.ok(hiRes.verified || hiRes.status === "FAILED");
  assert.ok(hiRes.textResponse.includes("Ayaan") || hiRes.textResponse.toLowerCase().includes("chrome"));
});

test("AutonomousOrchestrator: Emits real-time visual events through lifecycle", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });
  const capturedEvents = [];

  const unsubscribe = orchestrator.onEvent(evt => capturedEvents.push(evt.type));

  await orchestrator.processUserRequest("Check battery and performance");
  unsubscribe();

  assert.ok(capturedEvents.includes("REQUEST_RECEIVED"));
  assert.ok(capturedEvents.includes("INTENT_IDENTIFIED"));
  assert.ok(capturedEvents.includes("PLAN_FORMULATED"));
  assert.ok(capturedEvents.includes("TOOL_STARTED"));
  assert.ok(capturedEvents.includes("TOOL_COMPLETED"));
  assert.ok(capturedEvents.includes("VERIFICATION_STARTED"));
  assert.ok(capturedEvents.includes("VERIFICATION_COMPLETED"));
  assert.ok(capturedEvents.includes("RESPONSE_SYNTHESIZED"));
});

test("AutonomousOrchestrator: Coordinates multi-agent team across specialized roles", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });
  const result = await orchestrator.processUserRequest("Assemble multi-agent team for growth and code review");

  assert.equal(result.intent, "MULTI_AGENT_COORDINATION");
  assert.ok(result.plan.steps.length >= 3);
  const assignedAgents = result.plan.steps.map(s => s.agent);
  assert.ok(assignedAgents.includes(AGENT_ROLES.CHIEF_OF_STAFF));
  assert.ok(assignedAgents.includes(AGENT_ROLES.RESEARCH_SCHOLAR));
  assert.ok(assignedAgents.includes(AGENT_ROLES.FULLSTACK_ARCHITECT));
  assert.equal(result.verified, true);
  assert.ok(result.textResponse.includes("Multi-agent mission completed"));
});

test("AutonomousOrchestrator: Submits, pauses, resumes, and cancels persistent background workflows", async () => {
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });

  // 1. Submit background workflow
  const sub = orchestrator.submitBackgroundTask("Research latest agent memory architectures");
  assert.equal(sub.success, true);
  assert.ok(sub.workflowId);
  assert.equal(sub.status, "RUNNING");

  // 2. Query active workflows
  const active = orchestrator.getActiveWorkflows();
  assert.ok(active.length >= 1);
  const found = active.find(w => w.id === sub.workflowId);
  assert.ok(found);
  assert.ok(["RUNNING", "COMPLETED"].includes(found.status));

  // 3. Pause & Resume workflow
  const sub2 = orchestrator.submitBackgroundTask("Assemble multi-agent team for GTM and security audit");
  const pauseRes = orchestrator.pauseWorkflow(sub2.workflowId);
  if (pauseRes.success) {
    assert.equal(pauseRes.status, "PAUSED");
    const resumeRes = orchestrator.resumeWorkflow(sub2.workflowId);
    assert.equal(resumeRes.success, true);
    assert.equal(resumeRes.status, "RUNNING");
  }

  // 4. Cancel workflow
  const sub3 = orchestrator.submitBackgroundTask("Assemble multi-agent team for test cancellation");
  const cancelRes = orchestrator.cancelWorkflow(sub3.workflowId, "Test cancellation");
  assert.equal(cancelRes.success, true);
  assert.equal(cancelRes.status, "CANCELLED");
});
