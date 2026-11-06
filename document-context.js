import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const MAX_EXTRACTED_CHARS = 36_000;
const MAX_PDF_PAGES = 15;

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number(code);
      return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16);
      return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
    });
}

function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function extractHtmlText(value) {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}


function validateDocxArchive(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  let endRecord = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) return false;

  const diskNumber = bytes.readUInt16LE(endRecord + 4);
  const centralDisk = bytes.readUInt16LE(endRecord + 6);
  const entriesOnDisk = bytes.readUInt16LE(endRecord + 8);
  const entryCount = bytes.readUInt16LE(endRecord + 10);
  const centralSize = bytes.readUInt32LE(endRecord + 12);
  const centralOffset = bytes.readUInt32LE(endRecord + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount ||
      entryCount < 1 || entryCount > 256 ||
      centralOffset + centralSize > endRecord ||
      centralOffset + centralSize > bytes.length) return false;

  let cursor = centralOffset;
  let totalUncompressed = 0;
  let hasDocumentXml = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || bytes.readUInt32LE(cursor) !== 0x02014b50) return false;
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > centralOffset + centralSize ||
        (flags & 1) !== 0 ||
        ![0, 8].includes(method) ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        compressedSize > bytes.length ||
        uncompressedSize > 12_582_912) return false;

    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (!name || name.startsWith("/") || name.includes("../") || name.includes("..\\\\") || name.includes("\\\\..")) return false;
    if (name === "word/document.xml") hasDocumentXml = true;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > 20_971_520) return false;
    cursor = next;
  }
  return cursor === centralOffset + centralSize && hasDocumentXml;
}

export async function extractDocumentText({ filename, mimeType, bytes }) {
  if (typeof filename !== "string" || !Buffer.isBuffer(bytes) || bytes.length < 1) {
    throw Object.assign(new Error("Document contents are invalid."), { code: "DOCUMENT_INVALID", status: 400 });
  }

  const extension = filename.toLowerCase().split(".").pop();
  let text = "";
  let metadata = {};

  if (extension === "pdf" || mimeType === "application/pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw Object.assign(new Error("PDF signature is invalid."), { code: "DOCUMENT_INVALID_PDF", status: 422 });
    }
    try {
      const parsed = await pdfParse(bytes, { max: MAX_PDF_PAGES });
      text = parsed?.text || "";
      metadata = {
        pages: Number.isFinite(parsed?.numpages) ? parsed.numpages : null,
        pagesParsed: Number.isFinite(parsed?.numrender) ? parsed.numrender : null,
        pageLimit: MAX_PDF_PAGES
      };
    } catch {
      throw Object.assign(new Error("This PDF could not be read. It may be encrypted or malformed."), {
        code: "DOCUMENT_PDF_EXTRACTION_FAILED",
        status: 422
      });
    }
  } else if (extension === "docx" ||
             mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (bytes.subarray(0, 2).toString("hex") !== "504b" || !validateDocxArchive(bytes)) {
      throw Object.assign(new Error("DOCX archive is invalid, encrypted, or exceeds safe extraction limits."), {
        code: "DOCUMENT_INVALID_DOCX",
        status: 422
      });
    }
    try {
      const parsed = await mammoth.extractRawText({ buffer: bytes });
      text = parsed?.value || "";
    } catch {
      throw Object.assign(new Error("This DOCX document could not be read."), {
        code: "DOCUMENT_DOCX_EXTRACTION_FAILED",
        status: 422
      });
    }
  } else if (["html", "htm"].includes(extension) || mimeType === "text/html") {
    text = extractHtmlText(bytes.toString("utf8"));
  } else {
    if (bytes.includes(0)) {
      throw Object.assign(new Error("This text document contains binary data."), {
        code: "DOCUMENT_INVALID_TEXT",
        status: 422
      });
    }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw Object.assign(new Error("This document is not valid UTF-8 text."), {
        code: "DOCUMENT_INVALID_ENCODING",
        status: 422
      });
    }
  }

  const normalized = normalizeExtractedText(text);
  if (normalized.length < 2) {
    throw Object.assign(new Error("No readable text was found. Scanned PDFs and image-only documents need OCR, which is not enabled."), {
      code: "DOCUMENT_NO_TEXT",
      status: 422
    });
  }
  return { text: normalized, ...metadata };
}

function queryTerms(query) {
  const words = String(query || "").toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  const ignored = new Set([
    "the", "and", "for", "that", "this", "with", "from", "what", "when", "where",
    "which", "who", "why", "how", "please", "about", "into", "your", "you", "are",
    "was", "were", "can", "could", "would", "should", "tell", "explain", "summarize",
    "summary", "document", "file", "mein", "hai", "kya", "kaise", "mujhe", "isko",
    "iske", "ke", "ki", "ka", "aur", "batao", "samjhao"
  ]);
  return [...new Set(words.filter(word => !ignored.has(word)))].slice(0, 32);
}

function makeChunks(text, maxChars = 1800, overlap = 250) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf(". ", end),
        text.lastIndexOf("? ", end),
        text.lastIndexOf("! ", end)
      );
      if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary + 1;
    }
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ content, start });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function selectRelevantDocumentChunks(documents, query, {
  maxChunks = 8,
  maxTotalChars = 18_000,
  maxChunkChars = 2_000
} = {}) {
  const terms = queryTerms(query);
  const candidates = [];

  for (const document of Array.isArray(documents) ? documents : []) {
    const chunks = makeChunks(String(document.text || ""), Math.min(2_000, maxChunkChars), 250);
    for (const chunk of chunks) {
      const lower = chunk.content.toLocaleLowerCase();
      let score = 0;
      for (const term of terms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matches = lower.match(new RegExp(escaped, "gu"));
        if (matches) score += Math.min(matches.length, 4) * (term.length >= 7 ? 1.5 : 1);
      }
      candidates.push({
        filename: String(document.filename || "document").slice(0, 160),
        content: chunk.content.slice(0, maxChunkChars),
        start: chunk.start,
        score,
        documentOrder: Number.isFinite(document.order) ? document.order : 0
      });
    }
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    a.documentOrder - b.documentOrder ||
    a.start - b.start
  );

  const selected = [];
  let total = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxChunks || total >= maxTotalChars) break;
    const remaining = maxTotalChars - total;
    const content = candidate.content.slice(0, remaining);
    if (!content) continue;
    selected.push({ filename: candidate.filename, content, score: candidate.score });
    total += content.length;
  }
  return selected;
}
