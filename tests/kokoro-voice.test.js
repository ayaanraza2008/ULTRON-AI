import test from "node:test";
import assert from "node:assert/strict";
import { KokoroEngine, kokoroEngine } from "../voice/kokoro-engine.js";
import { JarvisVoiceEngine, VOICE_PROFILES } from "../voice/voice-engine.js";
import { WindowsSpeechDaemon } from "../voice/windows-speech-daemon.js";

test("KokoroEngine: configuration defaults to am_onyx at speed 0.95", () => {
  const engine = new KokoroEngine();
  assert.equal(engine.defaultVoice, "am_onyx");
  assert.equal(engine.defaultSpeed, 0.95);
  assert.equal(engine.isSpeaking, false);
});

test("KokoroEngine: voice profiles configure am_onyx for ULTRON personas", () => {
  assert.equal(VOICE_PROFILES.ultron_onyx.voiceId, "am_onyx");
  assert.equal(VOICE_PROFILES.ultron_onyx.engine, "kokoro");
  assert.equal(VOICE_PROFILES.ultron_onyx.rate, 0.95);

  assert.equal(VOICE_PROFILES.ultron_command.voiceId, "am_onyx");
  assert.equal(VOICE_PROFILES.ultron_command.engine, "kokoro");
  assert.equal(VOICE_PROFILES.ultron_command.rate, 0.95);
});

test("KokoroEngine: interruption cleanly halts synthesis and flags state", () => {
  const engine = new KokoroEngine();
  engine.isSpeaking = true;
  const result = engine.interrupt();

  assert.equal(result.action, "AUDIO_INTERRUPTED");
  assert.equal(engine.isSpeaking, false);
  assert.ok(result.timestamp);
});

test("KokoroEngine: synthesizes Audition Script 1 (Introduction) with am_onyx", async () => {
  const script1 = "Systems online. I am ULTRON. All core processes are operational. Awaiting your command.";
  const res = await kokoroEngine.synthesize(script1, { voice: "am_onyx", speed: 0.95 });

  assert.ok(res.id.startsWith("kokoro-"));
  assert.equal(res.voice, "am_onyx");
  assert.equal(res.sampleRate, 24000);
  assert.ok(res.durationSec >= 4.0, `Expected duration >= 4.0s, got ${res.durationSec}s`);
  assert.ok(res.dataUrl.startsWith("data:audio/wav;base64,"));
  // Real-Time Factor (generation time / audio duration) should be well under 1.0 (faster than real-time)
  const rtf = res.generationTimeSec / res.durationSec;
  assert.ok(rtf < 1.0, `Expected RTF < 1.0, got ${rtf.toFixed(2)}`);
});

test("KokoroEngine: synthesizes Roman Hinglish sentence naturally", async () => {
  const hinglishScript = "Systems online. Main ULTRON hoon. Tumhara system ready hai.";
  const res = await kokoroEngine.synthesize(hinglishScript, { voice: "am_onyx", speed: 0.95 });

  assert.equal(res.voice, "am_onyx");
  assert.equal(res.sampleRate, 24000);
  assert.ok(res.durationSec >= 2.0);
  assert.ok(res.dataUrl.startsWith("data:audio/wav;base64,"));
});

test("KokoroEngine: integration with JarvisVoiceEngine speakKokoro helper", async () => {
  const voice = new JarvisVoiceEngine();
  assert.ok(voice.activeProfile.voiceId === "am_onyx");

  const res = await voice.speakKokoro("Status verified.");
  assert.ok(res.id.startsWith("kokoro-"));
  assert.equal(res.voice, "am_onyx");
  assert.ok(res.durationSec > 0.5);
});

test("KokoroEngine: audio history records recent synthesis entries", () => {
  const history = kokoroEngine.getAudioHistory();
  assert.ok(Array.isArray(history));
  assert.ok(history.length > 0);
  const latest = history[history.length - 1];
  assert.equal(latest.voice, "am_onyx");
  assert.ok(latest.dataUrl.startsWith("data:audio/wav;base64,"));
});
