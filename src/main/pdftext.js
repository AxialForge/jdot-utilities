// PDF -> plain text via pdfjs text extraction. Pure JS (no canvas), runs under
// plain Node, so it is covered by `npm test`.
//
// This extracts the text layer. A scanned PDF (pages that are just images) has no
// text layer, so the result would be empty — that case is reported as a warning
// rather than silently writing an empty file, since it really needs OCR.

const fs = require("node:fs");
const path = require("node:path");
const { openDocument } = require("./pdfjs");

// Reconstruct line breaks from pdfjs text items. Each item carries the text run
// and a `hasEOL` flag that pdfjs sets at end-of-line, which is a good-enough proxy
// for the original line structure without full geometric layout analysis.
function itemsToText(items) {
  let out = "";
  for (const it of items) {
    if (typeof it.str === "string") out += it.str;
    if (it.hasEOL) out += "\n";
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * @param {string} inputPath   source PDF
 * @param {string} outputPath  .txt to write
 * @param {object} options     { pageBreaks: boolean } — form-feed between pages
 */
async function pdfToText(inputPath, outputPath, options = {}, onProgress, opts = {}) {
  const bytes = new Uint8Array(await fs.promises.readFile(inputPath));
  let pdf;
  try {
    pdf = await openDocument(bytes);
  } catch (err) {
    throw new Error(`${path.basename(inputPath)}: not a readable PDF (${err.message})`);
  }

  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    if (opts.signal?.aborted) throw new Error("Cancelled");
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    pages.push(itemsToText(tc.items));
    onProgress?.(n / pdf.numPages);
  }

  const sep = options.pageBreaks ? "\n\f\n" : "\n\n";
  const text = pages.join(sep).trim();
  await fs.promises.writeFile(outputPath, text ? text + "\n" : "", "utf8");

  const warnings = [];
  if (!text) {
    warnings.push("No text layer found — this looks like a scanned PDF and would need OCR.");
  }
  return { outputPath, pages: pdf.numPages, empty: !text, warnings };
}

module.exports = { pdfToText, itemsToText };
