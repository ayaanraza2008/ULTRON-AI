import test from "node:test";
import assert from "node:assert/strict";
import { BrainRouter } from "../core/brain-router.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";
import { JarvisVoiceEngine } from "../voice/voice-engine.js";
import { verifyAutonomousOutput } from "../autonomous-quality-gate.js";
import { canExecuteAutonomously, checkHardwareHeadroom } from "../autonomy-policy.js";

test("Full Autonomous Task Lifecycle: Request → Intent → Plan → Decompose → Agent Select → Tool Select → Permission Check → Execute → Validate → Persist → Report", async () => {
  const brain = new BrainRouter();
  const orchestrator = new AgentOrchestrator({ defaultAutonomyLevel: 3 });
  const voice = new JarvisVoiceEngine();

  // Stage 1: User Request
  const userRequest = "Research AMD Ryzen 7 5700U memory management strategies and draft an optimization brief";

  // Stage 2: Intent Understanding & Language Detection
  const complexity = brain.classifyComplexity(userRequest);
  const lang = brain.detectLanguage(userRequest);
  assert.equal(lang.language, "en");
  assert.ok(["complex", "analytical", "routine"].includes(complexity.tier));

  // Stage 3 & 4: Planning & Task Decomposition
  const task = orchestrator.createTask({
    id: "task-lifecycle-001",
    title: userRequest,
    targetAgentId: "planning-agent",
    steps: [
      {
        id: "step-1-gather",
        agentId: "research-agent",
        action: "tavily_search",
        payload: { query: "Ryzen 7 5700U 8GB RAM memory headroom optimization" }
      },
      {
        id: "step-2-synthesize",
        agentId: "research-agent",
        action: "synthesize_report",
        payload: { targetChars: 500 }
      }
    ],
    input: { request: userRequest }
  });

  assert.equal(task.id, "task-lifecycle-001");
  assert.equal(task.steps.length, 2);
  assert.equal(task.status, "QUEUED");

  // Stage 5 & 6: Agent Selection & Tool Allowlist Verification
  for (const step of task.steps) {
    const agent = orchestrator.agents.get(step.agentId);
    assert.ok(agent, `Agent ${step.agentId} must be registered in catalog`);
    // Tools or high-level actions must map to approved agent boundaries
    assert.ok(agent.role.length > 0);
  }

  // Stage 7: Permission & Hardware Headroom Check
  const headroom = checkHardwareHeadroom({ memory: { usedPercent: 65 } });
  assert.equal(headroom.safeToExecute, true);
  assert.equal(headroom.maxConcurrentAllowed, 4);

  const canExecute = canExecuteAutonomously("research_query", orchestrator.getAutonomyLevel());
  assert.equal(canExecute.allowed, true);

  // Stage 8: Execution with Step Executor
  let executedCount = 0;
  const mockResearchDeliverable = {
    sources: [
      { url: "https://amd.com/en/products/processors/laptop/ryzen-5000-series/amd-ryzen-7-5700u.html", title: "AMD Specs" }
    ],
    content: "AMD Ryzen 7 5700U features 8 cores, 16 threads, and integrated Radeon Graphics. Managing 8GB RAM requires strict child-process memory limits."
  };

  const executedTask = await orchestrator.resumeTask(task.id, async (step) => {
    executedCount += 1;
    if (step.id === "step-1-gather") {
      return { status: "success", data: mockResearchDeliverable };
    }
    if (step.id === "step-2-synthesize") {
      return {
        status: "success",
        answer: "This optimization report evaluates memory management on the AMD Ryzen 7 5700U processor. By enforcing a 256MB process heap limit, ULTRON preserves substantial RAM headroom. Source: https://amd.com/en/products/processors/laptop/ryzen-5000-series/amd-ryzen-7-5700u.html."
      };
    }
    return { status: "unknown" };
  });

  assert.equal(executedCount, 2);
  assert.equal(task.status, "COMPLETED");

  // Stage 9: Result Validation via Autonomous Quality Gate
  const quality = verifyAutonomousOutput({
    research: mockResearchDeliverable,
    report: task.artifacts["step-2-synthesize"]
  });
  assert.equal(quality.state, "passed");
  assert.ok(quality.checks.every(c => c.passed));

  // Stage 10: State Persistence & Checkpoint
  const checkpoint = orchestrator.getCheckpoint(task.id);
  assert.ok(checkpoint);
  assert.equal(checkpoint.completedSteps.length, 2);
  assert.equal(checkpoint.status, "COMPLETED");

  // Stage 11: Completion Report & Spoken Delivery
  const spokenReport = voice.formatSpokenUpdate(task.artifacts["step-2-synthesize"].answer);
  assert.ok(!spokenReport.includes("https://"));
  assert.ok(spokenReport.length > 20);

  // Audit event verify
  const auditLogs = orchestrator.getAuditLogs(10);
  assert.ok(auditLogs.some(log => log.action === "CREATE_TASK"));
  assert.ok(auditLogs.some(log => log.action === "RESUME_TASK"));
});
