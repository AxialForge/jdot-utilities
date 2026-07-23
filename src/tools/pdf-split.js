// Split one PDF into several — an "explode" utility (1 in -> N out).

const { splitPdf } = require("../main/pdfops");

module.exports = {
  id: "pdf-split",
  name: "Split PDF",
  kind: "explode",
  category: "PDF",
  description: "Break a PDF into several files — one per page, fixed-size groups, or custom ranges.",

  inputFormats: ["pdf"],
  outputFormats: ["pdf"],

  options: [
    {
      key: "mode",
      label: "Split by",
      type: "select",
      choices: ["each", "every", "ranges"],
      default: "each",
    },
    { key: "size", label: "Pages per file (for “every”)", type: "number", min: 1, max: 5000, default: 1 },
    { key: "spec", label: "Ranges (for “ranges”), e.g. 1-3, 4-6", type: "text", default: "" },
  ],

  async run({ inputPath, allocate, options, signal, onProgress }) {
    return splitPdf(inputPath, options, allocate, onProgress, { signal });
  },
};
