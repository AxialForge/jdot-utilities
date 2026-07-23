// Watermark PDF — stamp diagonal text across every page. A "convert" tool
// (pdf -> pdf, batchable). Pure pdf-lib, offline.

const { watermarkPdf } = require("../main/pdfops");

module.exports = {
  id: "pdf-watermark",
  name: "Watermark PDF",
  kind: "convert",
  category: "PDF",
  description: "Stamp diagonal text (e.g. DRAFT, CONFIDENTIAL) across every page.",

  inputFormats: ["pdf"],
  outputFormats: ["pdf"],

  options: [
    { key: "text", label: "Watermark text", type: "text", default: "DRAFT" },
    { key: "opacity", label: "Opacity (0.02 – 1)", type: "number", min: 0.02, max: 1, default: 0.18 },
  ],

  async convert({ inputPath, outputPath, options, onProgress }) {
    await watermarkPdf(inputPath, outputPath, options, onProgress);
  },
};
