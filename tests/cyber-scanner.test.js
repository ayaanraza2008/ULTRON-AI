import test from "node:test";
import assert from "node:assert/strict";
import { CyberVulnerabilityScanner } from "../security/cyber-scanner.js";

test("Cyber Scanner: Identifies insecure services and configuration without fabricated CVEs", async () => {
  const scanner = new CyberVulnerabilityScanner();
  const report = await scanner.runVulnerabilityScan("localhost", {
    openPorts: [21, 23],
    config: { debugMode: true }
  });

  assert.equal(report.target, "localhost");
  assert.equal(report.findingsCount, 3);
  assert.ok(report.findings.some(f => f.cwe === "CWE-319" && f.id === "VULN-FTP-01"));
  assert.ok(report.findings.some(f => f.cwe === "CWE-319" && f.id === "VULN-TELNET-01"));
  assert.ok(report.findings.some(f => f.cwe === "CWE-209" && f.id === "VULN-DEBUG-01"));

  // Verify NO fake CVEs were fabricated
  assert.ok(!report.findings.some(f => f.cve && f.cve.includes("XXXX")));
});

test("Cyber Scanner: Safe default on hardened target with no open ports returns zero findings", async () => {
  const scanner = new CyberVulnerabilityScanner();
  const report = await scanner.runVulnerabilityScan("localhost", {
    openPorts: [],
    config: { debugMode: false }
  });

  assert.equal(report.findingsCount, 0);
  assert.equal(report.maxCvss, 0);
});
