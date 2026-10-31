import test from "node:test";
import assert from "node:assert/strict";
import { JarvisVoiceEngine, VOICE_PROFILES } from "../voice/voice-engine.js";
import { JarvisVisionEngine } from "../vision/vision-engine.js";

test("Voice Engine: detects wake words (Ultron and Jarvis)", () => {
  const engine = new JarvisVoiceEngine();

  const ultronWake = engine.processWakeWord("Hey Ultron, what is the weather today?");
  assert.equal(ultronWake.triggered, true);
  assert.equal(ultronWake.wakeWord, "ultron");
  assert.ok(ultronWake.remainingPrompt.includes("weather"));

  const jarvisWake = engine.processWakeWord("Jarvis please analyze this system log");
  assert.equal(jarvisWake.triggered, true);
  assert.equal(jarvisWake.wakeWord, "jarvis");

  const noWake = engine.processWakeWord("What is the capital of France?");
  assert.equal(noWake.triggered, false);
});

test("Voice Engine: formats natural spoken text without markdown or code", () => {
  const engine = new JarvisVoiceEngine();
  const rawText = "Here is the result:\n```javascript\nconsole.log('test');\n```\nVisit [GitHub](https://github.com) for **details**.";
  const spoken = engine.formatSpokenUpdate(rawText);

  assert.ok(!spoken.includes("```"));
  assert.ok(!spoken.includes("**"));
  assert.ok(!spoken.includes("https://"));
  assert.ok(spoken.includes("details"));
  assert.ok(spoken.includes("Code block omitted for speech."));
});

test("Voice Engine: supports voice interruption and profiles", () => {
  const engine = new JarvisVoiceEngine();
  const result = engine.setProfile("jarvis_prime");
  assert.equal(result.success, true);
  assert.equal(engine.getProfile().id, "jarvis_prime");

  const stop = engine.triggerInterruption();
  assert.equal(stop.action, "AUDIO_STOPPED");
  assert.equal(engine.interrupted, true);

  engine.resetInterruption();
  assert.equal(engine.interrupted, false);
});

test("Vision Engine: validates image byte bounds and formats", () => {
  const engine = new JarvisVisionEngine({ maxBytes: 1024 * 1024 });

  const validBuffer = Buffer.alloc(100 * 1024);
  const checkValid = engine.validateImageInput({ buffer: validBuffer, format: "png" });
  assert.equal(checkValid.valid, true);
  assert.equal(checkValid.format, "png");

  const oversizedBuffer = Buffer.alloc(2 * 1024 * 1024);
  const checkOversized = engine.validateImageInput({ buffer: oversizedBuffer, format: "png" });
  assert.equal(checkValid.valid, true);
  assert.equal(checkOversized.valid, false);
  assert.equal(checkOversized.error, "IMAGE_TOO_LARGE");
});

test("Vision Engine: redacts credentials from visual OCR text", () => {
  const engine = new JarvisVisionEngine();
  const rawOcr = "Found API key: sk-abcdef1234567890abcdef1234567890 and token: ghp_123456789012345678901234567890123456";
  const sanitized = engine.sanitizeOcrText(rawOcr);

  assert.ok(!sanitized.includes("sk-abcdef"));
  assert.ok(!sanitized.includes("ghp_"));
  assert.ok(sanitized.includes("[REDACTED_CREDENTIAL]"));
});
