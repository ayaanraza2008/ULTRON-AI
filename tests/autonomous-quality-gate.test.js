import test from "node:test";
import assert from "node:assert/strict";
import { verifyAutonomousOutput } from "../autonomous-quality-gate.js";

test("quality gate passes a substantive report with traceable public research citations", () => {
  const url = "https://example.com/source";
  const result = verifyAutonomousOutput({
    research: { sources: [{ url }] },
    report: { answer: "# Summary\nA sufficiently substantive summary.\n\n# Deliverable\nA conclusion and evidence. Source: " + url + "\n\n# Next Steps\nValidate the result.\n\n# Blockers\nNo known blockers.\n\n# Verification Criteria\nConfirm the source and outcome." }
  });
  assert.equal(result.state, "passed");
  assert.ok(result.checks.every(check => check.passed));
});

test("quality gate rejects unsafe or malformed source URLs even when they appear in the report", () => {
  const unsafe = "javascript:alert(1)";
  const result = verifyAutonomousOutput({
    research: { sources: [{ url: unsafe }, { url: "https://user:pass@example.com/private" }, { url: "not a url" }] },
    report: { answer: "# Summary\nA sufficiently substantive summary.\n\n# Deliverable\nA conclusion and evidence. Source: " + unsafe + "\n\n# Next Steps\nValidate the result.\n\n# Blockers\nNo known blockers.\n\n# Verification Criteria\nConfirm the source and outcome." }
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
    report: { answer: "# Summary\nA sufficiently substantive summary.\n# Deliverable\nEvidence and result.\n# Next Steps\nValidate.\n# Blockers\nNone known.\n# Verification Criteria\nConfirm sources. " + unsafeUrls.join(" ") }
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
    report: { answer: "# Summary\nA sufficiently substantive summary.\n# Deliverable\nEvidence and result.\n# Next Steps\nValidate.\n# Blockers\nNone known.\n# Verification Criteria\nConfirm sources. " + unsafeUrls.join(" ") }
  });
  assert.equal(result.checks.find(check => check.id === "sources_available").passed, false);
  assert.equal(result.checks.find(check => check.id === "citations_traceable").passed, false);
});

test("quality gate requires an actionable, reviewable report structure", () => {
  const result = verifyAutonomousOutput({
    research: { sources: [{ url: "https://example.com/source" }] },
    report: { answer: "A long but unstructured response that includes a source https://example.com/source and enough characters to look substantive, but lacks named sections." }
  });
  assert.equal(result.checks.find(check => check.id === "deliverable_structure").passed, false);
  assert.match(result.checks.find(check => check.id === "deliverable_structure").detail, /Missing required sections/);
});


test("quality gate rejects reports with headings but no useful section content", () => {
  const url = "https://example.com/source";
  const answer = [
    "padding content to exceed the minimum length and hide missing useful output " + url,
    "# Summary",
    "# Deliverable",
    "# Next Steps",
    "# Blockers",
    "# Verification Criteria"
  ].join("\\n");
  const result = verifyAutonomousOutput({ research: { sources: [{ url }] }, report: { answer } });
  const structure = result.checks.find(check => check.id === "deliverable_structure");
  assert.equal(structure.passed, false);
  assert.match(structure.detail, /Empty or too-short sections/);
});

test("quality gate rejects required report sections in the wrong order", () => {
  const url = "https://example.com/source";
  const answer = [
    "# Summary\\nA useful summary of the findings.",
    "# Next Steps\\nValidate the reported findings.",
    "# Deliverable\\nThe report includes findings and a traceable source " + url,
    "# Blockers\\nNo known blockers at present.",
    "# Verification Criteria\\nConfirm each finding against the source."
  ].join("\\n\\n");
  const result = verifyAutonomousOutput({ research: { sources: [{ url }] }, report: { answer } });
  const structure = result.checks.find(check => check.id === "deliverable_structure");
  assert.equal(structure.passed, false);
  assert.match(structure.detail, /not in the requested order/);
});
