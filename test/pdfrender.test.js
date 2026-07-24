// Pure-logic tests for pdfrender helpers that do NOT need Electron/Chromium.
// The rendering itself (docx -> pdf via docx-preview, grayscale filter) needs a
// browser and is covered by test/electron-pdf.js.
//
// parseDocxPageSize decides the PDF page geometry for Word -> PDF, so a wrong
// value silently clips content or paginates differently from Word — worth
// pinning even though the render can't run here.

const test = require("node:test");
const assert = require("node:assert");

// Safe to require under plain node: pdfrender only reaches for electron/jszip
// inside its render functions, never at module load.
const { parseDocxPageSize } = require("../src/main/pdfrender");

test("parseDocxPageSize reads Letter geometry from pgSz twips", () => {
  const xml = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  assert.deepStrictEqual(parseDocxPageSize(xml), { widthIn: 8.5, heightIn: 11 });
});

test("parseDocxPageSize reads A4 geometry", () => {
  // A4 is 11906 x 16838 twips.
  const { widthIn, heightIn } = parseDocxPageSize('<w:pgSz w:w="11906" w:h="16838"/>');
  assert.ok(Math.abs(widthIn - 8.27) < 0.01, `width ${widthIn}`);
  assert.ok(Math.abs(heightIn - 11.69) < 0.01, `height ${heightIn}`);
});

test("parseDocxPageSize honours physical dimensions for landscape (w > h)", () => {
  // Word bakes orientation into w:w / w:h, so a landscape Letter is 15840 x 12240.
  const { widthIn, heightIn } = parseDocxPageSize(
    '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
  );
  assert.deepStrictEqual({ widthIn, heightIn }, { widthIn: 11, heightIn: 8.5 });
});

test("parseDocxPageSize falls back to Letter when pgSz is missing or malformed", () => {
  const letter = { widthIn: 8.5, heightIn: 11 };
  assert.deepStrictEqual(parseDocxPageSize(""), letter);
  assert.deepStrictEqual(parseDocxPageSize("<w:body/>"), letter);
  assert.deepStrictEqual(parseDocxPageSize('<w:pgSz w:w="0" w:h="0"/>'), letter);
  assert.deepStrictEqual(parseDocxPageSize(null), letter);
});
