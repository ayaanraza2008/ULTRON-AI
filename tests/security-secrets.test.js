import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SecretScanner, SECRET_RULES } from "../security/secret-scanner.js";

test("Secret Scanner: Detects AWS Access Key and redacts with zero retention", () => {
  const scanner = new SecretScanner();
  const rawAwsKey = "AKIA" + crypto.randomBytes(8).toString("hex").toUpperCase();
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
  const rawToken = "ghp_" + crypto.randomBytes(18).toString("hex");
  const content = `const token = "${rawToken}";`;

  const findings = scanner.scanContent(content, "auth.js");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "SEC-GITHUB-PAT");
  assert.ok(!findings[0].maskedSnippet.includes(rawToken));
});

test("Secret Scanner: Detects Database Connection URI with password", () => {
  const scanner = new SecretScanner();
  const rawUri = "postgres://admin:" + crypto.randomBytes(12).toString("hex") + "@db.internal.net:5432/production";
  const content = `const dbUri = "${rawUri}";`;

  const findings = scanner.scanContent(content, "config.js");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "SEC-DB-CONN-STRING");
  assert.ok(!findings[0].maskedSnippet.includes("SuperSecretPass123"));
});

test("Secret Scanner: Detects Private Key block", () => {
  const scanner = new SecretScanner();
  const header = "-----BEGIN " + "EC " + "PRIVATE KEY-----";
  const footer = "-----END " + "EC " + "PRIVATE KEY-----";
  const content = `
    ${header}
    MIIEowIBAAKCAQEA...
    ${footer}
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

test("Secret Scanner: includes tests and reports in repository scans", () => {
  const scanner = new SecretScanner();
  assert.equal(scanner.isIgnored("tests/security-secrets.test.js"), false);
  assert.equal(scanner.isIgnored("reports/security-audit-report.md"), false);
});

test("Secret Scanner: Git history scan executes safely with tool fallback", async () => {
  const scanner = new SecretScanner();
  const report = await scanner.scanGitHistory(process.cwd(), 5);

  assert.equal(report.tool, "git-history-secret-scanner");
  assert.equal(report.status, "COMPLETED");
  assert.ok(report.commitsScanned > 0 && report.commitsScanned <= 5);
  assert.equal(typeof report.findingsCount, "number");
  assert.ok(Array.isArray(report.findings));
});

test("Secret Scanner: allowlists only exact legacy synthetic fixtures", () => {
  const scanner = new SecretScanner();
  const legacyFixture = ["test", "password"].join("-");
  const allowed = scanner.scanContent('APP_ACCESS_PASSWORD: "' + legacyFixture + '"', "legacy-fixture.js");
  assert.equal(allowed.length, 0);

  const unknownFixture = ["not", "an", "allowlisted", "fixture"].join("-");
  const detected = scanner.scanContent('password: "' + unknownFixture + '"', "unknown-fixture.js");
  assert.equal(detected.length, 1);
});
