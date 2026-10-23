import test from "node:test";
import assert from "node:assert/strict";
import { verifyAutonomousOutput } from "../autonomous-quality-gate.js";

test("quality gate passes a substantive report with traceable public research citations", () => {
  const url = "https://example.com/source";
  const result = verifyAutonomousOutput({
    research: { sources: [{ url }] },
    report: { answer: "A sufficiently substantive report with a conclusion, evidence and next steps. Source: " + url }
  });
  assert.equal(result.state, "passed");
  assert.ok(result.checks.every(check => check.passed));
});

test("quality gate rejects unsafe or malformed source URLs even when they appear in the report", () => {
  const unsafe = "javascript:alert(1)";
  const result = verifyAutonomousOutput({
    research: { sources: [{ url: unsafe }, { url: "https://user:pass@example.com/private" }, { url: "not a url" }] },
    report: { answer: "A sufficiently substantive report with a conclusion, evidence and next steps. Source: " + unsafe }
  });
  assert.equal(result.state, "needs_review");
  assert.equal(result.checks.find(check => check.id === "sources_available").passed, false);
  assert.equal(result.checks.find(check => check.id === "citations_traceable").passed, false);
});

test("quality gate flags missing research, short output and missing citations without pretending facts were verified", () => {
  const result = verifyAutonomousOutput({ report: { answer: "Done." } });
  assert.equal(result.state, "needs_review");
  assert.equal(result.checks.find(check => check.id === "research_available").passed, false);
  assert.match(result.warning, /not factual correctness/);
});
