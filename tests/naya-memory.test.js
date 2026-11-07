import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  NayaMemorySystem,
  MEMORY_CATEGORIES
} from "../intelligence/naya/naya-memory.js";

test("NAYA Memory: Short-term conversation turn recording and sliding window limit", () => {
  const tmpFile = path.join(os.tmpdir(), `test-naya-mem-1-${Date.now()}.json`);
  const mem = new NayaMemorySystem({ storagePath: tmpFile, maxShortTermTurns: 5 });

  const userId = "test_user_1";
  for (let i = 1; i <= 8; i++) {
    mem.recordTurn(userId, i % 2 === 0 ? "assistant" : "user", `Turn message ${i}`);
  }

  const turns = mem.getRecentTurns(userId, 10);
  assert.equal(turns.length, 5, "Must be bounded to maxShortTermTurns (5)");
  assert.equal(turns[0].content, "Turn message 4");
  assert.equal(turns[4].content, "Turn message 8");

  try { fs.unlinkSync(tmpFile); } catch {}
});

test("NAYA Memory: Long-term memory deduplication and conflict-free update", () => {
  const tmpFile = path.join(os.tmpdir(), `test-naya-mem-2-${Date.now()}.json`);
  const mem = new NayaMemorySystem({ storagePath: tmpFile });

  const userId = "test_user_2";
  mem.remember(userId, MEMORY_CATEGORIES.PERSONAL_CONTEXT, "favorite_ide", "VS Code");
  mem.remember(userId, MEMORY_CATEGORIES.PERSONAL_CONTEXT, "project_name", "Ultron");

  let memories = mem.retrieveContextMemories(userId);
  assert.equal(memories.length, 2);

  // Update favorite_ide to Antigravity
  mem.remember(userId, MEMORY_CATEGORIES.PERSONAL_CONTEXT, "favorite_ide", "Antigravity");

  memories = mem.retrieveContextMemories(userId);
  assert.equal(memories.length, 2, "Duplicate keys must be updated, not appended");
  const ideMem = memories.find(m => m.key === "favorite_ide");
  assert.equal(ideMem.value, "Antigravity");

  try { fs.unlinkSync(tmpFile); } catch {}
});

test("NAYA Memory: User isolation and anti-IDOR enforcement", () => {
  const tmpFile = path.join(os.tmpdir(), `test-naya-mem-3-${Date.now()}.json`);
  const mem = new NayaMemorySystem({ storagePath: tmpFile });

  mem.remember("alice_user", MEMORY_CATEGORIES.PERSONAL_CONTEXT, "secret_codename", "Project Phoenix");
  mem.remember("bob_user", MEMORY_CATEGORIES.PERSONAL_CONTEXT, "hobby", "Photography");

  const aliceMemories = mem.retrieveContextMemories("alice_user");
  const bobMemories = mem.retrieveContextMemories("bob_user");

  assert.equal(aliceMemories.length, 1);
  assert.equal(aliceMemories[0].value, "Project Phoenix");

  assert.equal(bobMemories.length, 1);
  assert.equal(bobMemories[0].value, "Photography");

  // Verify Alice cannot see Bob's memories
  assert.ok(!aliceMemories.some(m => m.value === "Photography"));
  assert.ok(!bobMemories.some(m => m.value === "Project Phoenix"));

  try { fs.unlinkSync(tmpFile); } catch {}
});

test("NAYA Memory: Preserved seamlessly across personality switches", () => {
  const tmpFile = path.join(os.tmpdir(), `test-naya-mem-4-${Date.now()}.json`);
  const mem = new NayaMemorySystem({ storagePath: tmpFile });

  const userId = "ayaan_owner";
  mem.remember(userId, MEMORY_CATEGORIES.PROJECT_MEMORY, "active_repo", "ULTRON-AI");
  mem.setPreference(userId, "activeMode", "BEST_FRIEND");

  // Switch personality mode to STRICT_MENTOR
  mem.setPreference(userId, "activeMode", "STRICT_MENTOR");

  // Verify memories and task history remain 100% intact
  const memoriesAfterSwitch = mem.retrieveContextMemories(userId);
  assert.equal(memoriesAfterSwitch.length, 1);
  assert.equal(memoriesAfterSwitch[0].key, "active_repo");
  assert.equal(memoriesAfterSwitch[0].value, "ULTRON-AI");
  assert.equal(mem.getPreferences(userId).activeMode, "STRICT_MENTOR");

  // Switch to CODING_PARTNER
  mem.setPreference(userId, "activeMode", "CODING_PARTNER");
  const promptBlock = mem.buildPromptMemoryBlock(userId, "repo");
  assert.ok(promptBlock.includes("ULTRON-AI"), "Prompt block must include preserved project memory");

  try { fs.unlinkSync(tmpFile); } catch {}
});

test("NAYA Memory: Task execution history and architectural decision logging", () => {
  const tmpFile = path.join(os.tmpdir(), `test-naya-mem-5-${Date.now()}.json`);
  const mem = new NayaMemorySystem({ storagePath: tmpFile });

  const userId = "ayaan_owner";
  mem.recordTaskExecution(userId, {
    goal: "Verify GPU and CPU vitals",
    intent: "HARDWARE_TELEMETRY",
    status: "COMPLETED",
    stepsCount: 1,
    verified: true,
    evidence: [{ tool: "windows_pc_vitals", success: true }]
  });

  mem.recordDecision(userId, "Voice Provider Architecture", "Retain Kokoro af_bella female neural voice with browser fallback", "Zero paid dependencies");

  const tasks = mem.getTaskHistory(userId, 5);
  const decisions = mem.getDecisions(userId, 5);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].verified, true);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].topic, "Voice Provider Architecture");

  const block = mem.buildPromptMemoryBlock(userId);
  assert.ok(block.includes("Verify GPU and CPU vitals"));
  assert.ok(block.includes("Voice Provider Architecture"));

  try { fs.unlinkSync(tmpFile); } catch {}
});
