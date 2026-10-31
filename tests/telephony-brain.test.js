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

test("TelephonyBrain: Dispatches PC screen unlock and speaks confirmation", async () => {
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
  assert.equal(outcome.spokenResponse, "Okay. Screen unlocked.");
});

test("TelephonyBrain: Dispatches simultaneous unlock across all 3 mobile devices", async () => {
  const brain = new TelephonyBrain();
  let mobileUnlocked = false;
  const mockMdm = {
    unlockMobileDevices: async () => { mobileUnlocked = true; return { unlockedCount: 3, totalTargeted: 3 }; }
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
  assert.equal(outcome.spokenResponse, "Checking... One second... All three unlocked.");
});

test("TelephonyBrain: Dispatches media playback across all devices", async () => {
  const brain = new TelephonyBrain();
  let mediaPlayed = false;
  const mockMdm = {
    playMediaAcrossDevices: async () => { mediaPlayed = true; return { playingDevices: 3 }; }
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
  assert.equal(outcome.spokenResponse, "Playing.");
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
