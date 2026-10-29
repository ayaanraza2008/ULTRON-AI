import test from "node:test";
import assert from "node:assert/strict";
import {
  cognitiveLayerForMemory,
  cognitiveLayerLabel,
  extractCorrectionLesson,
  rankCognitiveMemories
} from "../cognitive-memory.js";

const NOW = Date.parse("2026-10-29T12:00:00.000Z");

test("maps ULTRON's existing memory kinds into six cognitive layers without a schema migration", () => {
  assert.equal(cognitiveLayerForMemory({ kind: "profile_note" }), "profile");
  assert.equal(cognitiveLayerForMemory({ kind: "preference" }), "profile");
  assert.equal(cognitiveLayerForMemory({ kind: "document_reference" }), "episodic");
  assert.equal(cognitiveLayerForMemory({ kind: "project_fact" }), "semantic");
  assert.equal(cognitiveLayerForMemory({ kind: "profile_note", title: "Response quality lesson" }), "procedural");
  assert.equal(cognitiveLayerForMemory({ kind: "project_fact", metadata: { cognitiveLayer: "episodic" } }), "episodic");
  assert.equal(cognitiveLayerLabel("procedural"), "learned response lesson");
});

test("ranks task-relevant memories while preserving explicit user-approved memories", () => {
  const rows = [
    {
      id: "relevant",
      kind: "project_fact",
      title: "Worker isolation",
      content: "Keep the background worker isolated from the API process.",
      source: "conversation_summary",
      updated_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      metadata: { confidence: 0.9, cognitiveLayer: "semantic" }
    },
    {
      id: "stale-inferred",
      kind: "project_fact",
      title: "Old API decision",
      content: "Use a single large worker process.",
      source: "conversation_summary",
      updated_at: new Date(NOW - 240 * 86_400_000).toISOString(),
      metadata: { confidence: 0.8 }
    },
    {
      id: "explicit",
      kind: "preference",
      title: "Language preference",
      content: "Prefer English explanations.",
      source: "user_approved",
      updated_at: new Date(NOW - 600 * 86_400_000).toISOString(),
      metadata: {}
    },
    {
      id: "expired",
      kind: "project_fact",
      title: "Expired item",
      content: "worker process",
      source: "user_approved",
      expires_at: new Date(NOW - 1000).toISOString()
    }
  ];

  const ranked = rankCognitiveMemories(rows, "keep the worker isolated", { now: NOW, limit: 8 });
  assert.equal(ranked.some(item => item.id === "stale-inferred"), false);
  assert.equal(ranked.some(item => item.id === "expired"), false);
  assert.equal(ranked.some(item => item.id === "explicit"), true);
  assert.equal(ranked[0].id, "relevant");
  assert.ok(ranked.find(item => item.id === "explicit").cognitiveDecay === 1);
});

test("reinforced procedural lessons can outrank a less relevant fact", () => {
  const ranked = rankCognitiveMemories([
    {
      id: "lesson",
      kind: "profile_note",
      title: "Response quality lesson",
      content: "When asked for a short answer, keep it concise and focused.",
      source: "conversation_summary",
      updated_at: new Date(NOW - 1_000).toISOString(),
      metadata: { cognitiveLayer: "procedural", reinforcementCount: 4, confidence: 0.9 }
    },
    {
      id: "fact",
      kind: "project_fact",
      title: "Unrelated fact",
      content: "A remote server runs scheduled data processing.",
      source: "conversation_summary",
      updated_at: new Date(NOW - 1_000).toISOString(),
      metadata: { cognitiveLayer: "semantic", confidence: 0.75 }
    }
  ], "short concise answer", { now: NOW, limit: 8 });
  assert.equal(ranked[0].id, "lesson");
});

test("turns corrections into bounded reusable lessons and never stores the raw prompt", () => {
  assert.equal(extractCorrectionLesson("Can you explain this?"), null);
  const lesson = extractCorrectionLesson("That's not what I asked. I need a very short answer. My password is super-secret.");
  assert.equal(lesson.kind, "profile_note");
  assert.equal(lesson.cognitiveLayer, "procedural");
  assert.match(lesson.content, /concise and focused/i);
  assert.equal(lesson.content.includes("super-secret"), false);
  assert.equal(lesson.content.includes("That's not what I asked"), false);
});

test("learns scope and language preferences only after a clear correction signal", () => {
  const scope = extractCorrectionLesson("You misunderstood. Do not touch other repositories; only ULTRON.");
  assert.match(scope.content, /project and change-scope boundaries/i);
  const language = extractCorrectionLesson("Wrong answer; I said explain in English.");
  assert.match(language.content, /explicitly requested language/i);
});

test("a recently reinforced inferred memory uses reinforcement time even without updated_at changes", () => {
  const row = {
    id: "reinforced-old-row",
    kind: "project_fact",
    title: "Reinforced deployment lesson",
    content: "Keep production deployment separate until tests are complete.",
    source: "conversation_summary",
    created_at: new Date(NOW - 240 * 86_400_000).toISOString(),
    updated_at: new Date(NOW - 240 * 86_400_000).toISOString(),
    metadata: {
      cognitiveLayer: "procedural",
      confidence: 0.9,
      reinforcementCount: 3,
      lastReinforcedAt: new Date(NOW - 1 * 86_400_000).toISOString()
    }
  };

  const ranked = rankCognitiveMemories([row], "production deployment tests", { now: NOW, limit: 8 });
  assert.equal(ranked.length, 1, "reinforcement should prevent a false stale-memory exclusion");
  assert.ok(ranked[0].cognitiveDecay > 0.95, "decay should be measured from last reinforcement");
});
