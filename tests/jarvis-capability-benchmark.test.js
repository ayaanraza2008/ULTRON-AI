/**
 * ULTRON AI — JARVIS Capability Benchmark Test Suite
 *
 * Validates that source/test path inventory is reported separately from runtime verification.
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

  test("Evaluation reports file inventory without claiming runtime verification", async () => {
    const report = await benchmark.evaluate();
    assert.equal(report.categoriesCount, 14);
    assert.equal(report.maxPossibleScore, 100);
    assert.ok(report.totalInventoryCoveragePercent >= 0 && report.totalInventoryCoveragePercent <= 100);
    assert.ok(["SOURCE_TEST_INVENTORY_COMPLETE", "SOURCE_TEST_INVENTORY_INCOMPLETE"].includes(report.overallStatus));
    assert.equal(report.runtimeVerificationStatus, "NOT_EVALUATED");
    assert.equal(report.liveIntegrationStatus, "NOT_EVALUATED");
    assert.equal(Object.hasOwn(report, "totalWeightedScore"), false);

    for (const cat of report.categories) {
      const evidence = [...cat.subsystems, ...cat.testFiles];
      const present = evidence.filter(item => item.exists).length;
      assert.equal(cat.inventoryCoveragePercent, Number((present / evidence.length * 100).toFixed(1)));
      assert.equal(cat.evidencePathsPresent, present);
      assert.equal(cat.evidencePathsTotal, evidence.length);
      assert.notEqual(cat.status, "VERIFIED");
      assert.equal(cat.acceptanceCriteriaStatus, "NOT_EVALUATED");
    }
  });

  test("Markdown scorecard report formats accurately with all 14 categories", async () => {
    const report = await benchmark.evaluate();
    const markdown = benchmark.generateMarkdownReport(report);

    assert.ok(markdown.includes("# ULTRON AI — JARVIS CAPABILITY BENCHMARK SCORECARD"));
    assert.ok(markdown.includes("TOTAL SOURCE/TEST INVENTORY COVERAGE:"));
    assert.ok(markdown.includes("Runtime Verification:** **NOT_EVALUATED**"));
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
