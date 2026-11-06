import test from "node:test";
import assert from "node:assert/strict";
import { extractDocumentText, selectRelevantDocumentChunks } from "../document-context.js";

test("text document extraction validates UTF-8 and normalizes paragraphs", async () => {
  const result = await extractDocumentText({
    filename: "lecture-notes.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("ULTRON notes\r\n\r\nEnergy   eigenvalues in a one-dimensional box.\r\n")
  });
  assert.match(result.text, /ULTRON notes\n\nEnergy eigenvalues/);
});

test("HTML extraction removes scripts and styles before returning readable text", async () => {
  const result = await extractDocumentText({
    filename: "study.html",
    mimeType: "text/html",
    bytes: Buffer.from("<html><head><title>Hidden</title><style>.x{}</style></head><body><h1>Physics</h1><script>steal secrets()</script><p>Energy &amp; work</p></body></html>")
  });
  assert.match(result.text, /Physics/);
  assert.match(result.text, /Energy & work/);
  assert.doesNotMatch(result.text, /steal secrets|Hidden/);
});

test("unsupported binary or malformed PDF data is rejected", async () => {
  await assert.rejects(
    extractDocumentText({ filename: "broken.pdf", mimeType: "application/pdf", bytes: Buffer.from("not-pdf") }),
    error => error.code === "DOCUMENT_INVALID_PDF" && error.status === 422
  );
  await assert.rejects(
    extractDocumentText({ filename: "binary.txt", mimeType: "text/plain", bytes: Buffer.from([0x61, 0x00, 0x62]) }),
    error => error.code === "DOCUMENT_INVALID_TEXT" && error.status === 422
  );
  await assert.rejects(
    extractDocumentText({ filename: "broken.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: Buffer.from("PK\\x03\\x04") }),
    error => error.code === "DOCUMENT_INVALID_DOCX" && error.status === 422
  );
});

test("document retrieval ranks query-relevant excerpts and bounds context size", () => {
  const filler = "General background information about science and study methods. ".repeat(65);
  const documents = [{
    filename: "physics-notes.txt",
    text: filler + "\nTHERMAL CONDUCTIVITY and thermal resistance determine heat transfer through this material.\n" + filler
  }];
  const selected = selectRelevantDocumentChunks(documents, "Explain thermal conductivity and resistance", {
    maxChunks: 3,
    maxTotalChars: 3600,
    maxChunkChars: 1200
  });
  assert.ok(selected.length > 0);
  assert.ok(selected.some(item => /thermal conductivity/i.test(item.content)));
  assert.ok(selected.every(item => item.filename === "physics-notes.txt"));
  assert.ok(selected.reduce((sum, item) => sum + item.content.length, 0) <= 3600);
});
