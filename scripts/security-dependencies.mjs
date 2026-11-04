#!/usr/bin/env node
/**
 * ULTRON AI — Security Quality Gate: Dependency Vulnerability Audit (SCA)
 * Command: npm run security:dependencies
 */

import { codeShield } from "../security/code-shield.js";
import { dependencyAuditExitCode } from "../security/dependency-audit-gate.js";

async function main() {
  console.log("=================================================");
  console.log("   ULTRON AI — SOFTWARE COMPOSITION ANALYSIS (SCA)");
  console.log("=================================================");
  console.log(`Auditing dependencies in: ${process.cwd()}\n`);

  const startTime = Date.now();
  const report = await codeShield.auditDependencies(process.cwd());
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const severity = report.severityBreakdown || {};

  console.log(`Audit completed in ${elapsed}s`);
  console.log(`Tool Engine:          ${report.tool || "UNKNOWN"}`);
  console.log(`Execution Status:     ${report.status || "UNKNOWN"}`);
  console.log(`Total Dependencies:   ${report.totalDependencies ?? "UNKNOWN"}`);
  console.log(`Total Vulnerabilities:${report.vulnerabilitiesCount ?? "UNKNOWN"}`);
  console.log(`Direct Vulnerabilities:${report.directCount || 0}`);
  console.log(`Transitive Vulns:     ${report.transitiveCount || 0}`);
  console.log(`Dependency Clean:     ${report.isSecure === true ? "YES (NO FINDINGS)" : "NO / NOT VERIFIED"}`);

  console.log("\nSeverity Breakdown:");
  console.log(`  - CRITICAL: ${severity.critical ?? "UNKNOWN"}`);
  console.log(`  - HIGH:     ${severity.high ?? "UNKNOWN"}`);
  console.log(`  - MODERATE: ${severity.moderate ?? "UNKNOWN"}`);
  console.log(`  - LOW:      ${severity.low ?? "UNKNOWN"}`);
  console.log(`  - INFO:     ${severity.info ?? "UNKNOWN"}`);

  console.log("\nExternal Tool Integration Status:");
  console.log(`  - Trivy: ${report.externalToolStatus?.trivy?.status || "UNCHECKED"} (${report.externalToolStatus?.trivy?.message || "No additional detail"})`);

  if (report.findings && report.findings.length > 0) {
    console.log("\n---------------- Vulnerabilities Detail ----------------");
    report.findings.forEach((f, idx) => {
      console.log(`[${idx + 1}] [${f.severity}] Package: ${f.package} (${f.range})`);
      console.log(`    Direct:      ${f.isDirect ? "Yes" : "No (Transitive)"}`);
      console.log(`    CVEs/CWEs:   ${(f.cves || []).join(", ") || "N/A"}`);
      console.log(`    Fix:         ${f.remediation}\n`);
    });
  }

  const exitCode = dependencyAuditExitCode(report);
  if (exitCode === 2) {
    console.error("\n[BLOCKED] Dependency audit did not complete; refusing to report a clean result.");
  } else if (exitCode === 1) {
    console.error("\n[FAILED] HIGH or CRITICAL dependency advisories require remediation.");
  } else {
    console.log("\n[PASS] No HIGH or CRITICAL dependency advisories detected by the completed npm audit.");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Dependency Auditor execution failed:", err);
  process.exit(2);
});
