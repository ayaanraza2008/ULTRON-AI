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
  const docxBase64 = "UEsDBBQAAAAIAOChZl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA4KFmXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIAOChZl2G2HZ0sgAAAPQAAAARAAAAd29yZC9kb2N1bWVudC54bWxFjs1uwjAMgF8lyp2mcEBT1ZYbJ7RNEzxASAxUauzKNiu8/ZJOgstn+e+z290jjeYXWAbCzq6r2hrAQHHAa2dPx/3qwxpRj9GPhNDZJ4jd9e3cRAr3BKgmC1CaubM31alxTsINkpeKJsDcuxAnrznlq5uJ48QUQCT70+g2db11yQ9oi/JM8VniVMAF2p8Ox5+vT/O6Bg9lHzR/axREq9aVqUJeuOwKBP1mtxT+pe79cP8HUEsBAhQDFAAAAAgA4KFmXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADgoWZdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADgoWZdhth2dLIAAAD0AAAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA0AIAAAAA";
  const result = await extractDocumentText({
    filename: "valid.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: Buffer.from(docxBase64, "base64")
  });
  assert.match(result.text, /ULTRON document extraction test/);
});


test("valid PDF files yield bounded searchable text", async () => {
  const pdfBase64 = "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCAzMDAgMzAwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYxMTA2MjAxNjM1KzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYxMTA2MjAxNjM1KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMjQKPj4Kc3RyZWFtCkdhcFFoMEU9RiwwVVxIM1RccE5ZVF5RS2s/dGM+SVAsO1cjVTFeMjNpaFBFTV8/Q1c0S0lTaTs6YlhYXjpeRzBDY2o5Ok4kMWRnaCNdT2NeOD9GOWg4a15rWmJnMDM5OE0pUkJkbzZVcDtAKFlPa3VIWEMhLVBDXDBFfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDM5MiAwMDAwMCBuIAowMDAwMDAwNDYwIDAwMDAwIG4gCjAwMDAwMDA3MjEgMDAwMDAgbiAKMDAwMDAwMDc4MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzwyYWM1Y2JjZDdkZWE4MjUyNWRmMzdlNWMxYzk3YWY1Zj48MmFjNWNiY2Q3ZGVhODI1MjVkZjM3ZTVjMWM5N2FmNWY+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjk5NAolJUVPRgo=";
  const result = await extractDocumentText({
    filename: "lecture.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from(pdfBase64, "base64")
  });
  assert.match(result.text, /ULTRON PDF extraction test/);
  assert.equal(result.pages, 1);
  assert.equal(result.pageLimit, 15);
});
