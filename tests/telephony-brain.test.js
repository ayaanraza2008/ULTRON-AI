import test from "node:test";
import assert from "node:assert/strict";
import {
  telephonyBrain,
  TelephonyBrain,
  TELEPHONY_INTENTS
} from "../telephony/telephony-brain.js";

test("TelephonyBrain: Multilingual language detection identifies English, Hindi, and Hinglish", () => {
  const brain = new TelephonyBrain();

  // English
  const eng = brain.detectLanguage("Can you unlock my computer screen?");
  assert.equal(eng.language, "en-IN");
  assert.equal(eng.dialect, "english");

  // Conversational Hinglish
  const hing = brain.detectLanguage("Ultron mera computer kholo aur check karo");
  assert.equal(hing.language, "hi-IN");
  assert.equal(hing.dialect, "hinglish_conversational");

  // Devanagari Hindi
  const hindi = brain.detectLanguage("नमस्ते उल्त्रों, सब ठीक है?");
  assert.equal(hindi.language, "hi-IN");
  assert.equal(hindi.dialect, "hindi_devanagari");
});

test("TelephonyBrain: Intent classification matches reference video instructions", () => {
  const brain = new TelephonyBrain();

  // 1. PC Screen Unlock
  const unlockPc = brain.classifyIntent("Hi Ultron, can you unlock my screen?");
  assert.equal(unlockPc.intent, TELEPHONY_INTENTS.UNLOCK_PC_SCREEN);
  assert.equal(unlockPc.target, "windows_pc");

  // 2. Multi-device Mobile Unlock
  const unlockPhones = brain.classifyIntent("Do one thing, unlock all three mobile devices");
  assert.equal(unlockPhones.intent, TELEPHONY_INTENTS.UNLOCK_MOBILE_DEVICES);
  assert.equal(unlockPhones.target, "all_mobile_devices");

  // 3. Play favorite song across all devices
  const playSong = brain.classifyIntent("Now I want you to play my favorite song in all three of the devices");
  assert.equal(playSong.intent, TELEPHONY_INTENTS.PLAY_MEDIA_ALL_DEVICES);
  assert.equal(playSong.target, "all_devices");

  // 4. Project check
  const checkProj = brain.classifyIntent("ULTRON, open my computer and check my project");
  assert.equal(checkProj.intent, TELEPHONY_INTENTS.CHECK_PROJECT_TESTS);

  // 5. Storage check
  const checkStorage = brain.classifyIntent("Check computer storage and battery");
  assert.equal(checkStorage.intent, TELEPHONY_INTENTS.CHECK_SYSTEM_VITALS);
});

test("TelephonyBrain: Speaks a success only when Windows confirms screen unlock", async () => {
  const brain = new TelephonyBrain();
  let pcUnlocked = false;
  const mockDesktopAgent = {
    unlockScreen: async () => { pcUnlocked = true; return { success: true }; }
  };

  const outcome = await brain.processCallerUtterance({
    callId: "call_1",
    callerNumber: "+919876543210",
    isOwner: true,
    speechText: "can you unlock my screen?",
    windowsDesktopAgent: mockDesktopAgent
  });

  assert.equal(outcome.permitted, true);
  assert.equal(outcome.intent, TELEPHONY_INTENTS.UNLOCK_PC_SCREEN);
  assert.equal(pcUnlocked, true);
  assert.equal(outcome.spokenResponse, "The workstation is unlocked.");
  assert.equal(outcome.executed, true);
});

test("TelephonyBrain: Dispatches simultaneous unlock across all 3 mobile devices", async () => {
  const brain = new TelephonyBrain();
  let mobileUnlocked = false;
  const mockMdm = {
    unlockMobileDevices: async () => { mobileUnlocked = true; return { success: true, unlockedCount: 3, totalTargeted: 3 }; }
  };

  const outcome = await brain.processCallerUtterance({
    callId: "call_2",
    callerNumber: "+919876543210",
    isOwner: true,
    speechText: "unlock all three mobile devices",
    multiDeviceManager: mockMdm
  });

  assert.equal(outcome.permitted, true);
  assert.equal(outcome.intent, TELEPHONY_INTENTS.UNLOCK_MOBILE_DEVICES);
  assert.equal(mobileUnlocked, true);
  assert.equal(outcome.spokenResponse, "ULTRON unlocked 3 of 3 targeted mobile devices.");
  assert.equal(outcome.executed, true);
});

test("TelephonyBrain: Dispatches media playback across all devices", async () => {
  const brain = new TelephonyBrain();
  let mediaPlayed = false;
  const mockMdm = {
    playMediaAcrossDevices: async () => { mediaPlayed = true; return { success: true, playingDevices: 3 }; }
  };

  const outcome = await brain.processCallerUtterance({
    callId: "call_3",
    callerNumber: "+919876543210",
    isOwner: true,
    speechText: "play my favorite song in all three of the devices",
    multiDeviceManager: mockMdm
  });

  assert.equal(outcome.permitted, true);
  assert.equal(outcome.intent, TELEPHONY_INTENTS.PLAY_MEDIA_ALL_DEVICES);
  assert.equal(mediaPlayed, true);
  assert.equal(outcome.spokenResponse, "Media playback started on 3 devices.");
  assert.equal(outcome.executed, true);
});

test("TelephonyBrain: Rejects commands from unauthorized callers", async () => {
  const brain = new TelephonyBrain();

  const outcome = await brain.processCallerUtterance({
    callId: "call_unauthorized",
    callerNumber: "+910000000000",
    isOwner: false,
    speechText: "unlock my screen"
  });

  assert.equal(outcome.permitted, false);
  assert.equal(outcome.intent, TELEPHONY_INTENTS.UNAUTHORIZED_COMMAND);
  assert.equal(outcome.hangup, true);
  assert.match(outcome.spokenResponse, /Access denied/);
});


test("TelephonyBrain: Never claims a remote PC unlock succeeded when Windows rejects it", async () => {
  const brain = new TelephonyBrain();
  const outcome = await brain.processCallerUtterance({
    callId: "call_unlock_denied",
    isOwner: true,
    speechText: "unlock my screen",
    windowsDesktopAgent: {
      unlockScreen: async () => ({
        success: false,
        error: "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION",
        message: "Unlock locally."
      })
    }
  });

  assert.equal(outcome.executed, false);
  assert.match(outcome.spokenResponse, /cannot bypass Windows sign-in/i);
  assert.equal(outcome.details.error, "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION");
});

test("TelephonyBrain: Project status never fabricates test counts or test health", async () => {
  const brain = new TelephonyBrain();
  const outcome = await brain.processCallerUtterance({
    callId: "call_project_status",
    isOwner: true,
    speechText: "check my project tests",
    windowsDesktopAgent: {
      checkProjectStatus: async () => ({
        success: true,
        status: "INSPECTION_ONLY_UNVERIFIED",
        tests: { state: "NOT_RUN" },
        repository: { branch: "feature/test", commitSha: "a".repeat(40) }
      })
    }
  });

  assert.equal(outcome.executed, true);
  assert.equal(outcome.details.tests.state, "NOT_RUN");
  assert.match(outcome.spokenResponse, /test suite was not run/i);
  assert.equal(Object.hasOwn(outcome.details, "testsTotal"), false);
});

test("TelephonyBrain: Reports unavailable system telemetry instead of invented values", async () => {
  const brain = new TelephonyBrain();
  const outcome = await brain.processCallerUtterance({
    callId: "call_vitals_unavailable",
    isOwner: true,
    speechText: "check computer storage",
    windowsDesktopAgent: {
      getSystemVitals: async () => ({
        platform: "linux",
        storageAvailableGb: null,
        freeRamGb: 0.5,
        ramUsedPercent: 88
      })
    }
  });

  assert.equal(outcome.executed, true);
  assert.match(outcome.spokenResponse, /0.5 gigabytes of free RAM/i);
  assert.doesNotMatch(outcome.spokenResponse, /150 gigabytes/i);
});

test("TelephonyBrain: Does not claim the render or file-management actions executed without an adapter", async () => {
  const brain = new TelephonyBrain();
  for (const speechText of [
    "create a cinematic edit",
    "stop rendering",
    "open final video",
    "organize my Downloads folder"
  ]) {
    const outcome = await brain.processCallerUtterance({
      callId: "call_unwired_action",
      isOwner: true,
      speechText
    });
    assert.equal(outcome.executed, false, speechText);
    assert.equal(outcome.details.error, "CAPABILITY_EXECUTOR_NOT_CONNECTED", speechText);
    assert.match(outcome.spokenResponse, /not connected/i, speechText);
  }
});

test("TelephonyBrain: PC media search uses the real remote task orchestrator result", async () => {
  const brain = new TelephonyBrain({
    remoteTaskOrchestrator: {
      async executeRemoteTask(args) {
        assert.equal(args.action, "FIND_PC_FILE");
        assert.equal(args.payload.query, "find my project videos");
        return { success: true, result: { matches: ["clip.mp4"] } };
      }
    }
  });

  const outcome = await brain.processCallerUtterance({
    callId: "call_file_search",
    isOwner: true,
    speechText: "find my project videos"
  });
  assert.equal(outcome.executed, true);
  assert.match(outcome.spokenResponse, /found 1 matching files/i);
});


test("TelephonyBrain: Routes ordinary conversation through ULTRON BrainRouter", async () => {
  const brain = new TelephonyBrain({
    brainRouter: {
      async executeInference(args) {
        assert.equal(args.prompt, "Explain how ULTRON routes AI providers");
        assert.equal(args.context.source, "telephony");
        assert.equal(args.context.language, "en-IN");
        return {
          success: true,
          content: "ULTRON selects a provider and falls back when needed.",
          provider: "openrouter-primary",
          model: "openrouter/free",
          latencyMs: 125
        };
      }
    }
  });

  const outcome = await brain.processCallerUtterance({
    callId: "call_ai_brain",
    isOwner: true,
    speechText: "Explain how ULTRON routes AI providers"
  });

  assert.equal(outcome.executed, true);
  assert.equal(outcome.spokenResponse, "ULTRON selects a provider and falls back when needed.");
  assert.equal(outcome.details.provider, "openrouter-primary");
});

test("TelephonyBrain: Does not fabricate a conversational answer when every AI provider fails", async () => {
  const brain = new TelephonyBrain({
    brainRouter: {
      async executeInference() {
        return {
          success: false,
          error: "ALL_PROVIDERS_UNAVAILABLE",
          chainAttempted: ["openrouter-primary", "openrouter-secondary"]
        };
      }
    }
  });

  const outcome = await brain.processCallerUtterance({
    callId: "call_ai_unavailable",
    isOwner: true,
    speechText: "Explain how ULTRON routes AI providers"
  });

  assert.equal(outcome.executed, false);
  assert.match(outcome.spokenResponse, /could not reach a working AI inference provider/i);
  assert.equal(outcome.details.error, "ALL_PROVIDERS_UNAVAILABLE");
});
