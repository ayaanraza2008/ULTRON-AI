import test from "node:test";
import assert from "node:assert/strict";
import { UltronVoiceActivationSystem, VOICE_ACTIVATION_STATES } from "../voice/voice-activation-system.js";

test("UltronVoiceActivationSystem: initializes in DISABLED state and starts monitoring", () => {
  const system = new UltronVoiceActivationSystem();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.DISABLED);

  const startRes = system.startMonitoring({ hasPermission: true });
  assert.equal(startRes.ok, true);
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.WAKE_MONITORING);

  const stopRes = system.stopMonitoring();
  assert.equal(stopRes.ok, true);
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.DISABLED);
});

test("UltronVoiceActivationSystem: wake word triggers activation and transitions to LISTENING", () => {
  const transitions = [];
  let wakeTriggered = null;

  const system = new UltronVoiceActivationSystem({
    onStateChange: (from, to, meta) => transitions.push({ from, to, meta }),
    onWake: (source, meta) => { wakeTriggered = { source, meta }; },
  });

  system.startMonitoring({ hasPermission: true });

  // Test wake word recognition
  const result = system.processTranscriptForWakeWord("Hey ULTRON");
  assert.equal(result.triggered, true);
  assert.equal(wakeTriggered.source, "VOICE_WAKE_WORD");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);

  // Transitions: DISABLED -> WAKE_MONITORING -> ACTIVATING -> LISTENING
  assert.ok(transitions.some(t => t.to === VOICE_ACTIVATION_STATES.ACTIVATING));
  assert.ok(transitions.some(t => t.to === VOICE_ACTIVATION_STATES.LISTENING));
});

test("UltronVoiceActivationSystem: wake word with embedded command immediately dispatches command", () => {
  let dispatchedCommand = null;

  const system = new UltronVoiceActivationSystem({
    onCommand: (cmd) => { dispatchedCommand = cmd; },
  });

  system.startMonitoring({ hasPermission: true });

  const result = system.processTranscriptForWakeWord("ULTRON check system battery and storage");
  assert.equal(result.triggered, true);
  assert.equal(result.hasEmbeddedCommand, true);
  assert.equal(dispatchedCommand, "check system battery and storage");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.THINKING);
});

test("UltronVoiceActivationSystem: acoustic snap triggers activation", () => {
  let wakeTriggered = null;

  const system = new UltronVoiceActivationSystem({
    onWake: (source, meta) => { wakeTriggered = { source, meta }; },
  });

  system.startMonitoring({ hasPermission: true });

  const snapRes = system.triggerWake("FINGER_SNAP", { confidence: 0.95 });
  assert.equal(snapRes.ok, true);
  assert.equal(wakeTriggered.source, "FINGER_SNAP");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);
});

test("UltronVoiceActivationSystem: voice control commands parse and execute accurately", () => {
  const system = new UltronVoiceActivationSystem();
  system.startMonitoring({ hasPermission: true });

  // 1. "sleep" command
  system.handleSpokenUtterance("ULTRON, sleep");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SLEEPING);

  // 2. "wake up" command from SLEEPING wakes into LISTENING
  system.handleSpokenUtterance("wake up");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);

  // 3. Put in LISTENING, then "stop listening" returns to WAKE_MONITORING
  system.handleSpokenUtterance("stop listening");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.WAKE_MONITORING);

  // 4. "mute microphone"
  system.handleSpokenUtterance("mute microphone");
  assert.equal(system.isMuted, true);

  // 5. "unmute microphone"
  system.handleSpokenUtterance("unmute microphone");
  assert.equal(system.isMuted, false);
});

test("UltronVoiceActivationSystem: continuous conversation mode auto-rearms after speech", async () => {
  const system = new UltronVoiceActivationSystem({
    continuousConversationEnabled: true,
    conversationTimeoutMs: 100, // fast timeout for test
  });

  system.startMonitoring({ hasPermission: true });

  // User speaks, ULTRON goes to SPEAKING
  system.notifySpeakingStarted();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SPEAKING);

  // ULTRON finishes speaking -> auto-rearms into LISTENING
  system.notifySpeakingEnded();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.LISTENING);

  // Wait for timeout to expire
  await new Promise(resolve => setTimeout(resolve, 150));

  // Should automatically return to WAKE_MONITORING
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.WAKE_MONITORING);
});

test("UltronVoiceActivationSystem: user interruption halts speaking immediately", () => {
  let interrupted = false;

  const system = new UltronVoiceActivationSystem({
    onAudioInterruption: () => { interrupted = true; },
  });

  system.startMonitoring({ hasPermission: true });
  system.notifySpeakingStarted();
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.SPEAKING);

  // User interrupts by speaking
  system.handleSpokenUtterance("Stop that, show me CPU status instead");

  assert.equal(interrupted, true, "Audio interruption callback must fire");
  assert.equal(system.getState(), VOICE_ACTIVATION_STATES.THINKING);
});

test("UltronVoiceActivationSystem: emergency mute blocks wake word and snap processing", () => {
  let wakeCount = 0;

  const system = new UltronVoiceActivationSystem({
    onWake: () => { wakeCount++; },
  });

  system.startMonitoring({ hasPermission: true });
  system.setMute(true);

  // Attempt wake word while muted
  const resWake = system.processTranscriptForWakeWord("ULTRON");
  assert.equal(resWake.triggered, false);

  // Attempt snap while muted
  const resSnap = system.triggerWake("FINGER_SNAP");
  assert.equal(resSnap.ok, false);

  assert.equal(wakeCount, 0, "No wake events should trigger while muted");
});
