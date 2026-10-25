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


test("quality gate excludes localhost, private IPs and cloud metadata URLs from citations", () => {
  const unsafeUrls = [
    "http://127.0.0.1/internal",
    "http://192.168.1.10/admin",
    "http://169.254.169.254/latest/meta-data",
    "https://printer.local/status",
    "http://[::1]/private",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://203.0.113.10/documentation-only",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/tunneled-loopback",
    "http://[2002:7f00:1::]/6to4-loopback",
    "http://[fe80::1]/link-local",
    "http://[ff02::1]/multicast",
    "http://[::192.168.1.10]/ipv4-compatible",
    "http://192.88.99.10/6to4-relay-anycast",
    "http://[2001:2::1]/benchmarking",
    "http://[2001:10::1]/deprecated-orchid",
    "http://[3fff::1]/documentation-prefix"
  ];
  const result = verifyAutonomousOutput({
    research: { sources: unsafeUrls.map(url => ({ url })) },
    report: { answer: "A sufficiently substantive report with a conclusion, evidence and next steps. " + unsafeUrls.join(" ") }
  });
  assert.equal(result.checks.find(check => check.id === "sources_available").passed, false);
  assert.equal(result.checks.find(check => check.id === "citations_traceable").passed, false);
});

test("quality gate rejects hex-encoded IPv4-mapped private and loopback IPv6 URLs", () => {
  const unsafeUrls = [
    "http://[::ffff:7f00:1]/private",
    "http://[::ffff:a00:1]/private",
    "http://[::ffff:a9fe:a9fe]/metadata",
    "http://[::ffff:c0a8:101]/admin"
  ];
  const result = verifyAutonomousOutput({
    research: { sources: unsafeUrls.map(url => ({ url })) },
    report: { answer: "A sufficiently substantive report with a conclusion, evidence and next steps. " + unsafeUrls.join(" ") }
  });
  assert.equal(result.checks.find(check => check.id === "sources_available").passed, false);
  assert.equal(result.checks.find(check => check.id === "citations_traceable").passed, false);
});
