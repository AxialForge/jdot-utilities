// Ebooks — the Calibre-backed converter (Kindle MOBI/AZW3, FB2, comics, …).
//
// Calibre is a large app, so it's an OPTIONAL engine (requiresEngine: "calibre")
// rather than bundled — the app flags it as "needs Calibre" and offers a
// one-click install, exactly like the LibreOffice tools. EPUB conversion that
// doesn't need Kindle formats is already covered offline by Documents & Ebooks
// (pandoc); this tool adds the formats pandoc can't write.
//
// PDF is offered as an output only (ebook -> PDF); PDF is deliberately not an
// input, so dropping a PDF routes to the PDF tools, not here.

const path = require("node:path");
const { locateCalibre, convertEbook } = require("../main/calibre");

const INPUTS = ["epub", "mobi", "azw3", "azw", "fb2", "cbz", "cbr", "txt", "rtf", "docx", "htmlz", "lit", "pdb"];
const OUTPUTS = ["epub", "mobi", "azw3", "fb2", "txt", "rtf", "docx", "pdf", "htmlz"];

// Hide the same-format no-ops; Calibre converts freely between the rest.
const EXCLUDE = {};
for (const f of OUTPUTS) if (INPUTS.includes(f)) EXCLUDE[f] = [f];

module.exports = {
  id: "ebook-convert",
  name: "Ebooks",
  category: "Document",
  description:
    "Convert ebooks — EPUB, Kindle (MOBI/AZW3), FB2, comic archives (CBZ/CBR) and more, to EPUB, MOBI, AZW3, FB2, PDF, DOCX and text. Uses Calibre.",
  inputFormats: INPUTS,
  outputFormats: OUTPUTS,
  excludePairs: EXCLUDE,
  requiresEngine: "calibre",

  async convert({ inputPath, outputPath, signal, onProgress }) {
    const exe = locateCalibre();
    if (!exe) {
      throw new Error("Calibre isn't installed. Install it (Settings → Ebooks), then try again.");
    }
    onProgress?.(0.1);
    await convertEbook(exe, inputPath, outputPath, { signal });
    onProgress?.(1);
    return undefined;
  },
};
