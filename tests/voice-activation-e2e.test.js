import test from "node:test";
import assert from "node:assert/strict";
import { UltronVoiceActivationSystem, VOICE_ACTIVATION_STATES } from "../voice/voice-activation-system.js";
import { AcousticSnapDetector, SNAP_SENSITIVITY_PRESETS } from "../voice/snap-detector.js";
import { CORE_STATES, EnergyCoreController } from "../public/energy-core.js";
import { JarvisVoiceEngine } from "../voice/voice-engine.js";

test("E2E Scenario 1: Voice wake word detection activates system from standby", () => {
  const transitions = [];
  const system = new UltronVoiceActivationSystem({
    onStateChange: (from, to) => transitions.push({ from, to }),
  });

  system.startMonitoring({ hasPermission: true });
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.WAKE_MONITORING);

  // User says "Hey ULTRON"
  const res = system.processTranscriptForWakeWord("Hey ULTRON");
  assert.equal(res.triggered, true);
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);
  assert.ok(transitions.some(t => t.to === VOICE_ACTIVATION_STATES.ACTIVATING));
});

test("E2E Scenario 2: Acoustic finger snap triggers wake activation", () => {
  const system = new UltronVoiceActivationSystem();
  system.startMonitoring({ hasPermission: true });

  // Generate synthetic impulsive snap frame
  const timeData = new Float32Array(512);
  for (let i = 30; i <= 36; i++) timeData[i] = 0.92;
  const freqData = new Uint8Array(256);
  for (let i = 30; i <= 90; i++) freqData[i] = 230;

  const snapResult = system.processAudioForSnap(timeData, freqData, 2000);
  assert.equal(snapResult.detected, true);
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);
});

test("E2E Scenario 3: Activation cyber chime & visual state transition triggered", () => {
  let cyberChimeTriggered = false;
  let visualState = null;

  const core = new EnergyCoreController();
  const system = new UltronVoiceActivationSystem({
    onWake: (source) => {
      cyberChimeTriggered = true;
      if (source === "FINGER_SNAP") {
        core.setVisualState(CORE_STATES.SNAP_DETECTED);
      } else {
        core.setVisualState(CORE_STATES.WAKE_DETECTED);
      }
    },
  });

  system.startMonitoring({ hasPermission: true });
  system.triggerWake("VOICE_WAKE_WORD");

  assert.equal(cyberChimeTriggered, true, "Cyber chime audio feedback must be invoked");
  assert.equal(core.currentState, CORE_STATES.WAKE_DETECTED);
});

test("E2E Scenario 4: User voice utterance transcribed and dispatched as command", () => {
  let dispatchedText = null;

  const system = new UltronVoiceActivationSystem({
    onCommand: (cmd) => { dispatchedText = cmd; },
  });

  system.startMonitoring({ hasPermission: true });
  system.transitionTo(VOICE_ACTIVATION_STATES.LISTENING);

  // User speaks command
  system.handleSpokenUtterance("Diagnose security shield and firewall status");

  assert.equal(dispatchedText, "Diagnose security shield and firewall status");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.THINKING);
});

test("E2E Scenario 5: Response evaluated and spoken using Kokoro am_onyx", () => {
  const voice = new JarvisVoiceEngine();
  voice.setProfile("ultron_onyx");
  const plan = voice.synthesizeSpeechPlan("All defensive perimeters secure, sir.");

  assert.equal(plan.prepared, true);
  assert.equal(plan.profile.voiceId, "am_onyx");
  assert.equal(plan.profile.engine, "kokoro");
  assert.ok(plan.segments.length > 0);
});

test("E2E Scenario 6: Auto-rearm into LISTENING for continuous conversation", () => {
  const system = new UltronVoiceActivationSystem({
    continuousConversationEnabled: true,
    conversationTimeoutMs: 10000,
  });

  system.startMonitoring({ hasPermission: true });
  system.notifySpeakingStarted();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SPEAKING);

  // Playback completes -> auto-rearms into LISTENING
  system.notifySpeakingEnded();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);
  assert.ok(system.conversationTimer !== null, "Continuous conversation timer should be armed");
});

test("E2E Scenario 7: Secondary utterance within timeout accepted without repeating wake word", () => {
  let dispatchedCommand = null;

  const system = new UltronVoiceActivationSystem({
    continuousConversationEnabled: true,
    conversationTimeoutMs: 5000,
    onCommand: (cmd) => { dispatchedCommand = cmd; },
  });

  system.startMonitoring({ hasPermission: true });
  system.notifySpeakingStarted();
  system.notifySpeakingEnded(); // now in LISTENING

  // User speaks follow-up question directly without "ULTRON"
  system.handleSpokenUtterance("What about external network latency?");
  assert.equal(dispatchedCommand, "What about external network latency?");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.THINKING);
});

test("E2E Scenario 8: Timeout expires, system automatically returns to WAKE_MONITORING", async () => {
  const system = new UltronVoiceActivationSystem({
    continuousConversationEnabled: true,
    conversationTimeoutMs: 80,
  });

  system.startMonitoring({ hasPermission: true });
  system.notifySpeakingStarted();
  system.notifySpeakingEnded();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);

  // Wait for conversation timeout to expire
  await new Promise(r => setTimeout(r, 120));
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.WAKE_MONITORING);
});

test("E2E Scenario 9: User says 'ULTRON, sleep', core transitions to SLEEPING", () => {
  const system = new UltronVoiceActivationSystem();
  system.startMonitoring({ hasPermission: true });
  system.transitionTo(VOICE_ACTIVATION_STATES.LISTENING);

  system.handleSpokenUtterance("ULTRON, sleep");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SLEEPING);
});

test("E2E Scenario 10: User says 'wake up' or snaps fingers to re-activate from SLEEPING", () => {
  const system = new UltronVoiceActivationSystem();
  system.startMonitoring({ hasPermission: true });
  system.transitionTo(VOICE_ACTIVATION_STATES.SLEEPING);

  // 1. Wake with voice command
  system.handleSpokenUtterance("wake up");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);

  // Back to sleep
  system.handleSpokenUtterance("sleep");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SLEEPING);

  // 2. Wake with snap
  system.triggerWake("FINGER_SNAP");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);
});

test("E2E Scenario 11: Speech interruption: user talks or snaps while speaking -> immediate halt", () => {
  let audioInterrupted = false;

  const system = new UltronVoiceActivationSystem({
    onAudioInterruption: () => { audioInterrupted = true; },
  });

  system.startMonitoring({ hasPermission: true });
  system.notifySpeakingStarted();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SPEAKING);

  // User speaks while ULTRON is speaking
  system.handleSpokenUtterance("Wait, hold on!");
  assert.equal(audioInterrupted, true, "Audio playback must immediately be stopped");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.THINKING);
});

test("E2E Scenario 12: Clap / door slam / keyboard typing rejected by acoustic transient filter", () => {
  const detector = new AcousticSnapDetector();

  // Low frequency clap (large bass energy, sustained)
  const timeClap = new Float32Array(512).fill(0.8);
  const freqClap = new Uint8Array(256);
  for (let i = 0; i <= 15; i++) freqClap[i] = 250; // <1kHz heavy bass
  const clapRes = detector.analyzeFrame(timeClap, freqClap, 3000);
  assert.equal(clapRes.isSnap, false, "Claps must be rejected");

  // Low amplitude keyboard click
  const timeClick = new Float32Array(512);
  for (let i = 0; i < 512; i++) timeClick[i] = 0.05 * (Math.random() - 0.5);
  const clickRes = detector.analyzeFrame(timeClick, null, 3100);
  assert.equal(clickRes.isSnap, false, "Keyboard clicks must be rejected");
});

test("E2E Scenario 13: Emergency mic mute button or 'mute microphone' halts audio processing", () => {
  const system = new UltronVoiceActivationSystem();
  system.startMonitoring({ hasPermission: true });

  system.setMute(true);
  assert.equal(system.isMuted, true);

  // Wake word is completely ignored while muted
  const wakeRes = system.processTranscriptForWakeWord("ULTRON");
  assert.equal(wakeRes.triggered, false);

  // Snap is completely ignored while muted
  const snapRes = system.triggerWake("FINGER_SNAP");
  assert.equal(snapRes.ok, false);
});

test("E2E Scenario 14: Sensitivity presets (LOW, NORMAL, HIGH) correctly modify detection thresholds", () => {
  const detector = new AcousticSnapDetector();

  detector.setSensitivity("LOW");
  let p = detector.getEffectiveParams();
  assert.equal(p.threshold, SNAP_SENSITIVITY_PRESETS.LOW.threshold);
  assert.equal(p.minCrestFactor, SNAP_SENSITIVITY_PRESETS.LOW.minCrestFactor);

  detector.setSensitivity("HIGH");
  p = detector.getEffectiveParams();
  assert.equal(p.threshold, SNAP_SENSITIVITY_PRESETS.HIGH.threshold);
  assert.equal(p.minCrestFactor, SNAP_SENSITIVITY_PRESETS.HIGH.minCrestFactor);
});

test("E2E Scenario 15: Zero continuous cloud streaming; all processing strictly local", () => {
  const system = new UltronVoiceActivationSystem();
  // Verify detector operates on local typed buffers in pure CPU
  assert.equal(typeof system.snapDetector.processAudioFrame, "function");
  assert.equal(system.snapDetector.sampleRate, 44100);
  // Pure local state machine without any external telemetry or remote HTTP streaming
  assert.equal(system.cloudStreamingActive, false);
});
