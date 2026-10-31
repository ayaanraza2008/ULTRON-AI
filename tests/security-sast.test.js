import test from "node:test";
import assert from "node:assert/strict";
import { CodeShield, SAST_RULES } from "../security/code-shield.js";

test("SAST: Identifies Dynamic Code Evaluation (CWE-95)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    function processUserScript(req) {
      return eval(req.body.script);
    }
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-95" && f.severity === "CRITICAL"));
});

test("SAST: Identifies Path Traversal (CWE-22)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    const userPath = path.join("/var/data", req.query.filename);
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-22" && f.severity === "HIGH"));
});

test("SAST: Identifies Unsafe Dynamic File Write (CWE-73)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    fs.writeFileSync(req.body.targetFile, payload);
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-73" && f.severity === "HIGH"));
});

test("SAST: Identifies Insecure Cryptographic Hash MD5/SHA1 (CWE-327)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    const userPassHash = crypto.createHash("md5").update(password).digest("hex");
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-327" && f.severity === "MEDIUM"));
});

test("SAST: Identifies Math.random used for Security Tokens (CWE-330)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    const sessionToken = "token_" + Math.random();
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-330" && f.severity === "HIGH"));
});

test("SAST: Identifies Permissive Wildcard CORS (CWE-346)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    res.setHeader("Access-Control-Allow-Origin", "*");
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-346" && f.severity === "MEDIUM"));
});

test("SAST: Identifies Insecure JWT Algorithm None (CWE-287)", () => {
  const shield = new CodeShield();
  const vulnerableCode = `
    jwt.verify(token, secret, { algorithms: ["none"] });
  `;

  const report = shield.scanSourceCode(vulnerableCode, { target: "localhost" });
  assert.equal(report.isSecure, false);
  assert.ok(report.findings.some(f => f.cwe === "CWE-287" && f.severity === "CRITICAL"));
});

test("SAST: Supports inline comment suppression (sast-ignore / nosec)", () => {
  const shield = new CodeShield();
  const suppressedCode = `
    const hash = crypto.createHash("sha1").update(data); // nosec: protocol requirement
  `;

  const report = shield.scanSourceCode(suppressedCode, { target: "localhost" });
  assert.equal(report.isSecure, true);
  assert.equal(report.findings.length, 0);
});

test("SAST: Repository scanner reports metrics and external tool status", async () => {
  const shield = new CodeShield();
  const report = await shield.scanRepository(process.cwd());

  assert.equal(report.tool, "ultron-code-shield-sast");
  assert.ok(report.filesScanned > 50);
  assert.ok(report.linesScanned > 10000);
  assert.equal(typeof report.isSecure, "boolean");
  assert.ok(report.externalToolStatus.semgrep);
  assert.ok(report.externalToolStatus.eslint);
});
