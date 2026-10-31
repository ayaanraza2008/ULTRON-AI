import test from "node:test";
import assert from "node:assert/strict";
import {
  cyberSecurityIntel,
  CyberSecurityIntel,
  VULNERABILITY_SEVERITY
} from "../security/cyber-intel.js";

test("CyberSecurityIntel: Scope enforcement permits localhost targets and blocks unauthorized hosts", () => {
  const intel = new CyberSecurityIntel();
  assert.equal(intel.isTargetInScope("localhost"), true);
  assert.equal(intel.isTargetInScope("127.0.0.1"), true);
  assert.equal(intel.isTargetInScope("::1"), true);

  // Unauthorized targets fail
  assert.equal(intel.isTargetInScope("google.com"), false);
  assert.equal(intel.isTargetInScope("192.168.1.100"), false);

  // Assessment against unauthorized target rejected with TARGET_OUT_OF_SCOPE_PROHIBITED
  const outOfScope = intel.performDefensiveAssessment({
    target: "unauthorized-external-site.com"
  });
  assert.equal(outOfScope.success, false);
  assert.equal(outOfScope.error, "TARGET_OUT_OF_SCOPE_PROHIBITED");
});

test("CyberSecurityIntel: Authorizing custom target requires operator consent record", () => {
  const intel = new CyberSecurityIntel();

  // Attempt to authorize without approval record
  const unapproved = intel.authorizeTargetScope("testlab.internal", {});
  assert.equal(unapproved.success, false);
  assert.equal(unapproved.error, "AUTHORIZATION_RECORD_REQUIRED");

  // With operator approval
  const approved = intel.authorizeTargetScope("testlab.internal", { ownerApproved: true });
  assert.equal(approved.success, true);
  assert.equal(intel.isTargetInScope("testlab.internal"), true);
  assert.equal(intel.isTargetInScope("api.testlab.internal"), true);
});

test("CyberSecurityIntel: Security headers inspection audits CSP, HSTS, X-Frame-Options", () => {
  const intel = new CyberSecurityIntel();

  // Completely unprotected headers
  const weakHeaders = intel.auditSecurityHeaders({
    "server": "nginx"
  });
  assert.equal(weakHeaders.passed, false);
  assert.ok(weakHeaders.findingsCount >= 4);
  assert.equal(weakHeaders.overallRisk, VULNERABILITY_SEVERITY.HIGH); // missing HSTS is HIGH

  // Compliant headers
  const strongHeaders = intel.auditSecurityHeaders({
    "Content-Security-Policy": "default-src 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff"
  });
  assert.equal(strongHeaders.passed, true);
  assert.equal(strongHeaders.findingsCount, 0);
  assert.equal(strongHeaders.overallRisk, "SECURE");
});

test("CyberSecurityIntel: Static secret scanner detects exposed API keys and private keys", () => {
  const intel = new CyberSecurityIntel();

  const sourceSnippet = `
    const githubKey = "ghp_123456789012345678901234567890";
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const normalVar = "hello world";
  `;

  const secretResult = intel.scanSecrets(sourceSnippet);
  assert.equal(secretResult.clean, false);
  assert.equal(secretResult.detectionsCount, 2);
  assert.ok(secretResult.detections.some(d => d.type === "GitHub Personal Access Token"));
  assert.ok(secretResult.detections.some(d => d.type === "AWS Access Key"));

  // Clean code
  const cleanResult = intel.scanSecrets("const apiKey = process.env.MY_API_KEY;");
  assert.equal(cleanResult.clean, true);
  assert.equal(cleanResult.detectionsCount, 0);
});

test("CyberSecurityIntel: Full defensive assessment on authorized target produces structured audit report", () => {
  const intel = new CyberSecurityIntel();
  const assessment = intel.performDefensiveAssessment({
    target: "127.0.0.1",
    headers: {
      "X-Content-Type-Options": "nosniff"
    },
    sourceCode: "const config = { secure: true };"
  });

  assert.equal(assessment.success, true);
  assert.ok(assessment.report.assessmentId);
  assert.equal(assessment.report.scopeVerified, true);
  assert.equal(assessment.report.secretAudit.clean, true);
  assert.ok(intel.auditHistory.length >= 1);
});
