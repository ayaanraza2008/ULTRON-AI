import test from "node:test";
import assert from "node:assert/strict";
import {
  nayaVoiceIntelligence,
  NayaVoiceIntelligence,
  NAYA_WAKE_WORDS,
  VOICE_STATES
} from "../intelligence/naya/naya-voice.js";

test("NAYA Voice: Wake word detection with embedded command extraction", () => {
  const voice = new NayaVoiceIntelligence();

  // Plain wake word
  const r1 = voice.detectWakeWord("naya");
  assert.equal(r1.detected, true);
  assert.equal(r1.command, "");
  assert.equal(r1.wakeWord, "naya");

  // Wake word with command
  const r2 = voice.detectWakeWord("hey naya, check my battery level");
  assert.equal(r2.detected, true);
  assert.equal(r2.command, "check my battery level");
  assert.equal(r2.wakeWord, "hey naya");

  // Hindi wake phrase
  const r3 = voice.detectWakeWord("suno naya aaj ka mausam kaisa hai");
  assert.equal(r3.detected, true);
  assert.equal(r3.command, "aaj ka mausam kaisa hai");
  assert.equal(r3.wakeWord, "suno naya");

  // Non wake word
  const r4 = voice.detectWakeWord("what is the weather today");
  assert.equal(r4.detected, false);
});

test("NAYA Voice: Absolute silence protocol filters ambient YouTube & song lyrics", () => {
  const voice = new NayaVoiceIntelligence();
  voice.setState(VOICE_STATES.IDLE);

  // Background media patterns must be ignored
  assert.equal(voice.shouldIgnoreAudio("subscribe to my channel and check out the link in description"), true);
  assert.equal(voice.shouldIgnoreAudio("please like share and subscribe"), true);

  // User command directed at NAYA must NOT be ignored
  assert.equal(voice.shouldIgnoreAudio("hey naya what is the time"), false);
  assert.equal(voice.shouldIgnoreAudio("naya open vs code"), false);
});

test("NAYA Voice: Trilingual speech segmentation (Hindi, English, Hinglish)", () => {
  const voice = new NayaVoiceIntelligence();

  const englishSegs = voice.segmentSpeech("System status is nominal. All services are running.");
  assert.equal(englishSegs.length, 2);
  assert.equal(englishSegs[0].language, "en-IN");
  assert.equal(englishSegs[0].femaleVoice, "af_bella");

  const hindiSegs = voice.segmentSpeech("नमस्ते, मैं नया हूँ। आपकी क्या मदद करूँ?");
  assert.equal(hindiSegs.length, 2);
  assert.equal(hindiSegs[0].language, "hi-IN");

  const hinglishSegs = voice.segmentSpeech("Aaj ka kaam complete ho gaya hai Boss.");
  assert.equal(hinglishSegs.length, 1);
  assert.equal(hinglishSegs[0].femaleVoice, "af_bella");
});

test("NAYA Voice: Vocal parameter modulation across personality modes", () => {
  const voice = new NayaVoiceIntelligence();

  const jarvisParams = voice.getVocalParameters("PROFESSIONAL_JARVIS");
  assert.equal(jarvisParams.voice, "af_bella");
  assert.equal(jarvisParams.speed, 0.95);
  assert.equal(jarvisParams.gender, "female");

  const mentorParams = voice.getVocalParameters("STRICT_MENTOR");
  assert.equal(mentorParams.speed, 0.92, "Strict mentor voice must be slightly slower and firmer");

  const friendParams = voice.getVocalParameters("BEST_FRIEND");
  assert.equal(friendParams.speed, 0.98, "Best friend voice must be natural and upbeat");

  const minimalParams = voice.getVocalParameters("MINIMAL_RESPONSE");
  assert.equal(minimalParams.speed, 1.02, "Minimal response voice must be crisp and fast");
});

test("NAYA Voice: Sub-50ms speech interruption and mute handling", () => {
  const voice = new NayaVoiceIntelligence();
  voice.setState(VOICE_STATES.SPEAKING);

  const interruptResult = voice.interrupt();
  assert.equal(interruptResult.success, true);
  assert.equal(interruptResult.state, VOICE_STATES.INTERRUPTED);
  assert.ok(interruptResult.latencyMs < 50, "Interruption latency must benchmark under 50ms");

  const muteResult = voice.setMute(true);
  assert.equal(muteResult.isMuted, true);
  assert.equal(voice.state, VOICE_STATES.MUTED);
});
