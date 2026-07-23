// OCR → Text — read text from scanned PDFs and images. A "convert" tool
// (one .txt per input, batchable). Fully offline (bundled English model).

const fs = require("node:fs");
const path = require("node:path");
const { ocrImage, ocrPdf } = require("../main/ocr");

module.exports = {
  id: "ocr-text",
  name: "OCR → Text",
  kind: "convert",
  category: "PDF",
  description: "Read text from scanned PDFs and images using offline OCR (English). Outputs plain text.",

  inputFormats: ["pdf", "png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp"],
  outputFormats: ["txt"],

  options: [
    { key: "dpi", label: "Scan resolution for PDF pages (DPI)", type: "number", min: 72, max: 400, default: 200 },
  ],

  async convert({ inputPath, outputPath, options, signal, onProgress }) {
    const ext = (path.extname(inputPath).slice(1) || "").toLowerCase();
    let text;
    if (ext === "pdf") {
      text = await ocrPdf(inputPath, { dpi: options.dpi, onProgress, signal });
    } else {
      onProgress?.(0.2);
      text = await ocrImage(inputPath);
      onProgress?.(1);
    }
    await fs.promises.writeFile(outputPath, text ? text + "\n" : "", "utf8");
    if (!text.trim()) throw new Error("OCR found no readable text.");
  },
};
