// Shrink a PDF with no external engine — the built-in counterpart to the
// Ghostscript-backed "Compress / PDF-A" tool.
//
// Pages are re-rendered as JPEGs, so this always works with nothing installed,
// at the cost of text no longer being selectable. The description says so up
// front, and the presets are named for the job rather than the mechanism.

const { shrinkPdf } = require("../main/pdfshrink");

const PRESETS = {
  "Smallest (72 DPI, grey)": { dpi: 72, quality: 0.45, grayscale: true },
  "Small (100 DPI)": { dpi: 100, quality: 0.5, grayscale: false },
  "Balanced (150 DPI)": { dpi: 150, quality: 0.65, grayscale: false },
  "High quality (200 DPI)": { dpi: 200, quality: 0.8, grayscale: false },
};
const DEFAULT_PRESET = "Balanced (150 DPI)";

module.exports = {
  id: "pdf-shrink",
  name: "Shrink PDF (built-in)",
  kind: "convert",
  category: "PDF",
  description:
    "Make a PDF smaller with no extra software installed. Best for scans and image-heavy files. Pages become images, so text is no longer selectable — use Compress / PDF-A to keep text.",

  inputFormats: ["pdf"],
  outputFormats: ["pdf"],

  options: [
    { key: "preset", label: "Amount", type: "select", choices: Object.keys(PRESETS), default: DEFAULT_PRESET },
    { key: "skipIfLarger", label: "Keep the original if shrinking makes it bigger", type: "boolean", default: true },
  ],

  async convert({ inputPath, outputPath, options, signal, onProgress }) {
    const chosen = PRESETS[options?.preset] || PRESETS[DEFAULT_PRESET];
    await shrinkPdf(
      inputPath,
      outputPath,
      { ...chosen, skipIfLarger: options?.skipIfLarger !== false },
      onProgress,
      { signal }
    );
  },
};
