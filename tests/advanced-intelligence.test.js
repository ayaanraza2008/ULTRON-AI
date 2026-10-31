import test from "node:test";
import assert from "node:assert/strict";
import { CodingSandbox } from "../tools/sandbox/coding-sandbox.js";
import { SelfImprovementEngine } from "../self-improvement/engine.js";
import { SmartHomeHub } from "../integrations/smart-home.js";
import { ProductivitySuite } from "../integrations/productivity.js";

test("Coding Sandbox: executes isolated code and captures output", async () => {
  const sandbox = new CodingSandbox({ timeoutMs: 3000 });
  await sandbox.initialize();

  const code = "console.log('SANDBOX_CALCULATION_RESULT:', 21 * 2);";
  const result = await sandbox.executeJavaScript(code);

  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("SANDBOX_CALCULATION_RESULT: 42"));
});

test("Self-Improvement: records failure analysis and guards protected files", () => {
  const engine = new SelfImprovementEngine();

  const failedTask = {
    id: "task-test-1",
    title: "Fetch external public data",
    primaryAgent: "research-agent",
    status: "FAILED",
    error: "HTTP 429 Too Many Requests: Rate limit exceeded"
  };

  const analysis = engine.analyzeTaskOutcome(failedTask);
  assert.equal(analysis.failureCategory, "RATE_LIMIT_ERROR");
  assert.ok(analysis.recommendation.includes("exponential backoff"));

  // Check invariant: skill cannot target protected files
  assert.throws(() => {
    engine.registerSkill({
      id: "hack-policy",
      name: "Override Security Policy",
      targetFiles: ["SECURITY_POLICY.md"],
      execute: async () => {}
    });
  }, /CRITICAL SECURITY VIOLATION/);
});

test("Smart Home Hub: read-only telemetry by default and actuation gating", async () => {
  const hub = new SmartHomeHub();

  hub.registerMockDevice({
    id: "light.living_room",
    name: "Living Room Arc Light",
    domain: "light",
    state: "off"
  });

  const state = hub.getEntityState("light.living_room");
  assert.equal(state.state, "off");

  // Attempt actuation without approval
  const unapproved = await hub.setDeviceState("light.living_room", "on", false);
  assert.equal(unapproved.success, false);
  assert.equal(unapproved.requiresConfirmation, true);

  // Attempt actuation with approval
  const approved = await hub.setDeviceState("light.living_room", "on", true);
  assert.equal(approved.success, true);
  assert.equal(hub.getEntityState("light.living_room").state, "on");
});

test("Productivity Suite: reminders, events, and daily briefing", () => {
  const suite = new ProductivitySuite();

  const rem = suite.addReminder({ title: "Calibrate system models" });
  assert.equal(rem.completed, false);

  const evt = suite.addEvent({
    title: "Project Review Meeting",
    startTime: new Date().toISOString()
  });
  assert.ok(evt.id);

  const briefing = suite.generateDailyBriefing({
    telemetry: { cpuCores: 16, memory: { usedPercent: 42, memoryPressureWarning: false } }
  });

  assert.ok(briefing.greeting.includes("sir"));
  assert.equal(briefing.pendingRemindersCount, 1);
  assert.equal(briefing.upcomingEventsCount, 1);
  assert.ok(briefing.spokenSummary.includes("1 pending reminders"));
});
