// Shared pdfjs-dist loader. pdfjs v6 is ESM-only, so it is pulled in with a
// dynamic import() from this CommonJS module and cached. The legacy build is the
// one that runs under Node (and Electron's main process) without a DOM.
//
// standardFontDataUrl / cMapUrl point pdfjs at the font + CJK character-map data
// that ship inside the package, so text extraction and rendering are correct for
// PDFs that rely on the 14 standard fonts or CJK encodings — without them pdfjs
// warns and can drop glyphs.

const path = require("node:path");

const PKG_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));

// pdfjs requires these "urls" to end in a forward slash and does `baseUrl + name`
// then reads via fs — forward slashes are valid Windows paths for fs, and pdfjs
// rejects a trailing backslash outright. So normalize separators, not path.sep.
const asDirUrl = (p) => p.replace(/\\/g, "/").replace(/\/?$/, "/");
const STANDARD_FONTS = asDirUrl(path.join(PKG_DIR, "standard_fonts"));
const CMAPS = asDirUrl(path.join(PKG_DIR, "cmaps"));

let cached = null;
async function getPdfjs() {
  if (!cached) cached = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return cached;
}

/**
 * Open a PDF with pdfjs, wired up with the font/cmap data and safe defaults.
 * Returns the pdfjs document (has .numPages, .getPage(n)).
 */
async function openDocument(bytes) {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    // The input is a user file; never let pdfjs eval embedded content.
    isEvalSupported: false,
  }).promise;
}

module.exports = { getPdfjs, openDocument, STANDARD_FONTS, CMAPS };
