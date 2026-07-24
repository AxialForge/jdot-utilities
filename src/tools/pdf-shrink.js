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
    {
      key: "preset",
      label: "Amount",
      type: "select",
      choices: Object.keys(PRESETS),
      default: DEFAULT_PRESET,
      choiceHelp: {
        "Smallest (72 DPI, grey)":
          "Biggest reduction. Colour is dropped and pages render at 72 DPI. Ideal for emailing a bulky scan when it only needs to be readable.",
        "Small (100 DPI)":
          "Strong reduction, colour kept. Fine for reading on screen; text will look a little soft when zoomed.",
        "Balanced (150 DPI)":
          "The usual choice. Clearly readable on screen and prints acceptably, while still cutting most scanned files down a lot.",
        "High quality (200 DPI)":
          "Mildest reduction, closest to the original. Use when the result still needs to print well.",
      },
    },
    { key: "skipIfLarger", label: "Keep the original if shrinking makes it bigger", type: "boolean", default: true },
  ],

  async convert({ inputPath, outputPath, options, signal, onProgress }) {
    const chosen = PRESETS[options?.preset] || PRESETS[DEFAULT_PRESET];
    const res = await shrinkPdf(
      inputPath,
      outputPath,
      { ...chosen, skipIfLarger: options?.skipIfLarger !== false },
      onProgress,
      { signal }
    );

    // Report the actual saving per file — without it there's no way to tell
    // whether the run was worth doing short of checking Explorer.
    const note = res.shrunk
      ? `${fmtBytes(res.before)} to ${fmtBytes(res.after)} (${pctSaved(res.before, res.after)} smaller)`
      : `Kept original — ${fmtBytes(res.before)}; shrinking would have made it bigger`;

    return { note, before: res.before, after: res.after, shrunk: res.shrunk, pages: res.pages };
  },
};

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const pctSaved = (before, after) =>
  before > 0 ? `${Math.max(0, Math.round((1 - after / before) * 100))}%` : "0%";
