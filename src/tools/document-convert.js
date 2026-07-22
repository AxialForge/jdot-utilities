// Document converter. Fully offline — pure-JS libraries for parsing, and
// Electron's built-in Chromium for PDF output (no pandoc/LibreOffice binary).
//
// Pipeline: every input is normalized to an HTML intermediate, then rendered to
// the requested output.
//
// Two things the intermediate MUST carry, or output is silently wrong:
//  1. It is run through htmlutil.stripNonContent() before any text-ish target.
//     Turndown and the plain-text extractor both emit <style>/<script> *contents*
//     as body text, so without this an ordinary web page dumps its stylesheet and
//     its JavaScript into the top of the .md / .txt output.
//  2. It carries a <base href="file:///source/dir/"> so relative <img>/<link>
//     references still resolve once the intermediate is written elsewhere.

const fs = require("node:fs");
const path = require("node:path");

const { marked } = require("marked");
const TurndownService = require("turndown");
const mammoth = require("mammoth");
const htmlToDocx = require("html-to-docx");

const htmlutil = require("../main/htmlutil");

const norm = (ext) =>
  ({ markdown: "md", md: "md", htm: "html", html: "html", txt: "txt", docx: "docx" }[ext] || ext);

const INPUTS = ["md", "markdown", "html", "htm", "docx", "txt"];
const OUTPUTS = ["html", "md", "txt", "pdf", "docx"];

// Pairs to hide in the UI. A same-format "conversion" would round-trip the file
// through the HTML intermediate and lose formatting for no benefit — docx -> docx
// in particular goes mammoth -> html -> html-to-docx and visibly degrades the
// document. Keyed by normalized input format.
const EXCLUDE = { md: ["md"], html: ["html"], txt: ["txt"], docx: ["docx"] };

function turndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  // Belt and braces: even if a caller forgets stripNonContent, never emit these.
  td.remove(["style", "script", "noscript", "title"]);
  return td;
}

module.exports = {
  id: "document-convert",
  name: "Document Converter",
  category: "Document",
  description: "Convert between Markdown, HTML, Word (.docx), plain text, and PDF.",

  inputFormats: INPUTS,
  outputFormats: OUTPUTS,
  excludePairs: EXCLUDE,

  options: [
    {
      key: "pageSize",
      label: "PDF page size",
      type: "select",
      choices: ["Letter", "A4", "Legal", "Tabloid"],
      default: "Letter",
    },
    {
      key: "landscape",
      label: "PDF landscape",
      type: "boolean",
      default: false,
    },
  ],

  async convert({ inputPath, outputPath, outputFormat, options, onProgress }) {
    const from = norm((path.extname(inputPath).slice(1) || "").toLowerCase());
    const to = norm(outputFormat);
    if (!INPUTS.map(norm).includes(from)) throw new Error(`Unsupported input: .${from}`);
    if (!OUTPUTS.includes(to)) throw new Error(`Unsupported output: .${to}`);

    const baseDir = path.dirname(path.resolve(inputPath));
    onProgress?.(0.15);

    // ── 1) Normalize the input to an HTML body fragment ──────────────
    let body;
    let title = null;
    let rawText = null; // kept when the source is already text, to skip a lossy trip

    if (from === "docx") {
      // mammoth inlines embedded images as base64 data URIs by default, so they
      // survive without needing baseDir.
      body = (await mammoth.convertToHtml({ path: inputPath })).value;
    } else if (from === "html") {
      const raw = await fs.promises.readFile(inputPath, "utf8");
      title = htmlutil.extractTitle(raw);
      body = htmlutil.stripNonContent(raw);
    } else if (from === "md") {
      rawText = await fs.promises.readFile(inputPath, "utf8");
      // Markdown may embed raw HTML, including <script>. Strip after rendering.
      body = htmlutil.stripNonContent(marked.parse(rawText));
    } else if (from === "txt") {
      rawText = await fs.promises.readFile(inputPath, "utf8");
      body = `<pre>${htmlutil.escapeHtml(rawText)}</pre>`;
    }
    onProgress?.(0.5);

    // ── 2) Render the intermediate to the requested output ───────────
    if (to === "html") {
      await fs.promises.writeFile(
        outputPath,
        htmlutil.wrapDocument(body, { baseDir, title }),
        "utf8"
      );
    } else if (to === "md") {
      await fs.promises.writeFile(outputPath, turndown().turndown(body).trim() + "\n", "utf8");
    } else if (to === "txt") {
      // Prefer a direct extraction over the HTML round-trip where one exists.
      const text =
        from === "docx"
          ? (await mammoth.extractRawText({ path: inputPath })).value
          : from === "txt"
            ? rawText
            : htmlutil.toPlainText(body) + "\n";
      await fs.promises.writeFile(outputPath, text, "utf8");
    } else if (to === "docx") {
      const buf = await htmlToDocx(htmlutil.wrapDocument(body, { baseDir, title }));
      await fs.promises.writeFile(
        outputPath,
        Buffer.isBuffer(buf) ? buf : Buffer.from(await buf.arrayBuffer())
      );
    } else if (to === "pdf") {
      // Lazy-require: pdfrender needs Electron, and this module must stay
      // loadable under plain node for every non-PDF path (and for tests).
      const { renderPdf } = require("../main/pdfrender");
      await renderPdf(htmlutil.wrapDocument(body, { baseDir, title }), outputPath, {
        pageSize: options?.pageSize,
        landscape: Boolean(options?.landscape),
      });
    }
    onProgress?.(1);
  },
};
