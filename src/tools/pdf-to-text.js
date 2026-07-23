// PDF -> text — a "convert" utility (pdf -> txt, one output per input, batchable).

const { pdfToText } = require("../main/pdftext");

module.exports = {
  id: "pdf-to-text",
  name: "PDF → Text",
  kind: "convert",
  category: "PDF",
  description: "Extract the text layer from a PDF. (Scanned/image-only PDFs need OCR — not covered.)",

  inputFormats: ["pdf"],
  outputFormats: ["txt"],

  options: [
    { key: "pageBreaks", label: "Insert a page break between pages", type: "boolean", default: false },
  ],

  async convert({ inputPath, outputPath, options, signal, onProgress }) {
    const res = await pdfToText(inputPath, outputPath, options, onProgress, { signal });
    // The empty-scan case still writes a (empty) file and succeeds; the batch
    // summary can't show per-file warnings, so surface it as an error line here
    // instead, which is more useful than a silently empty .txt.
    if (res.empty) throw new Error("No text layer found — looks like a scanned PDF (needs OCR).");
  },
};
