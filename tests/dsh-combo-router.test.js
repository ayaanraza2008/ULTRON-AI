import test from "node:test";
import assert from "node:assert/strict";
import {
  isComboId,
  createComboSlug,
  listCombos,
  getCombo,
  registerOrUpdateCombo,
  deleteCombo,
  computeComboIntersection,
  selectCandidateSequence,
  recordModelLatency,
} from "../integrations/dsh-god/combo-router.js";

test("DSH Combo Router: identifies combo prefix and creates stable slugs", () => {
  assert.equal(isComboId("combo:fast-free"), true);
  assert.equal(isComboId("combo:smart-code"), true);
  assert.equal(isComboId("openrouter/free"), false);
  assert.equal(isComboId("deepseek-chat"), false);

  const slug = createComboSlug("My Ultra Fast Fallback Chain");
  assert.ok(slug.startsWith("combo:my-ultra-fast-fallback-chain"));
});

test("DSH Combo Router: CRUD operations for virtual combos", () => {
  const custom = registerOrUpdateCombo({
    id: "combo:test-custom-chain",
    name: "Custom Test Chain",
    models: ["opencode:deepseek-chat", "kilo:free-qwen"],
    strategy: "fallback",
    stickyLimit: 1,
  });

  assert.equal(custom.id, "combo:test-custom-chain");
  assert.deepEqual(custom.models, ["opencode:deepseek-chat", "kilo:free-qwen"]);

  const fetched = getCombo("combo:test-custom-chain");
  assert.ok(fetched);
  assert.equal(fetched.name, "Custom Test Chain");

  const deleted = deleteCombo("combo:test-custom-chain");
  assert.equal(deleted, true);
  assert.equal(getCombo("combo:test-custom-chain"), null);
});

test("DSH Combo Router: computes capacity intersection honest bounds", () => {
  const metaMap = new Map([
    ["m1", { contextLength: 32000, supportsVision: true, supportsTools: true }],
    ["m2", { contextLength: 128000, supportsVision: false, supportsTools: true }],
    ["m3", { contextLength: 64000, supportsVision: true, supportsTools: true }],
  ]);

  const combo = {
    id: "combo:mixed-bounds",
    name: "Mixed Bounds",
    models: ["m1", "m2", "m3"],
    strategy: "fallback",
  };

  const inter = computeComboIntersection(combo, metaMap);
  // Context must be minimum of candidate bounds
  assert.equal(inter.contextLength, 32000);
  // Vision must be false because m2 does not support vision
  assert.equal(inter.supportsVision, false);
  // Tools supported by all
  assert.equal(inter.supportsTools, true);
});

test("DSH Combo Router: handles fallback, round-robin, and smart strategy ordering", () => {
  // 1. Fallback always returns original order
  const seqFallback = selectCandidateSequence("combo:fast-free");
  assert.equal(seqFallback[0], "opencode:deepseek-chat");

  // 2. Round-Robin advances according to stickyLimit
  const rrCombo = registerOrUpdateCombo({
    id: "combo:test-rr",
    name: "RR Test",
    models: ["cand-A", "cand-B", "cand-C"],
    strategy: "round-robin",
    stickyLimit: 1,
  });

  const turn1 = selectCandidateSequence("combo:test-rr");
  const turn2 = selectCandidateSequence("combo:test-rr");
  assert.notEqual(turn1[0], turn2[0], "Round-robin must advance starting candidate");

  // 3. Smart strategy sorts by lowest latency
  recordModelLatency("cand-slow", 900);
  recordModelLatency("cand-fast", 80);
  const smartCombo = registerOrUpdateCombo({
    id: "combo:test-smart",
    name: "Smart Test",
    models: ["cand-slow", "cand-fast"],
    strategy: "smart",
  });
  const smartSeq = selectCandidateSequence("combo:test-smart");
  assert.equal(smartSeq[0], "cand-fast");

  deleteCombo("combo:test-rr");
  deleteCombo("combo:test-smart");
});
