import test from "node:test";
import assert from "node:assert/strict";
import {
  knowledgeEngine,
  KnowledgeEngine,
  KNOWLEDGE_DOMAINS,
  INFORMATION_QUALITY
} from "../knowledge/knowledge-engine.js";

test("KnowledgeEngine: 16 core domains are registered", () => {
  assert.equal(KNOWLEDGE_DOMAINS.length, 16);
  assert.ok(KNOWLEDGE_DOMAINS.includes("mathematics"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("physics"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("computer_science"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("artificial_intelligence"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("robotics"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("cybersecurity"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("astronomy"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("geography"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("medicine_health"));
  assert.ok(KNOWLEDGE_DOMAINS.includes("law_regulations"));
});

test("KnowledgeEngine: index knowledge with quality tag and confidence", () => {
  const engine = new KnowledgeEngine();
  const entry = engine.indexKnowledge({
    domain: "physics",
    topic: "General Relativity",
    content: "Mass-energy equivalence curvature governs gravitational interactions in spacetime.",
    quality: INFORMATION_QUALITY.FACT,
    citations: ["Albert Einstein 1915"],
    confidence: 0.99
  });

  assert.ok(entry.id);
  assert.equal(entry.domain, "physics");
  assert.equal(entry.quality, "FACT");
  assert.equal(entry.confidence, 0.99);
  assert.equal(entry.citations[0], "Albert Einstein 1915");
});

test("KnowledgeEngine: rejects invalid domains or empty content", () => {
  const engine = new KnowledgeEngine();
  assert.throws(
    () => engine.indexKnowledge({ domain: "astrology_myth", content: "Invalid domain test" }),
    /Invalid knowledge domain/
  );
  assert.throws(
    () => engine.indexKnowledge({ domain: "physics", content: "" }),
    /Cannot index empty content/
  );
});

test("KnowledgeEngine: contradiction detection flags conflicting statements", () => {
  const engine = new KnowledgeEngine();
  // Baseline contains: "Security architectures must enforce non-bypassable scope constraints..."
  // Index a contradictory statement
  const contradictory = engine.indexKnowledge({
    domain: "cybersecurity",
    topic: "Relaxed Perimeter",
    content: "Security architectures do not require non-bypassable scope constraints for internal networks.",
    quality: INFORMATION_QUALITY.OPINION,
    citations: ["Anonymous Blog"],
    confidence: 0.4
  });

  assert.ok(contradictory.contradictionNote);
  assert.match(contradictory.contradictionNote, /Potential contradiction with entry/);
});

test("KnowledgeEngine: semantic token query and ranking", () => {
  const engine = new KnowledgeEngine();
  engine.indexKnowledge({
    domain: "mathematics",
    topic: "Euler Formula",
    content: "Euler's identity connects exponential functions with complex trigonometric coordinates.",
    quality: INFORMATION_QUALITY.FACT,
    citations: ["Leonhard Euler"],
    confidence: 1.0
  });

  const results = engine.query("Euler identity formula exponential");
  assert.ok(results.length > 0);
  assert.equal(results[0].topic, "Euler Formula");
  assert.ok(results[0].relevanceScore > 0.5);

  // Filter by domain
  const physicsOnly = engine.query("Euler", { domain: "physics" });
  assert.equal(physicsOnly.length, 0);
});

test("KnowledgeEngine: domain statistics count correctly", () => {
  const engine = new KnowledgeEngine();
  const stats = engine.getDomainStats();
  assert.ok(stats.totalEntries >= 3); // Seeded baseline
  assert.equal(typeof stats.domains.robotics, "number");
  assert.equal(typeof stats.domains.cybersecurity, "number");
});
