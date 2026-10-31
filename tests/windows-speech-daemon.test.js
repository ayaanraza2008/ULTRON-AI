import test from "node:test";
import assert from "node:assert/strict";
import { WindowsSpeechDaemon } from "../voice/windows-speech-daemon.js";

test("WindowsSpeechDaemon: sanitizes markdown and technical syntax for natural speech", async () => {
  const daemon = new WindowsSpeechDaemon();
  const input = "Sir, here is the result: ```const x = 10;``` and **important** update at `https://api.github.com`";
  const result = await daemon.speak(input);

  assert.equal(result.success, true);
  assert.ok(!result.spokenText.includes("```"));
  assert.ok(!result.spokenText.includes("**"));
  assert.ok(!result.spokenText.includes("`"));
  assert.ok(!result.spokenText.includes("https://"));
  assert.ok(result.spokenText.includes("Sir, here is the result:"));
});

test("WindowsSpeechDaemon: matchOfflineIntent parses spoken desktop commands accurately", () => {
  const daemon = new WindowsSpeechDaemon();

  const lockIntent = daemon.matchOfflineIntent("Ultron please lock workstation now");
  assert.equal(lockIntent.matched, true);
  assert.equal(lockIntent.intent, "LOCK_WORKSTATION");

  const screenshotIntent = daemon.matchOfflineIntent("Jarvis take a screenshot");
  assert.equal(screenshotIntent.matched, true);
  assert.equal(screenshotIntent.intent, "SCREENSHOT");

  const volIntent = daemon.matchOfflineIntent("Jarvis volume up");
  assert.equal(volIntent.matched, true);
  assert.equal(volIntent.intent, "VOLUME_UP");

  const batteryIntent = daemon.matchOfflineIntent("Ultron check battery status");
  assert.equal(batteryIntent.matched, true);
  assert.equal(batteryIntent.intent, "BATTERY_STATUS");

  const emergencyIntent = daemon.matchOfflineIntent("Jarvis emergency stop halt all");
  assert.equal(emergencyIntent.matched, true);
  assert.equal(emergencyIntent.intent, "EMERGENCY_STOP");

  const nonWakeWord = daemon.matchOfflineIntent("hello how are you");
  assert.equal(nonWakeWord.matched, false);
});
