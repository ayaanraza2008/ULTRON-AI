/**
 * ULTRON AI — JARVIS Capability Benchmark CLI Runner
 *
 * Evaluates ULTRON against the 14-Category JARVIS-Inspired Capability Benchmark.
 *
 * Usage:
 *   node scripts/run-jarvis-benchmark.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JarvisCapabilityBenchmark } from "../benchmarks/jarvis-capability-benchmark.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

async function main() {
  console.log("==================================================================");
  console.log("      ULTRON AI — JARVIS-LEVEL CAPABILITY BENCHMARK RUNNER        ");
  console.log("==================================================================\n");

  const benchmark = new JarvisCapabilityBenchmark({ repoRoot: REPO_ROOT });
  const evaluation = await benchmark.evaluate();

  console.log(`Evaluated At: ${evaluation.timestamp}`);
  console.log(`Benchmark Engine Version: ${evaluation.benchmarkVersion}`);
  console.log(`Total Categories: ${evaluation.categoriesCount}`);
  console.log(`------------------------------------------------------------------`);
  console.log(`OVERALL VERIFIED SCORE: ${evaluation.totalWeightedScore}% / 100%`);
  console.log(`BENCHMARK STATUS:       ${evaluation.overallStatus}`);
  console.log(`------------------------------------------------------------------\n`);

  console.log("CATEGORY BREAKDOWN:");
  console.log("---------------------------------------------------------------------------------------------------------");
  console.log(
    "No. | Category Name                             | Weight | Score | Weighted | Status   | Subsystems | Tests"
  );
  console.log("----+-------------------------------------------+--------+-------+----------+----------+------------+-------");

  evaluation.categories.forEach((cat, idx) => {
    const num = String(idx + 1).padStart(2, " ");
    const name = cat.name.padEnd(41, " ").slice(0, 41);
    const weight = `${cat.weight}%`.padStart(6, " ");
    const score = `${cat.score}%`.padStart(5, " ");
    const weighted = `${cat.weightedScore}%`.padStart(8, " ");
    const status = cat.status.padEnd(8, " ");
    const subs = `${cat.subsystems.filter(s => s.exists).length}/${cat.subsystems.length}`.padStart(10, " ");
    const tests = `${cat.testFiles.filter(t => t.exists).length}/${cat.testFiles.length}`.padStart(5, " ");

    console.log(`${num}  | ${name} | ${weight} | ${score} | ${weighted} | ${status} | ${subs} | ${tests}`);
  });

  console.log("---------------------------------------------------------------------------------------------------------\n");

  const markdownReport = benchmark.generateMarkdownReport(evaluation);
  const outputPath = path.join(REPO_ROOT, "docs", "JARVIS_BENCHMARK_SCORECARD.md");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdownReport, "utf8");

  console.log(`Full Benchmark Scorecard saved to: docs/JARVIS_BENCHMARK_SCORECARD.md`);
  console.log("Benchmark verification completed successfully.\n");
}

main().catch(err => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
