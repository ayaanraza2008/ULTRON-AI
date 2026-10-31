import test from "node:test";
import assert from "node:assert/strict";
import { JarvisVoiceEngine, VOICE_PROFILES } from "../voice/voice-engine.js";
import { WindowsSpeechDaemon } from "../voice/windows-speech-daemon.js";
import { BrainRouter } from "../core/brain-router.js";

test("VoiceFullLoop: wake-word triggers and extracts remaining user instruction", () => {
  const engine = new JarvisVoiceEngine();

  const resJarvis = engine.processWakeWord("Hey Jarvis what is the weather today");
  assert.equal(resJarvis.triggered, true);
  assert.equal(resJarvis.wakeWord, "jarvis");
  assert.ok(resJarvis.remainingPrompt.includes("what is the weather today"));

  const resUltron = engine.processWakeWord("Ultron summarize recent server alerts");
  assert.equal(resUltron.triggered, true);
  assert.equal(resUltron.wakeWord, "ultron");
  assert.ok(resUltron.remainingPrompt.includes("summarize recent server alerts"));

  const resNone = engine.processWakeWord("Hello assistant how are you");
  assert.equal(resNone.triggered, false);
});

test("VoiceFullLoop: trilingual voice prompt generation and persona switching", () => {
  const engine = new JarvisVoiceEngine();

  // Switch to British refined JARVIS
  const profileRes = engine.setProfile("jarvis_prime");
  assert.equal(profileRes.success, true);
  assert.equal(engine.getProfile().lang, "en-GB");

  // Hinglish voice prompt
  const hinglishPrompt = engine.buildVoicePrompt("Bhai kal ka meeting schedule kya hai", "auto");
  assert.ok(hinglishPrompt.directive.includes("Match the language and dialect"));
  assert.equal(hinglishPrompt.prompt, "Bhai kal ka meeting schedule kya hai");

  // Hindi voice prompt
  const hindiPrompt = engine.buildVoicePrompt("Aaj ka taapman kitna hai", "hi-IN");
  assert.ok(hindiPrompt.directive.includes("spoken Hindi"));
});

test("VoiceFullLoop: handles audio stream crashes and successfully recovers daemon", () => {
  const engine = new JarvisVoiceEngine({ mode: "wake_word_continuous" });
  engine.isListening = true;

  // Stream error arrives (e.g. microphone disconnected)
  const errReport = engine.handleAudioStreamError(new Error("Audio hardware buffer underflow"));
  assert.equal(errReport.handled, true);
  assert.equal(engine.isListening, false);
  assert.equal(engine.streamErrors.length, 1);

  // Recovery invoked
  const recovery = engine.recoverListeningDaemon();
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.attempts, 1);
  assert.equal(engine.isListening, true);
  assert.equal(engine.interrupted, false);
});

test("VoiceFullLoop: synthesizes segmented speech plans with markdown stripped", () => {
  const engine = new JarvisVoiceEngine();
  const rawText = "System diagnostics complete. Memory is at 45% usage.\n\n```bash\nfree -m\n```\nAll subsystems online and nominal.";

  const plan = engine.synthesizeSpeechPlan(rawText);
  assert.equal(plan.prepared, true);
  assert.ok(!plan.text.includes("```"));
  assert.ok(plan.segments.length >= 2);
  assert.equal(plan.profile.id, "ultron_command");
});

test("VoiceFullLoop: matches offline desktop voice intents seamlessly", () => {
  const daemon = new WindowsSpeechDaemon({ persona: "jarvis" });

  const lockCheck = daemon.matchOfflineIntent("Jarvis please lock pc");
  assert.equal(lockCheck.matched, true);
  assert.equal(lockCheck.intent, "LOCK_WORKSTATION");

  const statusCheck = daemon.matchOfflineIntent("Ultron system status");
  assert.equal(statusCheck.matched, true);
  assert.equal(statusCheck.intent, "SYSTEM_STATUS");

  const briefingCheck = daemon.matchOfflineIntent("Jarvis morning briefing");
  assert.equal(briefingCheck.matched, true);
  assert.equal(briefingCheck.intent, "DAILY_BRIEFING");
});

test("VoiceFullLoop: executes complete end-to-end voice loop (Wake -> Brain -> TTS Plan -> SAPI Record)", async () => {
  const engine = new JarvisVoiceEngine({ profile: VOICE_PROFILES.jarvis_prime });
  const brain = new BrainRouter({ env: { OPENROUTER_API_KEY: "mock_key" } });
  const speechDaemon = new WindowsSpeechDaemon({ persona: "jarvis" });

  // 1. Spoken input from user
  const spokenAudioInput = "Jarvis give me a quick status update";

  // 2. Wake-word detection
  const wakeWordResult = engine.processWakeWord(spokenAudioInput);
  assert.equal(wakeWordResult.triggered, true);

  // 3. Build optimized voice prompt
  const voicePrompt = engine.buildVoicePrompt(wakeWordResult.remainingPrompt, "en-IN");
  assert.ok(voicePrompt.directive.length > 0);

  // 4. Brain inference execution with mock fetch
  const mockFetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: "All primary systems are operating at peak efficiency, sir. Latency is optimal." } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const inference = await brain.executeInference({
    prompt: voicePrompt.prompt,
    messages: [
      { role: "system", content: voicePrompt.directive },
      { role: "user", content: voicePrompt.prompt }
    ],
    fetchImpl: mockFetch
  });
  assert.equal(inference.success, true);

  // 5. Synthesize speech plan
  const speechPlan = engine.synthesizeSpeechPlan(inference.content);
  assert.equal(speechPlan.prepared, true);
  assert.ok(speechPlan.segments.length > 0);

  // 6. Speak via native speech daemon
  const speakResult = await speechDaemon.speak(speechPlan.text);
  assert.equal(speakResult.success, true);
  assert.ok(speechDaemon.getHistory().length > 0);

  // 7. Record turn
  engine.recordSpeechTurn("user", spokenAudioInput);
  engine.recordSpeechTurn("ultron", speechPlan.text);
  const history = engine.getVoiceHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].speaker, "user");
  assert.equal(history[1].speaker, "ultron");
});
