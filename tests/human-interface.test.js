import test from "node:test";
import assert from "node:assert/strict";
import { HumanIntelligenceInterface } from "../intelligence/human-interface.js";

test("HumanIntelligenceInterface: user preferences persistence and retrieval", () => {
  const hii = new HumanIntelligenceInterface();

  const initial = hii.getPreferences("user-ayaan");
  assert.equal(initial.preferredVoice, "am_onyx");
  assert.equal(initial.voiceSpeed, 0.95);

  hii.setPreferences("user-ayaan", {
    preferredLanguage: "hinglish",
    voiceSpeed: 1.05,
    verbosity: "concise"
  });

  const updated = hii.getPreferences("user-ayaan");
  assert.equal(updated.preferredLanguage, "hinglish");
  assert.equal(updated.voiceSpeed, 1.05);
  assert.equal(updated.verbosity, "concise");
});

test("HumanIntelligenceInterface: processes Roman Hinglish with emotion-aware voice modulation", async () => {
  const hii = new HumanIntelligenceInterface();
  const res = await hii.processInteraction("user-ayaan", "Bhai main bohot stressed hoon, exam pass nahi ho raha.");

  assert.equal(res.input.language, "hinglish");
  assert.equal(res.input.dialect, "conversational_hinglish");
  assert.ok(res.emotionalIntelligence.primaryEmotion);
  // Stressed/anxious user triggers reassuring slower speed modulation
  assert.ok(res.vocalProfile.speed <= 0.95);
  assert.equal(res.vocalProfile.voiceId, "am_onyx");
  assert.ok(res.uiEvent.themeColor);
  assert.ok(res.uiEvent.statusText.includes("ULTRON"));
});

test("HumanIntelligenceInterface: processes English excited achievement with enthusiastic modulation", async () => {
  const hii = new HumanIntelligenceInterface();
  const res = await hii.processInteraction("user-ayaan", "Incredible victory! We finally cracked the robotics simulation perfectly!");

  assert.equal(res.input.language, "en");
  assert.ok(res.emotionalIntelligence.primaryEmotion);
  assert.equal(res.vocalProfile.voiceId, "am_onyx");
  assert.ok(res.uiEvent.waveformFrequency > 0);
});

test("HumanIntelligenceInterface: voice synthesis integrates with Kokoro am_onyx engine", async () => {
  const hii = new HumanIntelligenceInterface();
  const synthRes = await hii.synthesizeVoice("user-ayaan", "Systems online. All human interface systems operational.");

  assert.ok(synthRes.id.startsWith("kokoro-"));
  assert.equal(synthRes.voice, "am_onyx");
  assert.equal(synthRes.sampleRate, 24000);
  assert.ok(synthRes.dataUrl.startsWith("data:audio/wav;base64,"));
});
