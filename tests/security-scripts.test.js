import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test("Security Scripts: security-dependencies script executes and outputs clean report", async () => {
  const isWin = process.platform === "win32";
  const bin = isWin ? (process.env.ComSpec || "cmd.exe") : "node";
  const args = isWin
    ? ["/d", "/s", "/c", "node scripts/security-dependencies.mjs"]
    : ["scripts/security-dependencies.mjs"];

  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd: process.cwd(), timeout: 15000 }, (error, stdout) => {
      assert.ifError(error);
      assert.ok(stdout.includes("SOFTWARE COMPOSITION ANALYSIS"));
      assert.ok(stdout.includes("Total Dependencies:"));
      resolve();
    });
  });
});

test("Security Scripts: security-report script generates JSON and MD reports", async () => {
  const isWin = process.platform === "win32";
  const bin = isWin ? (process.env.ComSpec || "cmd.exe") : "node";
  const args = isWin
    ? ["/d", "/s", "/c", "node scripts/security-report.mjs"]
    : ["scripts/security-report.mjs"];

  return new Promise((resolve) => {
    execFile(bin, args, { cwd: process.cwd(), timeout: 20000 }, () => {
      // Regardless of pass/fail quality gate, report files must exist
      const jsonReport = path.join(process.cwd(), "reports", "security-audit-report.json");
      const mdReport = path.join(process.cwd(), "reports", "security-audit-report.md");

      assert.ok(fs.existsSync(jsonReport), "JSON audit report must exist");
      assert.ok(fs.existsSync(mdReport), "Markdown audit report must exist");

      const data = JSON.parse(fs.readFileSync(jsonReport, "utf8"));
      assert.ok(data.metadata);
      assert.ok(data.metrics);
      assert.ok(data.externalTools);
      resolve();
    });
  });
});
