import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { generatePresentationPptx } from "../reports/presentation-pptx.js";

test("presentation generator creates an editable OOXML deck with the requested content", async () => {
  const result = await generatePresentationPptx({
    title: "ULTRON Editable Deck",
    sections: [
      { heading: "Verified changes", content: "The API now exports a bounded editable PowerPoint file." },
      { heading: "Remaining work", content: "Live provider, database, browser and device tests are still required." }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.filename, "ultron-presentation.pptx");
  assert.equal(result.slides, 3);
  assert.ok(result.pptx.length > 1000);
  assert.equal(result.pptx.subarray(0, 2).toString("ascii"), "PK");
  const zip = await JSZip.loadAsync(result.pptx);
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("ppt/presentation.xml"));
  assert.ok(zip.file("ppt/slides/slide1.xml"));
  assert.ok(zip.file("ppt/slides/slide2.xml"));
  assert.ok(zip.file("ppt/slides/slide3.xml"));
  const cover = await zip.file("ppt/slides/slide1.xml").async("string");
  const body = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.match(cover, /ULTRON Editable Deck/);
  assert.match(body, /Verified changes/);
  assert.match(body, /bounded editable PowerPoint/);
});

test("presentation generator paginates long text without discarding trailing content", async () => {
  const content = Array.from({ length: 90 }, (_, i) =>
    "Paragraph " + i + ": verify the result against real upstream services and keep external side effects approval-gated."
  ).join("\n");
  const result = await generatePresentationPptx({ title: "Long Deck", content });
  assert.equal(result.ok, true);
  assert.ok(result.slides > 2);
  const zip = await JSZip.loadAsync(result.pptx);
  const allSlides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(allSlides.length, result.slides);
  const xml = await Promise.all(allSlides.map(name => zip.file(name).async("string")));
  assert.ok(xml.some(slide => slide.includes("Paragraph 89")));
});

test("presentation generator rejects empty, excessive, and oversized input", async () => {
  assert.equal((await generatePresentationPptx({ title: "Empty" })).code, "PPTX_CONTENT_REQUIRED");
  assert.equal((await generatePresentationPptx({
    content: "ok",
    sections: Array.from({ length: 25 }, () => ({ heading: "Heading", content: "Body" }))
  })).code, "PPTX_TOO_MANY_SECTIONS");
  assert.equal((await generatePresentationPptx({ content: "x".repeat(30001) })).code, "PPTX_TOO_LARGE");
});
