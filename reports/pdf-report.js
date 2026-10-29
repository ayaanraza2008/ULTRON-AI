const CP1252 = new Map([
  [0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],
  [0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],
  [0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],
  [0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],
  [0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],
  [0x017e,0x9e],[0x0178,0x9f]
]);
const MAX_CHARS = 40000;
const MAX_SECTIONS = 40;
const PAGE_WIDTH = 612, PAGE_HEIGHT = 792, LEFT = 54, TOP = 738, BOTTOM = 48;

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").slice(0, max) : "";
}
function encodeWinAnsi(value) {
  const bytes = [];
  let replacements = 0;
  for (const char of value) {
    const cp = char.codePointAt(0);
    if (cp <= 0x7f || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (CP1252.has(cp)) bytes.push(CP1252.get(cp));
    else { bytes.push(0x3f); replacements++; }
  }
  return { hex: bytes.map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase(), replacements };
}
function wrap(value, width = 92) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) { lines.push(current); current = ""; }
      for (let i=0; i<word.length; i+=width) lines.push(word.slice(i, i+width));
    } else if (!current) current = word;
    else if (current.length + word.length + 1 <= width) current += " " + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}
function assemble(pages) {
  const eol = "\r\n";
  const objects = [];
  const add = text => objects.push(text);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = pages.map((_, i) => 5 + i * 2);
  add("<< /Type /Pages /Kids [" + pageIds.map(id => id + " 0 R").join(" ") + "] /Count " + pages.length + " >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((content, i) => {
    const pageId = 5 + i * 2, streamId = pageId + 1;
    add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_WIDTH + " " + PAGE_HEIGHT + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + streamId + " 0 R >>");
    add("<< /Length " + Buffer.byteLength(content, "ascii") + " >>" + eol + "stream" + eol + content + eol + "endstream");
  });
  let output = "%PDF-1.4" + eol + "%\xE2\xE3\xCF\xD3" + eol;
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += (i + 1) + " 0 obj" + eol + object + eol + "endobj" + eol;
  });
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += "xref" + eol + "0 " + (objects.length + 1) + eol + "0000000000 65535 f " + eol;
  for (let i = 1; i < offsets.length; i++) output += String(offsets[i]).padStart(10, "0") + " 00000 n " + eol;
  output += "trailer" + eol + "<< /Size " + (objects.length + 1) + " /Root 1 0 R >>" + eol + "startxref" + eol + xrefOffset + eol + "%%EOF" + eol;
  return Buffer.from(output, "latin1");
}

export function generateReportPdf(input = {}) {
  const title = cleanText(input.title || "ULTRON Report", 120).trim() || "ULTRON Report";
  const content = cleanText(input.content || "", MAX_CHARS + 1);
  const inputSections = Array.isArray(input.sections) ? input.sections : [];
  if (inputSections.length > MAX_SECTIONS) return { ok:false, code:"REPORT_TOO_MANY_SECTIONS", message:"A report can contain at most " + MAX_SECTIONS + " sections." };
  const sections = inputSections.map((item, i) => ({
    heading: cleanText(item?.heading || "Section " + (i+1), 160).trim(),
    content: cleanText(item?.content || "", 10000)
  }));
  if (!content.trim() && !sections.some(x => x.content.trim())) return { ok:false, code:"REPORT_CONTENT_REQUIRED", message:"Provide report content or at least one non-empty section." };
  const total = title.length + content.length + sections.reduce((n,x)=>n+x.heading.length+x.content.length,0);
  if (total > MAX_CHARS) return { ok:false, code:"REPORT_TOO_LARGE", message:"Report text must be " + MAX_CHARS + " characters or fewer." };

  const hasUnsupportedCharacters = [title, content, ...sections.flatMap(section => [section.heading, section.content])].some(value => encodeWinAnsi(value).replacements > 0);
  const pages = [];
  let operators = [], y = TOP, replacements = 0;
  function finishPage() {
    const label = encodeWinAnsi("Page " + (pages.length+1)).hex;
    operators.push("BT /F1 8 Tf 526 28 Td <" + label + "> Tj ET");
    pages.push(operators.join("\n"));
    operators = [];
    y = TOP;
  }
  function emit(line, style = {}) {
    const encoded = encodeWinAnsi(line);
    replacements += encoded.replacements;
    const size = style.size || 10;
    operators.push("BT /" + (style.bold ? "F2" : "F1") + " " + size + " Tf " + LEFT + " " + y + " Td <" + encoded.hex + "> Tj ET");
    y -= style.spacing || (size >= 14 ? 24 : size >= 12 ? 18 : 13);
    if (y < BOTTOM) finishPage();
  }
  function emitBlock(value, style = {}) {
    for (const line of String(value).split("\n")) {
      if (!line.trim()) { y -= 6; if (y < BOTTOM) finishPage(); continue; }
      for (const linePart of wrap(line)) emit(linePart, style);
    }
  }
  emitBlock(title, { bold:true, size:18, spacing:24 });
  emitBlock("Generated by ULTRON AI - " + new Date().toISOString(), { size:8, spacing:19 });
  if (hasUnsupportedCharacters) emitBlock("Note: Some unsupported script characters are displayed as \"?\" by the built-in PDF font.", { size:8, spacing:14 });
  emitBlock("", { spacing:8 });
  if (content.trim()) emitBlock(content);
  for (const section of sections) {
    y -= 5;
    if (y < BOTTOM) finishPage();
    emitBlock(section.heading, { bold:true, size:13, spacing:18 });
    if (section.content.trim()) emitBlock(section.content);
  }
  if (operators.length || !pages.length) finishPage();
  return {
    ok:true, pdf:assemble(pages), filename:"ultron-report.pdf", pages:pages.length,
    characters:total, unsupportedCharacterCount:replacements,
    unicodeSupport:"WinAnsi is supported; unsupported scripts are replaced with '?'. Report content is not stored."
  };
}
