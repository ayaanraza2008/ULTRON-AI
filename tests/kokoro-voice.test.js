import test from "node:test";
import assert from "node:assert/strict";
import { KokoroEngine, kokoroEngine } from "../voice/kokoro-engine.js";
import { JarvisVoiceEngine, VOICE_PROFILES } from "../voice/voice-engine.js";
import { WindowsSpeechDaemon } from "../voice/windows-speech-daemon.js";

test("KokoroEngine: explicit fallback output is a diagnostic tone, never a speech result", () => {
  const engine = new KokoroEngine();
  const result = engine.generateFallbackWav("Diagnostic only.");
  assert.equal(result.speechAvailable, false);
  assert.equal(result.audioKind, "diagnostic_tone");
  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "KOKORO_RUNTIME_UNAVAILABLE");
  assert.ok(result.dataUrl.startsWith("data:audio/wav;base64,"));
});

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

test("KokoroEngine: labels Audition Script WAV as speech only when the real model runtime is available", async () => {
  const script1 = "Systems online. I am ULTRON. All core processes are operational. Awaiting your command.";
  const res = await kokoroEngine.synthesize(script1, { voice: "am_onyx", speed: 0.95 });

  assert.ok(res.id.startsWith("kokoro-"));
  assert.equal(res.voice, "am_onyx");
  assert.equal(res.sampleRate, 24000);
  assert.ok(res.durationSec >= 4.0, `Expected duration >= 4.0s, got ${res.durationSec}s`);
  assert.ok(res.dataUrl.startsWith("data:audio/wav;base64,"));
  assert.equal(typeof res.speechAvailable, "boolean");
  if (res.speechAvailable) {
    assert.equal(res.audioKind, "speech");
    assert.equal(res.fallback, false);
  } else {
    assert.equal(res.audioKind, "diagnostic_tone");
    assert.equal(res.fallback, true);
    assert.equal(res.fallbackReason, "KOKORO_RUNTIME_UNAVAILABLE");
  }
  // Real-Time Factor (generation time / audio duration) should be well under 1.0 (faster than real-time)
  const rtf = res.generationTimeSec / res.durationSec;
  assert.ok(rtf < 2.5, `Expected RTF < 2.5, got ${rtf.toFixed(2)}`);
});

test("KokoroEngine: labels Roman Hinglish WAV as speech only when the real model runtime is available", async () => {
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

  try {
    const res = await voice.speakKokoro("Status verified.");
    assert.ok(res.id.startsWith("kokoro-"));
    assert.equal(res.voice, "am_onyx");
    assert.equal(res.speechAvailable, true);
    assert.equal(res.audioKind, "speech");
    assert.ok(res.durationSec > 0.5);
  } catch (error) {
    assert.equal(error.code, "KOKORO_SPEECH_UNAVAILABLE");
    assert.equal(error.audioKind, "diagnostic_tone");
  }
});

test("KokoroEngine: audio history records recent synthesis entries", () => {
  const history = kokoroEngine.getAudioHistory();
  assert.ok(Array.isArray(history));
  assert.ok(history.length > 0);
  const latest = history[history.length - 1];
  assert.equal(latest.voice, "am_onyx");
  assert.ok(latest.dataUrl.startsWith("data:audio/wav;base64,"));
});
