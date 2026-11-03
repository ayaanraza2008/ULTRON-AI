/**
 * ULTRON AI — Full Regression Test Runner & Auditor
 *
 * Runs all test files across the repository, capturing granular pass/fail/skip
 * counts, failure reasons, and timing. Completely immune to terminal buffer limits.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function findTestFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      files = files.concat(findTestFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.mjs"))) {
      files.push(fullPath);
    }
  }
  return files;
}

const testFiles = findTestFiles("tests");
if (fs.existsSync("test")) {
  testFiles.push(...findTestFiles("test"));
}

console.log(`Discovered ${testFiles.length} test files across the repository.`);

const results = [];
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
let filePassCount = 0;
let fileFailCount = 0;

const startTime = Date.now();

for (let i = 0; i < testFiles.length; i++) {
  const file = testFiles[i];
  const fileRel = path.relative(process.cwd(), file);
  process.stdout.write(`[${i + 1}/${testFiles.length}] ${fileRel} ... `);

  const fileStart = Date.now();
  const child = spawn(process.execPath, ["--test", file], {
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", d => stdout += d.toString());
  child.stderr.on("data", d => stderr += d.toString());

  await new Promise(resolve => child.on("close", resolve));
  const fileDuration = Date.now() - fileStart;

  const output = stdout + "\n" + stderr;
  const passedMatch = output.match(/ℹ\s+pass\s+(\d+)/);
  const failedMatch = output.match(/ℹ\s+fail\s+(\d+)/);
  const skippedMatch = output.match(/ℹ\s+skipped\s+(\d+)/);

  const filePassed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const fileFailed = failedMatch ? parseInt(failedMatch[1], 10) : (child.exitCode !== 0 ? 1 : 0);
  const fileSkipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

  totalPassed += filePassed;
  totalFailed += fileFailed;
  totalSkipped += fileSkipped;

  if (fileFailed === 0) {
    filePassCount++;
    console.log(`PASS (${filePassed} passed, ${fileDuration}ms)`);
  } else {
    fileFailCount++;
    console.log(`FAIL (${fileFailed} failed, ${fileDuration}ms)`);
  }

  results.push({
    file: fileRel,
    exitCode: child.exitCode,
    passed: filePassed,
    failed: fileFailed,
    skipped: fileSkipped,
    durationMs: fileDuration,
    errorSnippet: fileFailed > 0 ? output.slice(-500) : null
  });
}

const totalDuration = Date.now() - startTime;
const summary = {
  timestamp: new Date().toISOString(),
  totalFiles: testFiles.length,
  filePassCount,
  fileFailCount,
  totalPassed,
  totalFailed,
  totalSkipped,
  totalDurationMs: totalDuration,
  results
};

fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync("reports/full-regression-results.json", JSON.stringify(summary, null, 2), "utf8");

console.log("\n==========================================");
console.log("FULL REPOSITORY REGRESSION SUMMARY");
console.log("==========================================");
console.log(`Total Test Files: ${testFiles.length}`);
console.log(`Files Passed:     ${filePassCount}`);
console.log(`Files Failed:     ${fileFailCount}`);
console.log(`Total Tests:      ${totalPassed + totalFailed + totalSkipped}`);
console.log(`Passed Tests:     ${totalPassed}`);
console.log(`Failed Tests:     ${totalFailed}`);
console.log(`Skipped Tests:    ${totalSkipped}`);
console.log(`Total Duration:   ${(totalDuration / 1000).toFixed(2)}s`);
console.log("==========================================");
console.log("Detailed report saved to reports/full-regression-results.json\n");
