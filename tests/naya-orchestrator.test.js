import test from "node:test";
import assert from "node:assert/strict";
import {
  nayaOrchestrator,
  NayaMasterOrchestrator
} from "../intelligence/naya/naya-orchestrator.js";
import { NAYA_PERSONALITY_MODES } from "../intelligence/naya/naya-personality-system.js";

test("NAYA Orchestrator: End-to-end message processing with personality adaptation", async () => {
  const orchestrator = new NayaMasterOrchestrator();

  const res1 = await orchestrator.processUserMessage("Hello Naya, how are you?", {
    mode: NAYA_PERSONALITY_MODES.BEST_FRIEND,
    userId: "test_owner"
  });

  assert.equal(res1.persona, "naya");
  assert.equal(res1.mode, NAYA_PERSONALITY_MODES.BEST_FRIEND);
  assert.ok(res1.systemPrompt.includes("BEST FRIEND"));
  assert.ok(res1.textResponse);
  assert.equal(res1.vocalSettings.voice, "af_bella");
});

test("NAYA Orchestrator: Hindi & Hinglish conversational response synthesis", async () => {
  const orchestrator = new NayaMasterOrchestrator();

  const hindiRes = await orchestrator.processUserMessage("नमस्ते नया, क्या हाल है?", {
    mode: NAYA_PERSONALITY_MODES.BEST_FRIEND,
    userId: "test_owner"
  });
  assert.ok(hindiRes.textResponse.includes("Sab theek hai") || hindiRes.textResponse.includes("NAYA"));

  const mentorHindi = await orchestrator.processUserMessage("aaj ka kya plan hai?", {
    mode: NAYA_PERSONALITY_MODES.STRICT_MENTOR,
    userId: "test_owner"
  });
  assert.ok(mentorHindi.textResponse.includes("Baatein kam") || mentorHindi.textResponse.includes("shuru"));
});

test("NAYA Orchestrator: Autonomous task detection and execution flow", async () => {
  const orchestrator = new NayaMasterOrchestrator();

  const taskRes = await orchestrator.processUserMessage("Check vitals and battery", {
    userId: "test_owner",
    autonomyLevel: 3
  });

  assert.equal(taskRes.isActionGoal, true);
  assert.ok(taskRes.executionResult);
  assert.equal(taskRes.executionResult.success, true);
  assert.equal(taskRes.executionResult.verified, true);
  assert.ok(taskRes.textResponse.includes("successfully executed"));
});

test("NAYA Orchestrator: Status reporting and telemetry", () => {
  const orchestrator = new NayaMasterOrchestrator();
  const status = orchestrator.getStatus("test_owner");

  assert.equal(status.persona, "naya");
  assert.equal(status.version, "3.0.0-ERA");
  assert.equal(status.availableModesCount, 20);
  assert.equal(typeof status.autonomyLevel, "number");
  assert.equal(status.vocalVoice, "af_bella");
  assert.ok(status.memoryStats);
});
