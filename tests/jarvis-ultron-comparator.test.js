/**
 * ULTRON AI — JARVIS + ULTRON Capability Comparator Test Suite
 *
 * Verifies source/test inventory reporting and keeps fictional-reference alignment unscored.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JarvisUltronCapabilityComparator, COMPARATOR_CATEGORIES } from "../benchmarks/jarvis-ultron-comparator.js";

describe("JARVIS + ULTRON Capability Comparator Suite", () => {
  const comparator = new JarvisUltronCapabilityComparator();

  test("Comparator defines all 14 categories summing to 100% weight", () => {
    assert.equal(COMPARATOR_CATEGORIES.length, 14);
    const totalWeight = COMPARATOR_CATEGORIES.reduce((acc, c) => acc + c.weight, 0);
    assert.equal(totalWeight, 100, "Category weights must sum to exactly 100%");
  });

  test("Evaluation reports inventory only and leaves runtime/alignment claims unmeasured", async () => {
    const evaluation = await comparator.evaluate();
    assert.equal(evaluation.categoriesCount, 14);
    assert.ok(evaluation.totalInventoryCoveragePercent >= 0 && evaluation.totalInventoryCoveragePercent <= 100);
    assert.equal(evaluation.jarvisAlignmentScore, null);
    assert.equal(evaluation.ultronAlignmentScore, null);
    assert.equal(evaluation.alignmentAssessment, "NOT_MEASURED");
    assert.equal(evaluation.runtimeVerificationStatus, "NOT_EVALUATED");
    assert.equal(evaluation.liveIntegrationStatus, "NOT_EVALUATED");
    assert.equal(Object.hasOwn(evaluation, "totalMaturityScore"), false);

    for (const cat of evaluation.categories) {
      const evidence = [...cat.subsystems, ...cat.testEvidence];
      const present = evidence.filter(item => item.exists).length;
      assert.equal(cat.inventoryCoveragePercent, Number((present / evidence.length * 100).toFixed(1)));
      assert.equal(cat.evidencePathsPresent, present);
      assert.equal(cat.evidencePathsTotal, evidence.length);
      assert.equal(cat.jarvisAlignment, "NOT_MEASURED");
      assert.equal(cat.ultronAlignment, "NOT_MEASURED");
      assert.equal(cat.alignmentAssessment, "QUALITATIVE_REFERENCE_ONLY");
      assert.equal(cat.runtimeVerificationStatus, "NOT_EVALUATED");
      assert.notEqual(cat.implementationStatus, "LIVE_VERIFIED");
      assert.ok(cat.jarvisReference, "Column A (JARVIS Reference) must be populated");
      assert.ok(cat.ultronReference, "Column B (ULTRON Reference) must be populated");
      assert.ok(cat.currentUltron, "Column C (Current ULTRON) must be populated");
      assert.ok(cat.gapAnalysis, "Column D (Gap Analysis) must be populated");
      assert.ok(cat.requiredUpgrade, "Column E (Required Upgrade) must be populated");
      assert.ok(cat.testEvidence.length > 0, "Column G (Test Evidence) must be populated");
    }
  });

  test("Markdown 8-column side-by-side table formats accurately", async () => {
    const evaluation = await comparator.evaluate();
    const markdown = comparator.generateMarkdownTable(evaluation);

    assert.ok(markdown.includes("# ULTRON AI — JARVIS + ULTRON CAPABILITY COMPARISON MATRIX"));
    assert.ok(markdown.includes("Col A: JARVIS Reference"));
    assert.ok(markdown.includes("Col B: ULTRON Reference"));
    assert.ok(markdown.includes("Col C: Current ULTRON Implementation"));
    assert.ok(markdown.includes("Col D: Gap Analysis"));
    assert.ok(markdown.includes("Col E: Required Upgrade"));
    assert.ok(markdown.includes("Col F: Inventory Status"));
    assert.ok(markdown.includes("Col G: Test Evidence"));
    assert.ok(markdown.includes("Col H: Inventory Coverage"));
    assert.ok(markdown.includes("JARVIS Capability Alignment:** NOT MEASURED"));
    assert.ok(markdown.includes("Runtime Verification:** NOT EVALUATED"));
  });

  test("Tracking documents writer creates all 5 persistent documents", async () => {
    const evaluation = await comparator.evaluate();
    comparator.writeTrackingDocuments(evaluation);

    // Verify 5 files exist
    const docs = [
      "docs/JARVIS_ULTRON_BENCHMARK.md",
      "docs/ULTRON_GAP_ANALYSIS.md",
      "docs/ULTRON_IMPLEMENTATION_LOG.md",
      "docs/ULTRON_VERIFICATION_REPORT.md",
      "docs/ULTRON_REMAINING_BLOCKERS.md"
    ];

    for (const doc of docs) {
      const exists = fs.existsSync(path.join(process.cwd(), doc));
      assert.ok(exists, `Document ${doc} must be generated`);
    }

    const benchmark = fs.readFileSync(path.join(process.cwd(), "docs/JARVIS_ULTRON_BENCHMARK.md"), "utf8");
    assert.ok(benchmark.includes("JARVIS Alignment:** NOT MEASURED"));
    assert.ok(benchmark.includes("| NOT MEASURED | NOT MEASURED |"));
    assert.equal(benchmark.includes("${NOT_MEASURED"), false, "Generated benchmark must not contain broken template placeholders");
  });
});
