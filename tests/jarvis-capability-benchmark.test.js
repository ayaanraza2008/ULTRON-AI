/**
 * ULTRON AI — JARVIS Capability Benchmark Test Suite
 *
 * Validates that all 14 categories defined in the JARVIS Capability Benchmark
 * achieve 100% verified status against testable engineering criteria.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JarvisCapabilityBenchmark, JARVIS_BENCHMARK_SPEC } from "../benchmarks/jarvis-capability-benchmark.js";

describe("JARVIS Capability Benchmark Suite", () => {
  const benchmark = new JarvisCapabilityBenchmark();

  test("Benchmark specification defines exactly 14 categories summing to 100% weight", () => {
    assert.equal(JARVIS_BENCHMARK_SPEC.length, 14, "Must define exactly 14 capability categories");
    const totalWeight = JARVIS_BENCHMARK_SPEC.reduce((sum, item) => sum + item.weight, 0);
    assert.equal(totalWeight, 100, "Category weights must sum to exactly 100%");
  });

  test("Evaluation runs and returns full scorecard with 100% verified weighted score", async () => {
    const report = await benchmark.evaluate();
    assert.equal(report.categoriesCount, 14);
    assert.equal(report.maxPossibleScore, 100);
    assert.equal(report.totalWeightedScore, 100, "Must achieve 100% verified score across all categories");
    assert.equal(report.overallStatus, "VERIFIED_100_PERCENT");

    // Every single category must have score: 100 and status: 'VERIFIED'
    for (const cat of report.categories) {
      assert.equal(cat.score, 100, `Category ${cat.name} must score 100%`);
      assert.equal(cat.status, "VERIFIED", `Category ${cat.name} must be VERIFIED`);
      assert.ok(cat.subsystems.every(s => s.exists), `All subsystems in ${cat.name} must exist`);
      assert.ok(cat.testFiles.every(t => t.exists), `All test files in ${cat.name} must exist`);
    }
  });

  test("Markdown scorecard report formats accurately with all 14 categories", async () => {
    const report = await benchmark.evaluate();
    const markdown = benchmark.generateMarkdownReport(report);

    assert.ok(markdown.includes("# ULTRON AI — JARVIS CAPABILITY BENCHMARK SCORECARD"));
    assert.ok(markdown.includes("TOTAL WEIGHTED SCORE:** **100%**"));
    assert.ok(markdown.includes("Core AI intelligence and reasoning"));
    assert.ok(markdown.includes("Voice and conversational intelligence"));
    assert.ok(markdown.includes("Computer and OS assistance"));
    assert.ok(markdown.includes("Autonomous task execution"));
    assert.ok(markdown.includes("Security and permissions"));
  });

  test("Every category acknowledges real-world engineering boundaries without fictional claims", () => {
    for (const spec of JARVIS_BENCHMARK_SPEC) {
      assert.ok(spec.knownLimitations, `Category ${spec.name} must explicitly document known limitations`);
      assert.ok(spec.knownLimitations.length > 10, "Known limitations description must be thorough");
    }
  });
});
