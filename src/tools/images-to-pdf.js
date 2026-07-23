// Images -> one PDF — a "collect" utility (N in -> 1 out), one image per page.

const { imagesToPdf } = require("../main/imgpdf");

module.exports = {
  id: "images-to-pdf",
  name: "Images → PDF",
  kind: "collect",
  category: "PDF",
  description: "Combine images into a single PDF, one image per page. Drag to set page order.",

  inputFormats: ["png", "jpg", "jpeg", "webp", "gif", "tiff", "bmp"],
  outputFormats: ["pdf"],

  ordered: true, // page order follows list order
  minInputs: 1, // a one-image PDF is a legitimate ask
  defaultName: "images",

  options: [
    {
      key: "pageSize",
      label: "Page size",
      type: "select",
      // "Fit" makes each page exactly the image size (no borders); the others
      // center the image on a fixed page.
      choices: ["Fit", "Letter", "A4", "Legal"],
      default: "Fit",
    },
    { key: "margin", label: "Margin (pts, fixed sizes only)", type: "number", min: 0, max: 200, default: 18 },
  ],

  async run({ inputPaths, outputPath, options, signal, onProgress }) {
    return imagesToPdf(inputPaths, outputPath, options, onProgress, { signal });
  },
};
