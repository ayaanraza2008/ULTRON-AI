import test from "node:test";
import assert from "node:assert/strict";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { generateReportPdf } from "../reports/pdf-report.js";

test("PDF report generator produces a readable, multi-section PDF without persisting content", async () => {
  const report = await generateReportPdf({
    title: "ULTRON Project Review",
    sections: [
      { heading: "Summary", content: "Source-level verification passed. Live service checks remain open." },
      { heading: "Next steps", content: "Verify the provider, database isolation, background worker and physical device integrations." }
    ]
  });
  assert.equal(report.ok, true);
  assert.match(report.pdf.subarray(0, 8).toString("ascii"), /^%PDF-1\.\d$/);
  assert.equal(report.filename, "ultron-report.pdf");
  assert.equal(report.pages, 1);
  const parsed = await pdfParse(report.pdf, { version: "v2.0.550" });
  assert.match(parsed.text, /ULTRON Project Review/);
  assert.match(parsed.text, /Source-level verification passed/);
  assert.match(parsed.text, /physical device integrations/);
  assert.ok(report.pdf.length > 500);
});

test("PDF report generator paginates long text and retains the final section", async () => {
  const content = Array.from({ length: 300 }, (_, i) => "Paragraph " + i + ": the result remains explicitly unverified until the target integration is checked.").join("\n");
  const report = await generateReportPdf({ title: "Long Verification Report", content });
  assert.equal(report.ok, true);
  assert.ok(report.pages > 5);
  const parsed = await pdfParse(report.pdf, { version: "v2.0.550" });
  assert.match(parsed.text, /Paragraph 299/);
  assert.match(parsed.text, /Long Verification Report/);
});

test("PDF report generator marks glyph substitutions for unsupported scripts", async () => {
  const report = await generateReportPdf({ title: "Language Check", content: "Hindi sample: नमस्ते. English sample: hello." });
  assert.equal(report.ok, true);
  assert.ok(report.unsupportedCharacterCount > 0);
  const parsed = await pdfParse(report.pdf, { version: "v2.0.550" });
  assert.match(parsed.text, /unsupported script characters/);
});

test("PDF report generator rejects empty, oversized, and over-section-limit input", async () => {
  assert.equal((await generateReportPdf({ title: "Empty" })).code, "REPORT_CONTENT_REQUIRED");
  assert.equal((await generateReportPdf({ content: "x".repeat(40001) })).code, "REPORT_TOO_LARGE");
  assert.equal((await generateReportPdf({ content: "ok", sections: Array.from({ length: 41 }, () => ({ heading: "h", content: "c" })) })).code, "REPORT_TOO_MANY_SECTIONS");
});
