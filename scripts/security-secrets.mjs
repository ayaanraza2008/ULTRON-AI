#!/usr/bin/env node
/**
 * ULTRON AI — Security Quality Gate: Secret Detection Runner
 * Command: npm run security:secrets
 */

import { secretScanner } from "../security/secret-scanner.js";

async function main() {
  console.log("=================================================");
  console.log("   ULTRON AI — REPOSITORY SECRET SCANNER");
  console.log("=================================================");
  console.log(`Scanning working tree and Git history: ${process.cwd()}\n`);

  const startTime = Date.now();
  const repoReport = await secretScanner.scanRepository(process.cwd());
  const gitReport = await secretScanner.scanGitHistory(process.cwd(), 30);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  const totalFindings = repoReport.findingsCount + gitReport.findingsCount;
  const isClean = repoReport.isSecure && gitReport.isSecure;

  console.log(`Scan completed in ${elapsed}s`);
  console.log(`Files Scanned:        ${repoReport.filesScanned}`);
  console.log(`Lines Scanned:        ${repoReport.linesScanned}`);
  console.log(`Git Commits Scanned:  ${gitReport.commitsScanned}`);
  console.log(`Total Findings:       ${totalFindings}`);
  console.log(`Repository Clean:     ${isClean ? "YES (PASSED)" : "NO (ISSUES DETECTED)"}`);

  console.log("\nExternal Tool Integration Status:");
  console.log(`  - Gitleaks: ${repoReport.externalToolStatus.gitleaks.status} (${repoReport.externalToolStatus.gitleaks.message || "Active"})`);

  if (totalFindings > 0) {
    console.log("\n---------------- Secret Findings Detail ----------------");
    if (repoReport.findings.length > 0) {
      console.log("[Working Tree Findings]");
      repoReport.findings.forEach((f, idx) => {
        console.log(`[${idx + 1}] [${f.severity}] ${f.name} (${f.ruleId})`);
        console.log(`    File:           ${f.filePath}:${f.lineNumber}`);
        console.log(`    Fingerprint:    ${f.fingerprint}`);
        console.log(`    Masked Snippet: ${f.maskedSnippet}`);
        console.log(`    Recommendation: ${f.recommendation}\n`);
      });
    }

    if (gitReport.findings.length > 0) {
      console.log("[Git History Findings]");
      gitReport.findings.forEach((f, idx) => {
        console.log(`[${idx + 1}] [${f.severity}] ${f.name} in commit ${f.commit}`);
        console.log(`    File:           ${f.file}`);
        console.log(`    Fingerprint:    ${f.fingerprint}`);
        console.log(`    Masked Snippet: ${f.maskedSnippet}`);
        console.log(`    Recommendation: ${f.recommendation}\n`);
      });
    }
  } else {
    console.log("\n[PASS] Zero secrets or sensitive credentials detected in repository files or commit history.");
  }

  process.exit(isClean ? 0 : 1);
}

main().catch((err) => {
  console.error("Secret Scanner execution failed:", err);
  process.exit(1);
});
