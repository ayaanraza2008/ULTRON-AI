import test from "node:test";
import assert from "node:assert/strict";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { generateReportPdf } from "../reports/pdf-report.js";

function assertPdfCrossReference(pdf) {
  const raw = pdf.toString("ascii");
  const match = /startxref\r?\n(\d+)\r?\n%%EOF/.exec(raw);
  assert.ok(match, "PDF must include startxref and EOF markers");
  const xrefOffset = Number(match[1]);
  assert.equal(raw.slice(xrefOffset, xrefOffset + 4), "xref", "startxref must point to xref table");
  const xref = raw.slice(xrefOffset);
  const size = /^xref\r?\n0 (\d+)\r?\n/.exec(xref);
  assert.ok(size, "xref table must declare its object count");
  const count = Number(size[1]);
  const entries = xref.split(/\r?\n/).slice(3, 3 + count - 1);
  assert.equal(entries.length, count - 1);
  for (let objectId = 1; objectId < count; objectId++) {
    const entry = entries[objectId - 1];
    assert.match(entry || "", /^\d{10} 00000 n$/, "xref entry must be a ten-digit in-use offset with no extra padding");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    assert.equal(Buffer.byteLength(entry + eol, "latin1"), 20, "every xref row must be exactly 20 bytes");
    const position = Number(entry.slice(0, 10));
    const objectHeader = String(objectId) + " 0 obj\r\n";
    assert.equal(raw.slice(position, position + objectHeader.length), objectHeader, "xref offset must point to the matching object header");
  }
}

test("PDF report generator produces a readable, multi-section PDF without persisting content", async () => {
  const report = generateReportPdf({
    title: "ULTRON Project Review",
    sections: [
      { heading: "Summary", content: "Source-level verification passed. Live service checks remain open." },
      { heading: "Next steps", content: "Verify the provider, database isolation, background worker and physical device integrations." }
    ]
  });
  assert.equal(report.ok, true);
  assert.equal(report.pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.equal(report.filename, "ultron-report.pdf");
  assert.equal(report.pages, 1);
  assertPdfCrossReference(report.pdf);
  const parsed = await pdfParse(report.pdf);
  assert.match(parsed.text, /ULTRON Project Review/);
  assert.match(parsed.text, /Source-level verification passed/);
  assert.match(parsed.text, /physical device integrations/);
  assert.ok(report.pdf.length > 500);
});

test("PDF report generator paginates long text and retains the final section", async () => {
  const content = Array.from({ length: 300 }, (_, i) => "Paragraph " + i + ": the result remains explicitly unverified until the target integration is checked.").join("\n");
  const report = generateReportPdf({ title: "Long Verification Report", content });
  assert.equal(report.ok, true);
  assert.ok(report.pages > 5);
  const parsed = await pdfParse(report.pdf);
  assert.match(parsed.text, /Paragraph 299/);
  assert.match(parsed.text, /Long Verification Report/);
});

test("PDF report generator marks glyph substitutions for unsupported scripts", async () => {
  const report = generateReportPdf({ title: "Language Check", content: "Hindi sample: नमस्ते. English sample: hello." });
  assert.equal(report.ok, true);
  assert.ok(report.unsupportedCharacterCount > 0);
  const parsed = await pdfParse(report.pdf);
  assert.match(parsed.text, /unsupported script characters/);
});

test("PDF report generator rejects empty, oversized, and over-section-limit input", () => {
  assert.equal(generateReportPdf({ title: "Empty" }).code, "REPORT_CONTENT_REQUIRED");
  assert.equal(generateReportPdf({ content: "x".repeat(40001) }).code, "REPORT_TOO_LARGE");
  assert.equal(generateReportPdf({ content: "ok", sections: Array.from({ length: 41 }, () => ({ heading: "h", content: "c" })) }).code, "REPORT_TOO_MANY_SECTIONS");
});
