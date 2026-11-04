import test from "node:test";
import assert from "node:assert/strict";
import {
  AcousticEchoCanceller,
  BackgroundAudioClassifier,
  RealtimeSnapDetector,
  MediaDuckingController,
  AUDIO_CLASSES,
  SNAP_MODES
} from "../voice/audio-processing-pipeline.js";

test("AcousticEchoCanceller: cancels playback reference echo from microphone input", () => {
  const aec = new AcousticEchoCanceller({ filterLength: 32, learningRate: 0.2 });
  const N = 256;
  const refFrame = new Float32Array(N);
  const micFrame = new Float32Array(N);

  // Generate synthetic reference audio (e.g. YouTube video audio)
  for (let i = 0; i < N; i++) {
    refFrame[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
    // Microphone picks up the echo (attenuated + slightly shifted)
    micFrame[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 44100);
  }

  // First pass adapts filter
  const result1 = aec.process(micFrame, refFrame);
  assert.ok(result1.cleanFrame.length === N);

  // Second pass with adapted weights demonstrates echo suppression
  const result2 = aec.process(micFrame, refFrame);
  assert.ok(result2.erleDb >= 0, "ERLE should be non-negative");
  assert.ok(result2.echoEstimate.length === N);
});

test("BackgroundAudioClassifier: identifies silence, playback, near-field voice and transients", () => {
  const classifier = new BackgroundAudioClassifier();
  const N = 256;

  // 1. Silence
  const silence = new Float32Array(N);
  const resSil = classifier.classify(silence);
  assert.equal(resSil.classification, AUDIO_CLASSES.SILENCE);

  // 2. Playback correlation
  const ref = new Float32Array(N);
  const micEcho = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ref[i] = Math.sin(i * 0.1);
    micEcho[i] = Math.sin(i * 0.1) * 0.8;
  }
  const resPlay = classifier.classify(micEcho, ref);
  assert.ok(
    resPlay.classification === AUDIO_CLASSES.SPEECH_PLAYBACK ||
    resPlay.classification === AUDIO_CLASSES.MUSIC_BEAT
  );
  assert.ok(resPlay.refCorrelation > 0.5);

  // 3. Near-field voice (uncorrelated with reference)
  const voice = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    voice[i] = 0.2 * Math.sin(i * 0.35 + 1.2);
  }
  const resVoice = classifier.classify(voice, ref);
  assert.equal(resVoice.classification, AUDIO_CLASSES.NEAR_FIELD_VOICE);
  assert.ok(resVoice.nearFieldRatio > 0.5);
});

test("RealtimeSnapDetector: detects finger snap and rejects music playback interference", () => {
  const detector = new RealtimeSnapDetector({ mode: SNAP_MODES.SINGLE_SNAP });
  const N = 256;

  // 1. Synthetic finger snap: sharp impulse with fast decay
  const snapFrame = new Float32Array(N);
  snapFrame[10] = 0.85;
  snapFrame[11] = -0.65;
  snapFrame[12] = 0.35;
  snapFrame[13] = -0.15;
  for (let i = 14; i < N; i++) snapFrame[i] = 0.01 * (Math.random() - 0.5);

  const snapResult = detector.process(snapFrame, null, 1000);
  assert.equal(snapResult.detected, true);
  assert.equal(snapResult.isSnap, true);
  assert.ok(snapResult.confidence > 0.7);

  // 2. Music beat from speakers: correlated reference audio cancels out
  const musicRef = new Float32Array(N);
  const musicMic = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    musicRef[i] = 0.6 * Math.sin(i * 0.05);
    musicMic[i] = 0.4 * Math.sin(i * 0.05);
  }
  const musicResult = detector.process(musicMic, musicRef, 2000);
  assert.equal(musicResult.detected, false);
});

test("RealtimeSnapDetector: handles double-snap activation mode", () => {
  const detector = new RealtimeSnapDetector({ mode: SNAP_MODES.DOUBLE_SNAP, doubleSnapWindowMs: 500 });
  const N = 256;

  const snapFrame = new Float32Array(N);
  snapFrame[10] = 0.85;
  snapFrame[11] = -0.65;
  snapFrame[12] = 0.35;
  snapFrame[13] = -0.15;
  for (let i = 14; i < N; i++) snapFrame[i] = 0.005 * (Math.random() - 0.5);

  // First snap
  const res1 = detector.process(snapFrame, null, 1000);
  assert.equal(res1.detected, false);
  assert.equal(res1.isPendingSecondSnap, true);

  // Second snap within 300ms window
  const res2 = detector.process(snapFrame, null, 1300);
  assert.equal(res2.detected, true);
  assert.equal(res2.mode, SNAP_MODES.DOUBLE_SNAP);
  assert.equal(res2.intervalMs, 300);
});

test("MediaDuckingController: smoothly attenuates and restores media volume without killing playback", () => {
  const ducking = new MediaDuckingController({ defaultDuckRatio: 0.15 });
  assert.equal(ducking.isDucked, false);

  // Duck media when ULTRON activates
  const duckRes = ducking.duck();
  assert.equal(duckRes.ducked, true);
  assert.equal(duckRes.currentVolume, 0.15);
  assert.equal(ducking.isDucked, true);

  // Second duck call is idempotent
  const duckRes2 = ducking.duck();
  assert.equal(duckRes2.ducked, true);

  // Restore volume when ULTRON finishes speaking
  const restRes = ducking.restore();
  assert.equal(restRes.ducked, false);
  assert.equal(restRes.currentVolume, 1.0);
  assert.equal(ducking.isDucked, false);
});
