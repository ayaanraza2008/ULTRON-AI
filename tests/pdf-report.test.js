import test from "node:test";
import assert from "node:assert/strict";
import { generateReportPdf } from "../reports/pdf-report.js";

function assertPdfStructure(pdf) {
  assert.ok(Buffer.isBuffer(pdf));
  assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-1\.\d/);
  const raw = pdf.toString("latin1");
  const start = /startxref\r?\n(\d+)\r?\n%%EOF/.exec(raw);
  assert.ok(start, "PDF must end with startxref and EOF");
  const xrefOffset = Number(start[1]);
  assert.equal(raw.slice(xrefOffset, xrefOffset + 4), "xref", "startxref must point to xref");
  const xref = raw.slice(xrefOffset);
  const header = /^xref\r?\n0 (\d+)\r?\n/.exec(xref);
  assert.ok(header, "xref must declare its object count");
  const count = Number(header[1]);
  const eol = xref.includes("\r\n") ? "\r\n" : "\n";
  const rows = xref.split(/\r?\n/);
  assert.ok(rows.length >= count + 2, "xref must contain one entry per object");
  for (let id = 1; id < count; id++) {
    const row = rows[id + 2];
    assert.match(row || "", /^\d{10} 00000 n ?$/, "xref entry must be a fixed-width in-use entry");
    assert.equal(Buffer.byteLength(row + eol, "latin1"), 20, "xref rows must be exactly 20 bytes");
    const offset = Number(row.slice(0, 10));
    assert.equal(raw.slice(offset, offset + String(id).length + 7), String(id) + " 0 obj", "xref offset must point to its object");
  }
}

test("PDF report generator produces a readable, multi-section PDF without persisting content", async () => {
  const report = await generateReportPdf({
    title: "ULTRON Project Review",
    sections: [
      { heading: "Summary", content: "Source-level verification passed. Live service checks remain open." },
      { heading: "Next steps", content: "Verify the provider, database isolation, background worker and physical device integrations." }
    ]
  });
  assert.equal(report.ok, true);
  assertPdfStructure(report.pdf);
  assert.equal(report.filename, "ultron-report.pdf");
  assert.equal(report.pages, 1);
  assert.ok(report.pdf.length > 500);
});

test("PDF report generator paginates long text and retains the final section", async () => {
  const content = Array.from({ length: 300 }, (_, i) => "Paragraph " + i + ": the result remains explicitly unverified until the target integration is checked.").join("\n");
  const report = await generateReportPdf({ title: "Long Verification Report", content });
  assert.equal(report.ok, true);
  assert.ok(report.pages > 5);
  assertPdfStructure(report.pdf);
});

test("PDF report generator marks glyph substitutions for unsupported scripts", async () => {
  const report = await generateReportPdf({ title: "Language Check", content: "Hindi sample: नमस्ते. English sample: hello." });
  assert.equal(report.ok, true);
  assert.ok(report.unsupportedCharacterCount > 0);
  assertPdfStructure(report.pdf);
});

test("PDF report generator rejects empty, oversized, and over-section-limit input", async () => {
  assert.equal((await generateReportPdf({ title: "Empty" })).code, "REPORT_CONTENT_REQUIRED");
  assert.equal((await generateReportPdf({ content: "x".repeat(40001) })).code, "REPORT_TOO_LARGE");
  assert.equal((await generateReportPdf({ content: "ok", sections: Array.from({ length: 41 }, () => ({ heading: "h", content: "c" })) })).code, "REPORT_TOO_MANY_SECTIONS");
});
