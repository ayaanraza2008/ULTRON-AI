import test from "node:test";
import assert from "node:assert/strict";
import { AcousticSnapDetector, SNAP_SENSITIVITY_PRESETS } from "../voice/snap-detector.js";

test("AcousticSnapDetector: initializes with default parameters and presets", () => {
  const detector = new AcousticSnapDetector();
  assert.equal(detector.sensitivity, "NORMAL");
  assert.equal(detector.sampleRate, 44100);
  assert.equal(detector.debounceMs, 800);

  const params = detector.getEffectiveParams();
  assert.equal(params.threshold, SNAP_SENSITIVITY_PRESETS.NORMAL.threshold);
  assert.equal(params.minCrestFactor, SNAP_SENSITIVITY_PRESETS.NORMAL.minCrestFactor);
  assert.equal(params.minHighBandRatio, SNAP_SENSITIVITY_PRESETS.NORMAL.minHighBandRatio);
});

test("AcousticSnapDetector: supports setting sensitivity presets (LOW, NORMAL, HIGH)", () => {
  const detector = new AcousticSnapDetector();

  detector.setSensitivity("HIGH");
  assert.equal(detector.sensitivity, "HIGH");
  let params = detector.getEffectiveParams();
  assert.equal(params.threshold, SNAP_SENSITIVITY_PRESETS.HIGH.threshold);
  assert.equal(params.minCrestFactor, SNAP_SENSITIVITY_PRESETS.HIGH.minCrestFactor);

  detector.setSensitivity("LOW");
  assert.equal(detector.sensitivity, "LOW");
  params = detector.getEffectiveParams();
  assert.equal(params.threshold, SNAP_SENSITIVITY_PRESETS.LOW.threshold);
  assert.equal(params.minCrestFactor, SNAP_SENSITIVITY_PRESETS.LOW.minCrestFactor);

  // Custom override
  detector.setCustomThreshold(0.75);
  params = detector.getEffectiveParams();
  assert.equal(params.threshold, 0.75);
});

test("AcousticSnapDetector: computes correct statistical metrics from audio buffers", () => {
  const detector = new AcousticSnapDetector({ sampleRate: 44100 });

  // 1. Silent buffer
  const silence = new Float32Array(512);
  const metricsSilence = detector.computeTimeMetrics(silence);
  assert.equal(metricsSilence.rms, 0);
  assert.equal(metricsSilence.peak, 0);
  assert.equal(metricsSilence.crestFactor, 0);
  assert.equal(metricsSilence.zeroCrossingRate, 0);

  // 2. High impulsive buffer simulating snap (sharp peak in middle)
  const snapBuffer = new Float32Array(512);
  for (let i = 0; i < snapBuffer.length; i++) {
    // Sharp spike around sample 50
    if (i >= 48 && i <= 52) {
      snapBuffer[i] = 0.95 * Math.sin((i - 48) * Math.PI / 4);
    } else {
      snapBuffer[i] = 0.01 * (Math.random() - 0.5);
    }
  }

  const metricsSnap = detector.computeTimeMetrics(snapBuffer);
  assert.ok(metricsSnap.peak >= 0.9, `Peak should be high: ${metricsSnap.peak}`);
  assert.ok(metricsSnap.crestFactor >= 3.5, `Crest factor should be high: ${metricsSnap.crestFactor}`);
  assert.ok(metricsSnap.attackRatio >= 1.0, `Attack ratio should be high: ${metricsSnap.attackRatio}`);
});

test("AcousticSnapDetector: correctly detects sharp finger snap audio characteristics", () => {
  const detector = new AcousticSnapDetector({ sensitivity: "NORMAL", debounceMs: 500 });

  const timeData = new Float32Array(512);
  // Sharp transient
  for (let i = 0; i < timeData.length; i++) {
    if (i >= 30 && i <= 36) {
      timeData[i] = 0.9;
    } else {
      timeData[i] = 0.005;
    }
  }

  // High band frequency dominance (bins 30 to 90 dominant)
  const freqData = new Uint8Array(256);
  for (let i = 0; i < freqData.length; i++) {
    if (i >= 30 && i <= 90) {
      freqData[i] = 220; // High frequency dominance (2.5kHz - 8kHz)
    } else {
      freqData[i] = 20;  // Low frequency baseline
    }
  }

  const result = detector.analyzeFrame(timeData, freqData, 1000);
  assert.equal(result.isSnap, true, "Should detect valid finger snap");
  assert.ok(result.confidence > 0.5, "Confidence should be strong");
});

test("AcousticSnapDetector: rejects claps with low-frequency rumble and sustained energy", () => {
  const detector = new AcousticSnapDetector({ sensitivity: "NORMAL" });

  const timeData = new Float32Array(512);
  // Sustained energy across entire frame (typical of clap or slam)
  for (let i = 0; i < timeData.length; i++) {
    timeData[i] = 0.8 * Math.sin(i * 0.05);
  }

  // Low frequency dominance (<1.5kHz, bins 0-20)
  const freqData = new Uint8Array(256);
  for (let i = 0; i < freqData.length; i++) {
    if (i <= 20) {
      freqData[i] = 240; // Heavy low-end
    } else {
      freqData[i] = 15;
    }
  }

  const result = detector.analyzeFrame(timeData, freqData, 1000);
  assert.equal(result.isSnap, false, "Should reject low-frequency clap");
});

test("AcousticSnapDetector: rejects keyboard clicks and low-amplitude typing noise", () => {
  const detector = new AcousticSnapDetector({ sensitivity: "NORMAL" });

  const timeData = new Float32Array(512);
  for (let i = 0; i < timeData.length; i++) {
    timeData[i] = 0.08 * (Math.random() - 0.5); // Keyboard click amplitude is too low
  }
  const freqData = new Uint8Array(256).fill(30);

  const result = detector.analyzeFrame(timeData, freqData, 1000);
  assert.equal(result.isSnap, false, "Should reject keyboard clicks");
});

test("AcousticSnapDetector: debounce lock prevents rapid double triggers", () => {
  const detector = new AcousticSnapDetector({ debounceMs: 500 });

  const timeData = new Float32Array(512);
  for (let i = 30; i <= 36; i++) timeData[i] = 0.9;
  const freqData = new Uint8Array(256);
  for (let i = 30; i <= 90; i++) freqData[i] = 220;

  // First trigger at t=1000
  const first = detector.analyzeFrame(timeData, freqData, 1000);
  assert.equal(first.isSnap, true, "First snap should trigger");

  // Second trigger at t=1200 (within 500ms debounce)
  const second = detector.analyzeFrame(timeData, freqData, 1200);
  assert.equal(second.isSnap, false, "Second snap within debounce window must be rejected");
  assert.equal(second.reason, "DEBOUNCE_LOCK");

  // Simulate normal ambient silence between frames
  const silence = new Float32Array(512);
  detector.analyzeFrame(silence, null, 1300);
  detector.analyzeFrame(silence, null, 1400);

  // Third trigger at t=1600 (after 500ms debounce)
  const third = detector.analyzeFrame(timeData, freqData, 1600);
  assert.equal(third.isSnap, true, "Third snap after debounce window should trigger");
});
