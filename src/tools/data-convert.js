// Structured-data converter — JSON / YAML / CSV / TSV / XML, any-to-any.
// Pure JS, offline. A "convert" tool (one output per input, batchable).

const path = require("node:path");
const { convertData } = require("../main/dataconv");

const FORMATS = ["json", "yaml", "yml", "csv", "tsv", "xml"];

module.exports = {
  id: "data-convert",
  name: "Data Converter",
  category: "Data",
  description: "Convert between JSON, YAML, CSV, TSV, and XML. Flat formats (CSV/TSV) flatten nested data.",

  inputFormats: FORMATS,
  outputFormats: ["json", "yaml", "csv", "tsv", "xml"],

  // Same-format (and yaml/yml alias) round-trips aren't conversions.
  excludePairs: { json: ["json"], yaml: ["yaml"], yml: ["yaml"], csv: ["csv"], tsv: ["tsv"], xml: ["xml"] },

  options: [],

  async convert({ inputPath, outputPath, outputFormat, onProgress }) {
    onProgress?.(0.3);
    const from = (path.extname(inputPath).slice(1) || "").toLowerCase();
    const res = await convertData(inputPath, outputPath, from, outputFormat);
    onProgress?.(1);
    // Warnings (e.g. "nested values JSON-encoded into cells") are informational;
    // the file is still written. The batch summary can't show them per-file, but
    // the conversion succeeds, which is the right call for data reshaping.
    return res;
  },
};
