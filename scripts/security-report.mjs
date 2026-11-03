#!/usr/bin/env node
/**
 * ULTRON AI — Security Quality Gate: Master Report Compiler
 * Command: npm run security:report
 */

import fs from "node:fs";
import path from "node:path";
import { codeShield } from "../security/code-shield.js";
import { secretScanner } from "../security/secret-scanner.js";

async function main() {
  console.log("=================================================");
  console.log("   ULTRON AI — MASTER SECURITY QUALITY GATE REPORT");
  console.log("=================================================");
  console.log(`Analyzing repository: ${process.cwd()}\n`);

  const startTime = Date.now();

  console.log("[1/3] Executing Static Application Security Testing (SAST)...");
  const sastReport = await codeShield.scanRepository(process.cwd());

  console.log("[2/3] Executing Dependency Vulnerability Audit (SCA)...");
  const depReport = await codeShield.auditDependencies(process.cwd());

  console.log("[3/3] Executing Secret & Credential Scanning...");
  const secretRepoReport = await secretScanner.scanRepository(process.cwd());
  const secretGitReport = await secretScanner.scanGitHistory(process.cwd(), 30);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // Categorize findings into Confirmed, Potential Risks, Informational
  const confirmedVulnerabilities = [];
  const potentialRisks = [];
  const informationalFindings = [];
  const skippedOrUnavailableTools = [];

  // SAST Categorization
  sastReport.findings.forEach(f => {
    if (f.severity === "CRITICAL" || f.severity === "HIGH") {
      confirmedVulnerabilities.push({
        source: "SAST",
        category: "Code Vulnerability",
        ...f
      });
    } else if (f.severity === "MEDIUM") {
      potentialRisks.push({
        source: "SAST",
        category: "Code Weakness",
        ...f
      });
    } else {
      informationalFindings.push({
        source: "SAST",
        category: "Code Quality",
        ...f
      });
    }
  });

  // Dependencies Categorization
  depReport.findings.forEach(f => {
    if (f.severity === "CRITICAL" || f.severity === "HIGH") {
      confirmedVulnerabilities.push({
        source: "Dependencies",
        category: "Vulnerable Package",
        title: `Vulnerable dependency: ${f.package}`,
        cwe: f.cves.join(", ") || "Known CVE",
        filePath: "package.json",
        lineNumber: 1,
        severity: f.severity,
        snippet: `${f.package}@${f.range}`,
        description: f.description,
        remediation: f.remediation
      });
    } else {
      potentialRisks.push({
        source: "Dependencies",
        category: "Package Advisory",
        title: `Dependency advisory: ${f.package}`,
        cwe: f.cves.join(", ") || "Advisory",
        filePath: "package.json",
        lineNumber: 1,
        severity: f.severity,
        snippet: `${f.package}@${f.range}`,
        description: f.description,
        remediation: f.remediation
      });
    }
  });

  // Secrets Categorization
  const allSecrets = [...secretRepoReport.findings, ...secretGitReport.findings];
  allSecrets.forEach(s => {
    confirmedVulnerabilities.push({
      source: "Secret Detection",
      category: "Exposed Credential",
      title: s.name,
      cwe: "CWE-798",
      filePath: s.filePath || s.file,
      lineNumber: s.lineNumber || s.commit,
      severity: s.severity,
      snippet: s.maskedSnippet,
      description: s.description || "Potential plaintext credential in repository or commit history.",
      remediation: s.recommendation
    });
  });

  // External tools tracking
  if (!sastReport.externalToolStatus.semgrep.available) {
    skippedOrUnavailableTools.push({
      tool: "Semgrep",
      type: "SAST",
      status: "TOOL_UNAVAILABLE",
      fallback: "ULTRON Code Shield native AST/regex engine",
      reason: sastReport.externalToolStatus.semgrep.message
    });
  }
  if (!sastReport.externalToolStatus.eslint.available) {
    skippedOrUnavailableTools.push({
      tool: "ESLint Security Plugins",
      type: "SAST",
      status: "TOOL_UNAVAILABLE",
      fallback: "ULTRON Code Shield native AST/regex engine",
      reason: sastReport.externalToolStatus.eslint.message
    });
  }
  if (!depReport.externalToolStatus?.trivy?.available) {
    skippedOrUnavailableTools.push({
      tool: "Trivy / OSV",
      type: "SCA",
      status: "TOOL_UNAVAILABLE",
      fallback: "npm audit host engine",
      reason: depReport.externalToolStatus?.trivy?.message || "Trivy CLI not in PATH"
    });
  }
  if (!secretRepoReport.externalToolStatus.gitleaks.available) {
    skippedOrUnavailableTools.push({
      tool: "Gitleaks",
      type: "Secret Detection",
      status: "TOOL_UNAVAILABLE",
      fallback: "ULTRON Secret Scanner native engine",
      reason: secretRepoReport.externalToolStatus.gitleaks.message
    });
  }

  const qualityGateBlockers = [];
  if (sastReport.isSecure !== true) qualityGateBlockers.push("SAST findings require review or remediation.");
  if (depReport.status !== "COMPLETED" || depReport.isSecure !== true) {
    qualityGateBlockers.push("Dependency audit did not complete cleanly or reported vulnerabilities.");
  }
  if (secretRepoReport.isSecure !== true) qualityGateBlockers.push("Working-tree secret scan found potential credentials.");
  if (secretGitReport.status !== "COMPLETED" || secretGitReport.isSecure !== true) {
    qualityGateBlockers.push("Git-history secret scan did not complete cleanly or found potential credentials.");
  }
  if (confirmedVulnerabilities.length > 0) qualityGateBlockers.push("Critical/high findings remain unresolved.");

  const isQualityGatePassed = qualityGateBlockers.length === 0;
  const masterReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      targetRepository: process.cwd(),
      elapsedSeconds: parseFloat(elapsed),
      summary: {
        confirmedVulnerabilitiesCount: confirmedVulnerabilities.length,
        potentialRisksCount: potentialRisks.length,
        informationalFindingsCount: informationalFindings.length,
        skippedToolsCount: skippedOrUnavailableTools.length,
        qualityGateBlockers,
        isQualityGatePassed
      }
    },
    metrics: {
      sast: {
        filesScanned: sastReport.filesScanned,
        linesScanned: sastReport.linesScanned,
        findingsCount: sastReport.findingsCount,
        severityBreakdown: sastReport.severityBreakdown,
        maxCvssScore: sastReport.maxCvssScore
      },
      dependencies: {
        tool: depReport.tool,
        status: depReport.status,
        totalDependencies: depReport.totalDependencies,
        vulnerabilitiesCount: depReport.vulnerabilitiesCount,
        severityBreakdown: depReport.severityBreakdown
      },
      secrets: {
        filesScanned: secretRepoReport.filesScanned,
        commitsScanned: secretGitReport.commitsScanned,
        findingsCount: allSecrets.length
      }
    },
    findings: {
      confirmedVulnerabilities,
      potentialRisks,
      informationalFindings
    },
    externalTools: skippedOrUnavailableTools
  };

  // Ensure reports directory exists
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save JSON report
  const jsonPath = path.join(reportsDir, "security-audit-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(masterReport, null, 2), "utf8");

  // Generate Markdown report
  const mdPath = path.join(reportsDir, "security-audit-report.md");
  let md = `# ULTRON AI — REPOSITORY SECURITY QUALITY GATE REPORT\n\n`;
  md += `**Timestamp:** ${masterReport.metadata.generatedAt}  \n`;
  md += `**Target:** \`${masterReport.metadata.targetRepository}\`  \n`;
  md += `**Duration:** ${masterReport.metadata.elapsedSeconds}s  \n`;
  md += `**Quality Gate Status:** ${masterReport.metadata.summary.isQualityGatePassed ? "**PASSED** :white_check_mark:" : "**ACTION REQUIRED** :warning:"}\n\n`;

  md += `## 1. Summary Scorecard\n\n`;
  md += `| Category | Count | Status |\n`;
  md += `| :--- | :---: | :--- |\n`;
  md += `| Confirmed Vulnerabilities (Critical/High) | ${confirmedVulnerabilities.length} | ${confirmedVulnerabilities.length === 0 ? "PASSED" : "FAILED"} |\n`;
  md += `| Potential Risks & Warnings (Medium) | ${potentialRisks.length} | ${potentialRisks.length === 0 ? "PASSED" : "REVIEW"} |\n`;
  md += `| Informational Findings (Low) | ${informationalFindings.length} | INFO |\n`;
  md += `| External Tool Fallbacks / Skipped | ${skippedOrUnavailableTools.length} | HANDLED BY NATIVE ENGINE |\n\n`;

  md += `## 2. Verification Metrics\n\n`;
  md += `- **SAST:** ${sastReport.filesScanned} files scanned, ${sastReport.linesScanned} lines analyzed. Max CVSS: ${sastReport.maxCvssScore.toFixed(1)}\n`;
  md += `- **Dependencies (SCA):** ${depReport.totalDependencies} dependencies audited via host \`npm audit\`. Vulnerabilities: ${depReport.vulnerabilitiesCount}\n`;
  md += `- **Secret Detection:** ${secretRepoReport.filesScanned} files and ${secretGitReport.commitsScanned} Git commits scanned with strict zero-retention SHA-256 masking.\n\n`;

  md += `## 3. External Tool Integration & Availability Status\n\n`;
  md += `| Tool | Domain | Status | Fallback / Notes |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  md += `| Semgrep | SAST | ${sastReport.externalToolStatus.semgrep.status} | ${sastReport.externalToolStatus.semgrep.message} |\n`;
  md += `| ESLint | SAST | ${sastReport.externalToolStatus.eslint.status} | ${sastReport.externalToolStatus.eslint.message} |\n`;
  md += `| npm audit | SCA | ${depReport.status} | Genuine tool execution on host node environment |\n`;
  md += `| Trivy / OSV | SCA | ${depReport.externalToolStatus?.trivy?.status || "UNAVAILABLE"} | Native npm audit utilized |\n`;
  md += `| Gitleaks | Secrets | ${secretRepoReport.externalToolStatus.gitleaks.status} | Native high-precision regex secret scanner with zero-retention |\n\n`;

  if (confirmedVulnerabilities.length > 0) {
    md += `## 4. Confirmed Vulnerabilities (Critical & High)\n\n`;
    confirmedVulnerabilities.forEach((f, idx) => {
      md += `### ${idx + 1}. [${f.severity}] ${f.title} (${f.cwe || f.ruleId})\n`;
      md += `- **Source:** ${f.source}\n`;
      md += `- **Location:** \`${f.filePath}:${f.lineNumber}\`\n`;
      md += `- **Snippet:** \`${f.snippet}\`\n`;
      md += `- **Description:** ${f.description}\n`;
      md += `- **Remediation:** ${f.remediation}\n\n`;
    });
  }

  if (potentialRisks.length > 0) {
    md += `## 5. Potential Risks & Configuration Warnings\n\n`;
    potentialRisks.forEach((f, idx) => {
      md += `### ${idx + 1}. [${f.severity}] ${f.title} (${f.cwe || f.ruleId})\n`;
      md += `- **Source:** ${f.source}\n`;
      md += `- **Location:** \`${f.filePath}:${f.lineNumber}\`\n`;
      md += `- **Snippet:** \`${f.snippet}\`\n`;
      md += `- **Remediation:** ${f.remediation}\n\n`;
    });
  }

  fs.writeFileSync(mdPath, md, "utf8");

  console.log(`\nMaster Report written successfully:`);
  console.log(`  - JSON: ${jsonPath}`);
  console.log(`  - MD:   ${mdPath}\n`);

  console.log(`=================================================`);
  console.log(`Summary:`);
  console.log(`  Confirmed Vulnerabilities: ${confirmedVulnerabilities.length}`);
  console.log(`  Potential Risks / Warnings: ${potentialRisks.length}`);
  console.log(`  Informational Findings:     ${informationalFindings.length}`);
  console.log(`  Quality Gate Result:        ${masterReport.metadata.summary.isQualityGatePassed ? "PASSED" : "FAILED"}`);
  console.log(`=================================================`);

  process.exit(isQualityGatePassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Security Report Generator failed:", err);
  process.exit(1);
});
