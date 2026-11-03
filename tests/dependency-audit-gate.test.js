import test from "node:test";
import assert from "node:assert/strict";
import { dependencyAuditExitCode } from "../security/dependency-audit-gate.js";

const cleanReport = {
  status: "COMPLETED",
  severityBreakdown: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }
};

test("dependency gate passes only a completed audit without high or critical advisories", () => {
  assert.equal(dependencyAuditExitCode(cleanReport), 0);
});

test("dependency gate fails for high-severity advisories", () => {
  assert.equal(dependencyAuditExitCode({
    ...cleanReport,
    severityBreakdown: { ...cleanReport.severityBreakdown, high: 1 }
  }), 1);
});

test("dependency gate fails for critical advisories", () => {
  assert.equal(dependencyAuditExitCode({
    ...cleanReport,
    severityBreakdown: { ...cleanReport.severityBreakdown, critical: 1 }
  }), 1);
});

test("dependency gate blocks when the audit tool is unavailable", () => {
  assert.equal(dependencyAuditExitCode({ status: "TOOL_UNAVAILABLE", findings: [] }), 2);
});

test("dependency gate blocks malformed severity output", () => {
  assert.equal(dependencyAuditExitCode({
    status: "COMPLETED",
    severityBreakdown: { high: "unknown", critical: 0 }
  }), 2);
});
