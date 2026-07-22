// Document converter. Fully offline — pure-JS libraries for parsing, and
// Electron's built-in Chromium for PDF output (no pandoc/LibreOffice binary).
//
// Pipeline: every input is normalized to an HTML intermediate, then rendered to
// the requested output. Every accepted input converts to every listed output.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { marked } = require("marked");
const TurndownService = require("turndown");
const mammoth = require("mammoth");
const htmlToDocx = require("html-to-docx");

const norm = (ext) =>
  ({ markdown: "md", md: "md", htm: "html", html: "html", txt: "txt", docx: "docx" }[ext] || ext);

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Minimal, print-friendly wrapper so HTML/PDF/DOCX output looks intentional.
function wrapHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      line-height:1.5;color:#111;max-width:46rem;margin:2rem auto;padding:0 1rem;}
    h1,h2,h3{line-height:1.25;} pre{background:#f4f4f4;padding:.75rem;border-radius:6px;overflow:auto;}
    code{font-family:ui-monospace,Consolas,monospace;} blockquote{border-left:3px solid #ccc;
      margin:0;padding-left:1rem;color:#555;} table{border-collapse:collapse;}
    td,th{border:1px solid #ccc;padding:.3rem .5rem;} img{max-width:100%;}
  </style></head><body>${body}</body></html>`;
}

function htmlToText(html) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

// Render HTML to PDF using an offscreen Electron window (Chromium). Lazy-require
// electron so this module still loads under plain Node for the non-PDF paths.
async function htmlToPdf(fullHtml, outputPath, pageSize) {
  const { BrowserWindow } = require("electron");
  const tmp = path.join(os.tmpdir(), `jdot-${crypto.randomUUID()}.html`);
  await fs.promises.writeFile(tmp, fullHtml, "utf8");
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      pageSize: pageSize || "Letter",
      printBackground: true,
      margins: { marginType: "default" },
    });
    await fs.promises.writeFile(outputPath, pdf);
  } finally {
    win.destroy();
    fs.promises.unlink(tmp).catch(() => {});
  }
}

module.exports = {
  id: "document-convert",
  name: "Document Converter",
  category: "Document",
  description: "Convert between Markdown, HTML, Word (.docx), plain text, and PDF.",

  inputFormats: ["md", "markdown", "html", "htm", "docx", "txt"],
  outputFormats: ["html", "md", "txt", "pdf", "docx"],

  options: [
    {
      key: "pageSize",
      label: "PDF page size",
      type: "select",
      choices: ["Letter", "A4", "Legal", "Tabloid"],
      default: "Letter",
    },
  ],

  async convert({ inputPath, outputPath, outputFormat, options, onProgress }) {
    const from = norm((path.extname(inputPath).slice(1) || "").toLowerCase());
    const to = norm(outputFormat);
    onProgress?.(0.15);

    // 1) Normalize the input to an HTML intermediate (and keep raw text where useful).
    let html;
    if (from === "docx") {
      html = (await mammoth.convertToHtml({ path: inputPath })).value;
    } else if (from === "html") {
      html = await fs.promises.readFile(inputPath, "utf8");
    } else if (from === "md") {
      html = marked.parse(await fs.promises.readFile(inputPath, "utf8"));
    } else if (from === "txt") {
      html = `<pre>${escapeHtml(await fs.promises.readFile(inputPath, "utf8"))}</pre>`;
    } else {
      throw new Error(`Unsupported input: .${from}`);
    }
    onProgress?.(0.5);

    // 2) Render the HTML intermediate to the requested output.
    if (to === "html") {
      await fs.promises.writeFile(outputPath, wrapHtml(html), "utf8");
    } else if (to === "md") {
      const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
      await fs.promises.writeFile(outputPath, td.turndown(html), "utf8");
    } else if (to === "txt") {
      const text =
        from === "docx"
          ? (await mammoth.extractRawText({ path: inputPath })).value
          : from === "txt"
            ? await fs.promises.readFile(inputPath, "utf8")
            : htmlToText(html);
      await fs.promises.writeFile(outputPath, text, "utf8");
    } else if (to === "docx") {
      const buf = await htmlToDocx(wrapHtml(html));
      await fs.promises.writeFile(outputPath, Buffer.isBuffer(buf) ? buf : Buffer.from(await buf.arrayBuffer()));
    } else if (to === "pdf") {
      await htmlToPdf(wrapHtml(html), outputPath, options?.pageSize);
    } else {
      throw new Error(`Unsupported output: .${to}`);
    }
    onProgress?.(1);
  },
};
