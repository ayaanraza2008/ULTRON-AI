import test from "node:test";
import assert from "node:assert/strict";
import { UltronConsole } from "../scripts/ultron-console.mjs";

test("UltronConsole: initializes with default configuration and BrainRouter", () => {
  const consoleApp = new UltronConsole();
  assert.ok(consoleApp.brainRouter);
  assert.equal(consoleApp.voiceEnabled, true);
  assert.deepEqual(consoleApp.conversationHistory, []);
});

test("UltronConsole: handles voice toggle commands", async () => {
  const consoleApp = new UltronConsole();
  assert.equal(consoleApp.voiceEnabled, true);

  await consoleApp.handleCommand("/voice off");
  assert.equal(consoleApp.voiceEnabled, false);

  await consoleApp.handleCommand("/voice on");
  assert.equal(consoleApp.voiceEnabled, true);

  await consoleApp.handleCommand("/voice");
  assert.equal(consoleApp.voiceEnabled, false);
});

test("UltronConsole: handles help and tools commands without crashing", async () => {
  const consoleApp = new UltronConsole();
  consoleApp.voiceEnabled = false; // Disable voice in test environment

  // Run commands and verify no exceptions thrown
  await assert.doesNotReject(async () => {
    await consoleApp.handleCommand("/help");
    await consoleApp.handleCommand("/tools");
  });
});

test("UltronConsole: processes offline intent commands with deterministic fallback", async () => {
  const consoleApp = new UltronConsole();
  consoleApp.voiceEnabled = false;

  await assert.doesNotReject(async () => {
    await consoleApp.handleCommand("hello ultron");
    await consoleApp.handleCommand("system vitals");
  });
});
