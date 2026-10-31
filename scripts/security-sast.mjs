#!/usr/bin/env node
/**
 * ULTRON AI — Security Quality Gate: SAST Runner
 * Command: npm run security:sast
 */

import { codeShield } from "../security/code-shield.js";

async function main() {
  console.log("=================================================");
  console.log("   ULTRON AI — STATIC APPLICATION SECURITY TESTING (SAST)");
  console.log("=================================================");
  console.log(`Scanning target repository: ${process.cwd()}\n`);

  const startTime = Date.now();
  const report = await codeShield.scanRepository(process.cwd());
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`Scan completed in ${elapsed}s`);
  console.log(`Files Scanned:       ${report.filesScanned}`);
  console.log(`Lines Scanned:       ${report.linesScanned}`);
  console.log(`Findings Total:      ${report.findingsCount}`);
  console.log(`Max CVSS Score:      ${report.maxCvssScore.toFixed(1)}`);
  console.log(`Repository Clean:    ${report.isSecure ? "YES (PASSED)" : "NO (ISSUES DETECTED)"}`);
  console.log("\nSeverity Breakdown:");
  console.log(`  - CRITICAL: ${report.severityBreakdown.CRITICAL}`);
  console.log(`  - HIGH:     ${report.severityBreakdown.HIGH}`);
  console.log(`  - MEDIUM:   ${report.severityBreakdown.MEDIUM}`);
  console.log(`  - LOW:      ${report.severityBreakdown.LOW}`);

  console.log("\nExternal Tool Integration Status:");
  console.log(`  - Semgrep: ${report.externalToolStatus.semgrep.status} (${report.externalToolStatus.semgrep.message || "Active"})`);
  console.log(`  - ESLint:  ${report.externalToolStatus.eslint.status} (${report.externalToolStatus.eslint.message || "Active"})`);

  if (report.findings.length > 0) {
    console.log("\n---------------- Findings Detail ----------------");
    report.findings.forEach((f, idx) => {
      console.log(`[${idx + 1}] [${f.severity}] ${f.title} (${f.cwe})`);
      console.log(`    File:        ${f.filePath}:${f.lineNumber}`);
      console.log(`    Snippet:     ${f.snippet}`);
      console.log(`    Remediation: ${f.remediation}\n`);
    });
  } else {
    console.log("\n[PASS] Zero SAST vulnerabilities identified in repository source code.");
  }

  process.exit(report.severityBreakdown.CRITICAL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SAST Scanner execution failed:", err);
  process.exit(1);
});
