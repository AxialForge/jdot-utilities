// Page-level PDF edits: rotate, delete, extract. Each is a "convert" utility
// (pdf -> pdf, one output per input) so they batch across many files, and the
// collision-safe namer writes "<name> (1).pdf" rather than touching the source.
//
// Exports an array — three descriptors from one file.

const { rotatePages, deletePages, extractPages } = require("../main/pdfops");

module.exports = [
  {
    id: "pdf-rotate",
    name: "Rotate PDF",
    kind: "convert",
    category: "PDF",
    description: "Rotate pages 90/180/270°. Leave the range blank to rotate every page.",
    inputFormats: ["pdf"],
    outputFormats: ["pdf"],
    options: [
      { key: "angle", label: "Rotation", type: "select", choices: ["90", "180", "270"], default: "90" },
      { key: "spec", label: "Pages (blank = all), e.g. 1-3, 5", type: "text", default: "" },
    ],
    async convert({ inputPath, outputPath, options, onProgress }) {
      await rotatePages(inputPath, outputPath, options.angle, options.spec, onProgress);
    },
  },
  {
    id: "pdf-delete",
    name: "Delete Pages",
    kind: "convert",
    category: "PDF",
    description: "Remove the named pages and keep the rest, e.g. 1, 4-6.",
    inputFormats: ["pdf"],
    outputFormats: ["pdf"],
    options: [{ key: "spec", label: "Pages to remove, e.g. 1, 4-6", type: "text", default: "" }],
    async convert({ inputPath, outputPath, options, onProgress }) {
      if (!options.spec || !String(options.spec).trim()) throw new Error("Enter the pages to remove.");
      await deletePages(inputPath, outputPath, options.spec, onProgress);
    },
  },
  {
    id: "pdf-extract",
    name: "Extract Pages",
    kind: "convert",
    category: "PDF",
    description: "Keep only the named pages, e.g. 2-5. Order follows what you type.",
    inputFormats: ["pdf"],
    outputFormats: ["pdf"],
    options: [{ key: "spec", label: "Pages to keep, e.g. 2-5", type: "text", default: "" }],
    async convert({ inputPath, outputPath, options, onProgress }) {
      if (!options.spec || !String(options.spec).trim()) throw new Error("Enter the pages to keep.");
      await extractPages(inputPath, outputPath, options.spec, onProgress);
    },
  },
];
