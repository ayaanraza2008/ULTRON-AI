import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JarvisVoiceEngine } from "../voice/voice-engine.js";
import { AUDIO_CLASSES } from "../voice/audio-processing-pipeline.js";

describe("JarvisVoiceEngine Audio Processing Pipeline Integration", () => {
  test("Instantiates echo canceller, classifier, snap detector, and media ducking", () => {
    const engine = new JarvisVoiceEngine();
    assert.ok(engine.echoCanceller);
    assert.ok(engine.audioClassifier);
    assert.ok(engine.snapDetector);
    assert.ok(engine.mediaDucking);
  });

  test("Processes audio frame with echo cancellation and near-field classification", () => {
    const engine = new JarvisVoiceEngine();
    const frameSize = 256;
    const mic = new Float32Array(frameSize);
    const playback = new Float32Array(frameSize);

    // Populate playback and echo on mic
    for (let i = 0; i < frameSize; i++) {
      playback[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.4;
      mic[i] = playback[i] * 0.6; // Echo of speaker playback
    }

    const res = engine.processAudioFrame(mic, playback);
    assert.ok(res.cleanAudio instanceof Float32Array);
    assert.equal(res.cleanAudio.length, frameSize);
    assert.ok(res.erle >= 0);
    assert.ok(Object.values(AUDIO_CLASSES).includes(res.classification));
  });

  test("Engages media ducking upon snap trigger", () => {
    const engine = new JarvisVoiceEngine();
    const frameSize = 256;
    const snapFrame = new Float32Array(frameSize);

    // Create synthetic sharp impulse with alternating sign for snap
    snapFrame[10] = 0.95;
    snapFrame[11] = -0.85;
    snapFrame[12] = 0.60;
    snapFrame[13] = -0.40;
    snapFrame[14] = 0.20;
    snapFrame[15] = -0.10;

    const res = engine.processAudioFrame(snapFrame, null);
    assert.equal(res.snap.detected, true);
    assert.equal(res.duckingEngaged, true);
    assert.equal(engine.mediaDucking.isDucked, true);

    // Verify restore works
    engine.mediaDucking.restore();
    assert.equal(engine.mediaDucking.isDucked, false);
  });
});
