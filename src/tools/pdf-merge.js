// Merge PDFs — the first "collect" utility (N files in, 1 file out).
//
// This used to be a hardcoded tab with its own IPC channel. It is now an ordinary
// auto-discovered descriptor, which is the whole point of the kind refactor: the
// rest of the PDF toolkit is a sibling file each.

const { mergePdfs } = require("../main/pdfops");

module.exports = {
  id: "pdf-merge",
  name: "Merge PDFs",
  kind: "collect",
  category: "PDF",
  description: "Combine several PDFs into a single document. Drag to reorder before merging.",

  inputFormats: ["pdf"],
  outputFormats: ["pdf"],

  ordered: true, // page order follows list order, so the UI offers reordering
  minInputs: 2,
  defaultName: "merged",

  options: [],

  async run({ inputPaths, outputPath, signal, onProgress }) {
    // mergePdfs reports the things a pdf-lib page copy silently drops (form
    // fields, bookmarks) as `warnings`; the UI shows them after a successful run.
    return mergePdfs(inputPaths, outputPath, onProgress, { signal });
  },
};
