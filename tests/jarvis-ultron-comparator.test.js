/**
 * ULTRON AI — JARVIS + ULTRON Capability Comparator Test Suite
 *
 * Verifies that the comparator evaluates all 14 categories, computes
 * the 8-column side-by-side comparison, calculates JARVIS and ULTRON
 * alignment scores, and confirms 100% engineering maturity.
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

  test("Evaluation runs and returns full 8-column comparative results with 100% maturity", async () => {
    const evaluation = await comparator.evaluate();
    assert.equal(evaluation.categoriesCount, 14);
    assert.equal(evaluation.totalMaturityScore, 100, "Maturity score must reach 100% of defined engineering requirements");
    assert.equal(evaluation.status, "VERIFIED_100_PERCENT");
    assert.ok(evaluation.jarvisAlignmentScore > 85, "JARVIS capability alignment must exceed 85%");
    assert.ok(evaluation.ultronAlignmentScore > 80, "Marvel ULTRON autonomy alignment must exceed 80%");

    for (const cat of evaluation.categories) {
      assert.equal(cat.maturityScore, 100, `Category ${cat.name} must score 100% maturity`);
      assert.ok(cat.subsystems.every(s => s.exists), `All subsystems in ${cat.name} must exist`);
      assert.ok(cat.testEvidence.every(t => t.exists), `All test evidence in ${cat.name} must exist`);
      assert.ok(cat.jarvisReference, "Column A (JARVIS Reference) must be populated");
      assert.ok(cat.ultronReference, "Column B (ULTRON Reference) must be populated");
      assert.ok(cat.currentUltron, "Column C (Current ULTRON) must be populated");
      assert.ok(cat.gapAnalysis, "Column D (Gap Analysis) must be populated");
      assert.ok(cat.requiredUpgrade, "Column E (Required Upgrade) must be populated");
      assert.ok(cat.implementationStatus, "Column F (Implementation Status) must be populated");
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
    assert.ok(markdown.includes("Col F: Status"));
    assert.ok(markdown.includes("Col G: Test Evidence"));
    assert.ok(markdown.includes("Col H: Verified Score"));
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
  });
});
