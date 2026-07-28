// Documents & Ebooks — the pandoc-backed converter.
//
// A new tool (not a change to Document Converter): pandoc is a different engine
// with a much wider format matrix — Word, ODT, EPUB, LaTeX source, RST, Org,
// AsciiDoc, Markdown, HTML, Jupyter. pandoc is bundled (resources/bin) so this
// needs no install and runs fully offline; the offline guarantee is enforced in
// pandoc.js with --sandbox.
//
// PDF is intentionally absent: pandoc->PDF needs a huge LaTeX install, and the
// app already makes PDFs (Document Converter / Word -> PDF). This tool is for
// everything *except* PDF.

const path = require("node:path");
const { locatePandoc, convertWithPandoc } = require("../main/pandoc");

// What pandoc can read and write, expressed as the file extensions the user
// sees. (latex is offered as .tex, asciidoc as .adoc.)
const INPUTS = ["md", "markdown", "html", "htm", "docx", "odt", "epub", "rst", "org", "tex", "ipynb"];
const OUTPUTS = ["docx", "odt", "epub", "tex", "rst", "org", "adoc", "html", "md"];

// Hide the same-format no-ops (md -> md, docx -> docx, tex from .tex, …). These
// are the only invalid pairs: pandoc converts freely between everything else.
const EXCLUDE = {
  md: ["md"], markdown: ["md"], html: ["html"], htm: ["html"],
  docx: ["docx"], odt: ["odt"], epub: ["epub"], rst: ["rst"], org: ["org"],
  tex: ["tex"], latex: ["tex"],
};

module.exports = {
  id: "pandoc-convert",
  name: "Documents & Ebooks",
  category: "Document",
  description:
    "Convert between Word, OpenDocument, EPUB, LaTeX (.tex), reStructuredText, Org, AsciiDoc, Markdown, HTML and Jupyter notebooks. Bundled and fully offline. (For PDF, use Document Converter or Word → PDF.)",
  inputFormats: INPUTS,
  outputFormats: OUTPUTS,
  excludePairs: EXCLUDE,
  // No requiresEngine: pandoc is bundled, not an optional install.

  async convert({ inputPath, outputPath, outputFormat, signal, onProgress }) {
    const pandocPath = locatePandoc();
    if (!pandocPath) {
      throw new Error(
        "The bundled document engine (pandoc) wasn't found. Reinstalling the app should restore it."
      );
    }
    const from = path.extname(inputPath).slice(1).toLowerCase();
    onProgress?.(0.1);
    const { mediaDir } = await convertWithPandoc({
      pandocPath,
      inputPath,
      outputPath,
      from,
      to: outputFormat,
      signal,
    });
    onProgress?.(1);
    // Tell the user when images were pulled out of a container into a folder,
    // so the "where did my pictures go" question answers itself.
    if (mediaDir) return { note: `Images saved to ${mediaDir}/` };
    return undefined;
  },
};
