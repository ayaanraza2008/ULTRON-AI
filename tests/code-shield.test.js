import test from "node:test";
import assert from "node:assert/strict";
import { CodeShield, SAST_RULES } from "../security/code-shield.js";

test("Code Shield: SAST identifies Command Injection (CWE-78)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    const { exec } = require('child_process');
    function runUserCommand(userInput) {
      exec("ping " + userInput);
    }
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-78" && f.severity === "CRITICAL"));
});

test("Code Shield: SAST identifies SQL Injection (CWE-89)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    async function getUser(id) {
      return await db.query("SELECT * FROM users WHERE id = " + id);
    }
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-89" && f.severity === "CRITICAL"));
});

test("Code Shield: SAST identifies Hardcoded Credential (CWE-798) and redacts in snippet", () => {
  const shield = new CodeShield();
  const rawKey = "sk-ant-test-secret-1234567890abcdef123456";
  const vulnerableCode = `const apiKey = "${rawKey}";`;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  const credFinding = report.findings.find(f => f.cwe === "CWE-798");
  assert.ok(credFinding);
  // Secret must be redacted
  assert.ok(!credFinding.snippet.includes(rawKey));
  assert.ok(credFinding.snippet.includes("[REDACTED_SECRET"));
});

test("Code Shield: Generates CycloneDX SBOM from package.json", () => {
  const shield = new CodeShield();
  const mockPkg = {
    name: "ultron-secure-app",
    version: "2.1.0",
    dependencies: {
      express: "^4.21.0",
      helmet: "^7.1.0"
    }
  };

  const sbom = shield.generateSbom(mockPkg, { target: "localhost" });
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal(sbom.totalComponents, 2);
  assert.ok(sbom.components.some(c => c.name === "express"));
});

test("Code Shield: Proposes safe non-destructive remediation patch", () => {
  const shield = new CodeShield();
  const finding = {
    findingId: "vuln-01",
    cwe: "CWE-89",
    title: "SQL Injection",
    severity: "CRITICAL",
    description: "Dynamic SQL concat"
  };

  const proposal = shield.proposeRemediation(finding);
  assert.equal(proposal.cwe, "CWE-89");
  assert.ok(proposal.proposedPatch.includes("parameterized"));
  assert.equal(proposal.status, "PROPOSED");
});
