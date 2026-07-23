// Compress a PDF or convert it to archival PDF/A — via the Ghostscript sidecar.
// A "convert" tool (pdf -> pdf, batchable). Compression level and PDF/A are
// selected through one preset option, so compression is opt-in per the request.

const { locateGs, compressPdf, toPdfA } = require("../main/gs");
const settings = require("../main/settings");

// Preset label -> operation. One dropdown keeps the flat option UI uncluttered.
const PRESETS = {
  "Compress — small (screen)": { op: "compress", quality: "screen" },
  "Compress — balanced (ebook)": { op: "compress", quality: "ebook" },
  "Compress — high quality (printer)": { op: "compress", quality: "printer" },
  "Archive — PDF/A-2b": { op: "pdfa", level: "pdfa-2b" },
  "Archive — PDF/A-1b (strict)": { op: "pdfa", level: "pdfa-1b" },
};
const DEFAULT_PRESET = "Compress — balanced (ebook)";

module.exports = {
  id: "pdf-optimize",
  name: "Compress / PDF-A",
  kind: "convert",
  category: "PDF",
  description: "Shrink a PDF, or convert it to archival PDF/A. Requires Ghostscript (bundled, or installed).",

  inputFormats: ["pdf"],
  outputFormats: ["pdf"],

  options: [
    { key: "preset", label: "Output", type: "select", choices: Object.keys(PRESETS), default: DEFAULT_PRESET },
  ],

  async convert({ inputPath, outputPath, options, onProgress }) {
    const gs = locateGs(settings.readSync().ghostscriptPath);
    if (!gs) throw new Error("Ghostscript not found. Install it, or set its path in Settings.");

    const chosen = PRESETS[options.preset] || PRESETS[DEFAULT_PRESET];
    onProgress?.(0.2);
    if (chosen.op === "pdfa") {
      await toPdfA(gs, inputPath, outputPath, { level: chosen.level });
    } else {
      const res = await compressPdf(gs, inputPath, outputPath, { quality: chosen.quality });
      // If "compressing" made it bigger (already-optimized PDF), the smaller file
      // is the original — but silently swapping would surprise a batch. Leave the
      // Ghostscript output; it's still a valid, standardized PDF.
      void res;
    }
    onProgress?.(1);
  },
};
