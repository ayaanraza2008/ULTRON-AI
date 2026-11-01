import test from "node:test";
import assert from "node:assert/strict";
import { CyberWebAuditor } from "../security/cyber-web.js";

test("Cyber Web: Audits missing security headers and flags high/medium risks", async () => {
  const auditor = new CyberWebAuditor();
  const suppliedHeaders = { server: "Express" };

  const report = await auditor.auditEndpoint("http://localhost:3000", { headers: suppliedHeaders });
  assert.ok(report.findingsCount >= 3);
  assert.ok(report.findings.some(f => f.check === "Content-Security-Policy"));
  assert.ok(report.findings.some(f => f.check === "Strict-Transport-Security"));
  assert.equal(report.overallRisk, "HIGH");
  assert.equal(report.status, "INPUT_ANALYSIS_ONLY");
  assert.equal(report.verificationStatus, "NOT_INDEPENDENTLY_VERIFIED");
  assert.ok(report.findings.every(f => f.evidenceSource === "CALLER_SUPPLIED_INPUT"));
});

test("Cyber Web: Audits cookie security flags for HttpOnly and Secure", async () => {
  const auditor = new CyberWebAuditor();
  const cookies = ["sessionId=xyz123; Path=/"]; // Missing HttpOnly, Secure, SameSite

  const report = await auditor.auditEndpoint("http://localhost:3000", { cookies });
  assert.ok(report.findings.some(f => f.check === "Cookie-HttpOnly"));
  assert.ok(report.findings.some(f => f.check === "Cookie-Secure"));
  assert.equal(report.status, "INPUT_ANALYSIS_ONLY");
});

test("Cyber Web: Detects insecure CORS wildcard with credentials enabled", async () => {
  const auditor = new CyberWebAuditor();
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-credentials": "true"
  };

  const report = await auditor.auditEndpoint("http://localhost:3000", { corsHeaders });
  assert.ok(report.findings.some(f => f.check === "CORS-Wildcard-Credentials" && f.severity === "CRITICAL"));
  assert.equal(report.status, "INPUT_ANALYSIS_ONLY");
});

test("Cyber Web: Identifies JWT 'none' algorithm as CRITICAL", async () => {
  const auditor = new CyberWebAuditor();
  // Craft mock token with alg: "none"
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64");
  const payload = Buffer.from(JSON.stringify({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64");
  const token = `${header}.${payload}.`;

  const findings = auditor.auditJwtToken(token);
  assert.ok(findings.some(f => f.check === "JWT-None-Algorithm" && f.severity === "CRITICAL"));
});

test("Cyber Web: No captured evidence is not reported as a secure endpoint", async () => {
  const auditor = new CyberWebAuditor();
  const report = await auditor.auditEndpoint("http://localhost:3000");

  assert.equal(report.findingsCount, 0);
  assert.equal(report.status, "NOT_ASSESSED");
  assert.equal(report.overallRisk, "NOT_ASSESSED");
  assert.equal(report.verificationStatus, "NOT_INDEPENDENTLY_VERIFIED");
});
