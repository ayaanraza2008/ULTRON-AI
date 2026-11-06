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


test("valid DOCX archives pass ZIP limits and return document paragraph text", async () => {
  const docxBase64 = "UEsDBBQAAAAIAOChZl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA4KFmXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIAOChZl2G2HZ0sgAAAPQAAAARAAAAd29yZC9kb2N1bWVudC54bWxFjs1uwjAMgF8lyp2mcEBT1ZYbJ7RNEzxASAxUauzKNiu8/ZJOgstn+e+z290jjeYXWAbCzq6r2hrAQHHAa2dPx/3qwxpRj9GPhNDZJ4jd9e3cRAr3BKgmC1CaubM31alxTsINkpeKJsDcuxAnrznlq5uJ48QUQCT70+g2db11yQ9oi/JM8VniVMAF2p8Ox5+vT/O6Bg9lHzR/axREq9aVqUJeuOwKBP1mtxT+pe79cP8HUEsBAhQDFAAAAAgA4KFmXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADgoWZdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JelsvLnJelsUEsBAhQDFAAAAAgA4KFmXYbYdnSyAAAA9AAAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA0AIAAAAA";
  const result = await extractDocumentText({
    filename: "valid.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: Buffer.from(docxBase64, "base64")
  });
  assert.match(result.text, /ULTRON document extraction test/);
});
