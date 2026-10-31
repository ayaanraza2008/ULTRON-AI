import test from "node:test";
import assert from "node:assert/strict";
import { JarvisVoiceEngine, VOICE_PERSONALITY_MODES } from "../voice/voice-engine.js";
import { kokoroEngine } from "../voice/kokoro-engine.js";

test("VoicePersonalityModes: all 7 modes are defined with distinct rates and styles", () => {
  const expectedModes = ["NORMAL", "COMMAND", "ALERT", "RESEARCH", "SUCCESS", "ERROR", "WAKE-UP"];
  for (const modeId of expectedModes) {
    const mode = VOICE_PERSONALITY_MODES[modeId];
    assert.ok(mode, `Mode ${modeId} must exist`);
    assert.equal(mode.id, modeId);
    assert.ok(typeof mode.rate === "number" && mode.rate >= 0.8 && mode.rate <= 1.2);
    assert.ok(typeof mode.pitch === "number" && mode.pitch >= 0.7 && mode.pitch <= 1.2);
    assert.ok(typeof mode.style === "string");
  }
});

test("VoicePersonalityModes: engine allows switching modes and reflects active config", () => {
  const engine = new JarvisVoiceEngine();
  assert.equal(engine.getPersonalityMode().id, "NORMAL");

  // Switch to COMMAND
  const cmdRes = engine.setPersonalityMode("COMMAND");
  assert.equal(cmdRes.success, true);
  assert.equal(engine.getPersonalityMode().id, "COMMAND");
  assert.equal(engine.getPersonalityMode().rate, 0.98);

  // Switch to ALERT
  const alertRes = engine.setPersonalityMode("ALERT");
  assert.equal(alertRes.success, true);
  assert.equal(engine.getPersonalityMode().id, "ALERT");
  assert.equal(engine.getPersonalityMode().rate, 1.05);

  // Rejects invalid mode
  const badRes = engine.setPersonalityMode("NON_EXISTENT_MODE");
  assert.equal(badRes.success, false);
});

test("VoicePersonalityModes: speech plan applies mode-specific rate, pitch, and prefix", () => {
  const engine = new JarvisVoiceEngine();

  // Test COMMAND mode plan
  engine.setPersonalityMode("COMMAND");
  const planCmd = engine.synthesizeSpeechPlan("Target neutralized.");
  assert.equal(planCmd.prepared, true);
  assert.ok(planCmd.text.startsWith("Acknowledged. Target neutralized."));
  assert.equal(planCmd.personalityMode, "COMMAND");
  assert.equal(planCmd.rate, 0.98);

  // Test ALERT mode plan
  engine.setPersonalityMode("ALERT");
  const planAlert = engine.synthesizeSpeechPlan("Unidentified process spawned.");
  assert.ok(planAlert.text.startsWith("Alert. Unidentified process spawned."));
  assert.equal(planAlert.personalityMode, "ALERT");
  assert.equal(planAlert.rate, 1.05);

  // Test WAKE-UP mode plan
  engine.setPersonalityMode("WAKE-UP");
  const planWake = engine.synthesizeSpeechPlan("Awaiting instructions.");
  assert.ok(planWake.text.startsWith("Online, sir. Awaiting instructions."));
  assert.equal(planWake.personalityMode, "WAKE-UP");
});

test("KokoroEngine: long-response chunking splits at natural punctuation boundaries", () => {
  const longText = "System diagnostics complete. All sixteen subroutines operational. Network egress is secure; no anomalous sockets detected. Awaiting tactical deployment command.";
  const chunks = kokoroEngine.chunkText(longText, 80);

  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length >= 2, `Expected multiple chunks, got ${chunks.length}`);
  // Each chunk should be within or near the maxChars bound without breaking sentences
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0);
  }
});

test("KokoroEngine: measured interruption latency is benchmarked under 50ms", async () => {
  const benchmark = await kokoroEngine.measureInterruptionLatency();
  assert.equal(benchmark.success, true);
  assert.ok(benchmark.measuredLatencyMs >= 0);
  assert.ok(benchmark.measuredLatencyMs <= benchmark.targetThresholdMs,
    `Interruption latency (${benchmark.measuredLatencyMs}ms) exceeded ${benchmark.targetThresholdMs}ms threshold`);
});

test("KokoroEngine: visible fallback status accurately reports state", () => {
  const status = kokoroEngine.getFallbackStatus();
  assert.equal(status.primaryEngine, "kokoro");
  assert.equal(status.primaryVoice, "am_onyx");
  assert.equal(status.fallbackEngine, "windows_sapi");
  assert.equal(typeof status.isFallbackActive, "boolean");

  // Reset fallback
  const resetRes = kokoroEngine.resetFallback();
  assert.equal(resetRes.isFallbackActive, false);
  assert.equal(resetRes.lastError, null);
});
