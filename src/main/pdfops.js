// PDF operations that aren't format conversion (their own tab in the UI).
// Pure JS via pdf-lib — fully offline.

const fs = require("node:fs");
const { PDFDocument } = require("pdf-lib");

// Merge PDFs in the given order into one file.
async function mergePdfs(inputPaths, outputPath, onProgress) {
  const out = await PDFDocument.create();
  for (let i = 0; i < inputPaths.length; i += 1) {
    const bytes = fs.readFileSync(inputPaths[i]);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
    onProgress?.((i + 1) / inputPaths.length);
  }
  const merged = await out.save();
  fs.writeFileSync(outputPath, merged);
  return { outputPath, pages: out.getPageCount() };
}

// Page count for a single PDF (used to show counts in the merge list).
async function pageCount(inputPath) {
  try {
    const src = await PDFDocument.load(fs.readFileSync(inputPath), { ignoreEncryption: true });
    return src.getPageCount();
  } catch {
    return null;
  }
}

module.exports = { mergePdfs, pageCount };
