import test from "node:test";
import assert from "node:assert/strict";
import { SecretScanner, SECRET_RULES } from "../security/secret-scanner.js";

test("Secret Scanner: Detects AWS Access Key and redacts with zero retention", () => {
  const scanner = new SecretScanner();
  const rawAwsKey = "AKIA1234567890ABCDEF";
  const content = `const awsKey = "${rawAwsKey}";`;

  const findings = scanner.scanContent(content, "test-file.js");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "SEC-AWS-KEY");
  assert.equal(findings[0].severity, "CRITICAL");
  // Zero-retention: raw key must not be present in masked snippet
  assert.ok(!findings[0].maskedSnippet.includes(rawAwsKey));
  assert.ok(findings[0].maskedSnippet.includes("[REDACTED_SECRET:SEC-AWS-KEY:"));
});

test("Secret Scanner: Detects GitHub Personal Access Token", () => {
  const scanner = new SecretScanner();
  const rawToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
  const content = `const token = "${rawToken}";`;

  const findings = scanner.scanContent(content, "auth.js");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "SEC-GITHUB-PAT");
  assert.ok(!findings[0].maskedSnippet.includes(rawToken));
});

test("Secret Scanner: Detects Database Connection URI with password", () => {
  const scanner = new SecretScanner();
  const rawUri = "postgres://admin:SuperSecretPass123@db.internal.net:5432/production";
  const content = `const dbUri = "${rawUri}";`;

  const findings = scanner.scanContent(content, "config.js");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "SEC-DB-CONN-STRING");
  assert.ok(!findings[0].maskedSnippet.includes("SuperSecretPass123"));
});

test("Secret Scanner: Detects Private Key block", () => {
  const scanner = new SecretScanner();
  const content = `
    -----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA...
    -----END RSA PRIVATE KEY-----
  `;

  const findings = scanner.scanContent(content, "id_rsa");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "SEC-PRIVATE-KEY");
});

test("Secret Scanner: Repository scan runs clean on ignore patterns", async () => {
  const scanner = new SecretScanner();
  const report = await scanner.scanRepository(process.cwd());

  assert.equal(report.tool, "ultron-secret-scanner");
  assert.ok(report.filesScanned > 50);
  assert.ok(report.externalToolStatus.gitleaks);
});

test("Secret Scanner: Git history scan executes safely with tool fallback", async () => {
  const scanner = new SecretScanner();
  const report = await scanner.scanGitHistory(process.cwd(), 5);

  assert.equal(report.tool, "git-history-secret-scanner");
  assert.equal(typeof report.findingsCount, "number");
  assert.ok(Array.isArray(report.findings));
});
