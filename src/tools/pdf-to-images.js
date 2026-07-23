// PDF -> images — an "explode" utility (1 PDF in -> N images out, one per page).

const { rasterizePdf } = require("../main/pdfraster");

module.exports = {
  id: "pdf-to-images",
  name: "PDF → Images",
  kind: "explode",
  category: "PDF",
  description: "Render each page of a PDF to an image. Choose PNG (crisp) or JPG (smaller).",

  inputFormats: ["pdf"],
  outputFormats: ["png", "jpg"],

  options: [
    { key: "format", label: "Image format", type: "select", choices: ["png", "jpg"], default: "png" },
    { key: "dpi", label: "Resolution (DPI)", type: "number", min: 36, max: 432, default: 150 },
    { key: "pages", label: "Pages (blank = all), e.g. 1-3, 5", type: "text", default: "" },
  ],

  async run({ inputPath, allocate, options, signal, onProgress }) {
    return rasterizePdf(inputPath, options, allocate, onProgress, { signal });
  },
};
