// Edit PDF metadata — title / author / subject / keywords. A "convert" tool
// (pdf -> pdf, batchable). Pure pdf-lib, offline.
//
// A blank field CLEARS that metadata; to leave a field untouched, the UI would
// need a sentinel — so this tool treats blank as "set to empty", which is the
// intuitive behaviour when you can see the fields.

const { setMetadata } = require("../main/pdfops");

module.exports = {
  id: "pdf-metadata",
  name: "Edit PDF Info",
  kind: "convert",
  category: "PDF",
  description: "Set a PDF's document title, author, subject, and keywords.",

  inputFormats: ["pdf"],
  outputFormats: ["pdf"],

  options: [
    { key: "title", label: "Title", type: "text", default: "" },
    { key: "author", label: "Author", type: "text", default: "" },
    { key: "subject", label: "Subject", type: "text", default: "" },
    { key: "keywords", label: "Keywords (comma-separated)", type: "text", default: "" },
  ],

  async convert({ inputPath, outputPath, options, onProgress }) {
    onProgress?.(0.3);
    await setMetadata(inputPath, outputPath, options);
    onProgress?.(1);
  },
};
