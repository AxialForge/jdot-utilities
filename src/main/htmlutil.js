// HTML normalization shared by every document path.
//
// Why this exists: Turndown (html -> md) and the tag-stripping text extractor
// both treat <style>/<script> as ordinary elements and emit their *contents* as
// body text. Converting any normal web page therefore dumped the stylesheet and
// the JavaScript into the top of the .md / .txt output. Everything that turns
// HTML into another format must run stripNonContent() first.

const { pathToFileURL } = require("node:url");

// <style> and <script> are "raw text" elements in the HTML spec: their content
// cannot contain a nested element, and it ends at the first matching close tag.
// A regex is exact here, not an approximation.
const RAW_TEXT = /<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
// Unclosed trailing <style>/<script> (truncated documents) — drop to end.
const RAW_TEXT_UNCLOSED = /<\s*(script|style)\b[^>]*>[\s\S]*$/i;
const COMMENTS = /<!--[\s\S]*?-->/g;
// <head> metadata that would otherwise surface as text (<title>, <noscript>).
const TITLE = /<\s*title\b[^>]*>[\s\S]*?<\s*\/\s*title\s*>/gi;

/**
 * Remove everything that is markup machinery rather than document content.
 * Safe to run on a fragment or a full document.
 */
function stripNonContent(html) {
  return String(html)
    .replace(COMMENTS, "")
    .replace(RAW_TEXT, "")
    .replace(TITLE, "")
    .replace(RAW_TEXT_UNCLOSED, "");
}

/**
 * Read the <title> of a document, if it has one. Called before stripNonContent
 * so the title can be preserved deliberately (as an <h1>) rather than leaking.
 */
function extractTitle(html) {
  const m = /<\s*title\b[^>]*>([\s\S]*?)<\s*\/\s*title\s*>/i.exec(String(html));
  return m ? m[1].trim() : null;
}

/**
 * Absolute file:// URL for a directory, with a trailing slash so it is a valid
 * <base href>. Handles spaces and drive letters correctly on Windows.
 */
function baseHrefFor(dir) {
  const url = pathToFileURL(dir).href;
  return url.endsWith("/") ? url : url + "/";
}

/**
 * Rewrite a bare fragment or document into a complete, print-ready HTML file.
 *
 * `baseDir` is the directory the original file came from. Without it, relative
 * <img src="chart.png"> and <link href="style.css"> resolve against wherever the
 * intermediate happens to be written (the temp dir) and silently 404.
 */
function wrapDocument(body, { baseDir, title } = {}) {
  const base = baseDir ? `<base href="${baseHrefFor(baseDir)}">` : "";
  const head = title ? `<title>${escapeHtml(title)}</title>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${base}${head}<style>
    body{font-family:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      line-height:1.5;color:#111;max-width:46rem;margin:2rem auto;padding:0 1rem;}
    h1,h2,h3{line-height:1.25;} pre{background:#f4f4f4;padding:.75rem;border-radius:6px;overflow:auto;}
    code{font-family:ui-monospace,Consolas,monospace;} blockquote{border-left:3px solid #ccc;
      margin:0;padding-left:1rem;color:#555;} table{border-collapse:collapse;}
    td,th{border:1px solid #ccc;padding:.3rem .5rem;} img{max-width:100%;}
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}

/**
 * Plain-text extraction. Assumes stripNonContent() has already run — it does not
 * re-strip, so callers cannot accidentally skip that step and leak CSS.
 */
function toPlainText(cleanedHtml) {
  const text = String(cleanedHtml)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|blockquote|section|article)\s*>/gi, "\n")
    .replace(/<\s*\/\s*(td|th)\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  stripNonContent,
  extractTitle,
  baseHrefFor,
  wrapDocument,
  escapeHtml,
  decodeEntities,
  toPlainText,
};
