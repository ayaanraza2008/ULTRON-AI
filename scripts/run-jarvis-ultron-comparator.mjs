/**
 * ULTRON AI — JARVIS + ULTRON Capability Comparator CLI Runner
 *
 * Runs the continuous side-by-side capability evaluation between:
 * - Iron Man's JARVIS reference
 * - Marvel's ULTRON reference
 * - Current ULTRON AI implementation
 *
 * Updates the 5 mandatory tracking documents:
 * 1. docs/JARVIS_ULTRON_BENCHMARK.md
 * 2. docs/ULTRON_GAP_ANALYSIS.md
 * 3. docs/ULTRON_IMPLEMENTATION_LOG.md
 * 4. docs/ULTRON_VERIFICATION_REPORT.md
 * 5. docs/ULTRON_REMAINING_BLOCKERS.md
 *
 * Usage:
 *   node scripts/run-jarvis-ultron-comparator.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { JarvisUltronCapabilityComparator } from "../benchmarks/jarvis-ultron-comparator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

async function main() {
  console.log("==========================================================================================");
  console.log("              ULTRON AI — JARVIS + ULTRON CONTINUOUS CAPABILITY COMPARATOR                ");
  console.log("==========================================================================================\n");

  const comparator = new JarvisUltronCapabilityComparator({ repoRoot: REPO_ROOT });
  const evaluation = await comparator.evaluate();

  console.log(`Evaluated At: ${evaluation.timestamp}`);
  console.log(`Comparator Version: ${evaluation.comparatorVersion}`);
  console.log(`Total Categories Audited: ${evaluation.categoriesCount}`);
  console.log(`------------------------------------------------------------------------------------------`);
  console.log(`ENGINEERING IMPLEMENTATION MATURITY: ${evaluation.totalMaturityScore}% / 100% (\x1b[32m${evaluation.status}\x1b[0m)`);
  console.log(`IRON MAN JARVIS CAPABILITY ALIGNMENT: ${evaluation.jarvisAlignmentScore}% (High Practical Parity)`);
  console.log(`MARVEL ULTRON AUTONOMY ALIGNMENT:     ${evaluation.ultronAlignmentScore}% (High Autonomous Parity)`);
  console.log(`------------------------------------------------------------------------------------------\n`);

  console.log("8-COLUMN COMPARISON SUMMARY:");
  console.log("--------------------------------------------------------------------------------------------------------------------");
  console.log(
    "No. | Category Name               | Weight | JARVIS Match | ULTRON Match | Real-World Score | Status   | Evidence Suites"
  );
  console.log("----+-----------------------------+--------+--------------+--------------+------------------+----------+----------------");

  evaluation.categories.forEach((cat, idx) => {
    const num = String(idx + 1).padStart(2, " ");
    const name = cat.name.padEnd(27, " ").slice(0, 27);
    const weight = `${cat.weight}%`.padStart(6, " ");
    const jMatch = `${cat.jarvisAlignment}%`.padStart(12, " ");
    const uMatch = `${cat.ultronAlignment}%`.padStart(12, " ");
    const score = `${cat.maturityScore}%`.padStart(16, " ");
    const status = cat.implementationStatus.padEnd(8, " ");
    const tests = `${cat.testEvidence.length} suites`.padStart(14, " ");

    console.log(`${num}  | ${name} | ${weight} | ${jMatch} | ${uMatch} | ${score} | ${status} | ${tests}`);
  });

  console.log("--------------------------------------------------------------------------------------------------------------------\n");

  comparator.writeTrackingDocuments(evaluation);

  console.log("Successfully updated all 5 persistent tracking documents:");
  console.log("  1. docs/JARVIS_ULTRON_BENCHMARK.md");
  console.log("  2. docs/ULTRON_GAP_ANALYSIS.md");
  console.log("  3. docs/ULTRON_IMPLEMENTATION_LOG.md");
  console.log("  4. docs/ULTRON_VERIFICATION_REPORT.md");
  console.log("  5. docs/ULTRON_REMAINING_BLOCKERS.md\n");
  console.log("Continuous evolution audit completed successfully.\n");
}

main().catch(err => {
  console.error("Comparator failed:", err);
  process.exit(1);
});
