// Pandoc sidecar — universal document / ebook / markup conversion: Word, ODT,
// EPUB, LaTeX source, reStructuredText, Org, AsciiDoc, Markdown, HTML and
// Jupyter notebooks. pandoc is a single self-contained binary bundled in
// resources/bin, so this needs no install and runs fully offline.
//
// OFFLINE IS ENFORCED WITH --sandbox, and that is not optional. Without it,
// pandoc fetches remote resources named in a document — e.g. an
// <img src="https://…"> encountered while writing docx/epub — which is a real
// outbound network request (verified empirically against this exact binary).
// --sandbox restricts pandoc's IO to the input files given on the command line:
// no network, no reading arbitrary local files. The only cost is that images
// referenced as *separate local files* aren't embedded; images already embedded
// inside a source container (docx/odt/epub) are preserved across rich
// conversions and are written out with --extract-media when the target is a
// text format, so they aren't silently lost.
//
// PDF is deliberately NOT a pandoc target here: pandoc->PDF needs a multi-GB
// LaTeX/TeX install, and the app already produces PDFs via its own engine.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IS_WIN = process.platform === "win32";
const EXE = IS_WIN ? "pandoc.exe" : "pandoc";

function firstExisting(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

// A copy on PATH (covers a dev machine or a user-installed pandoc).
function onPath() {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  return firstExisting(dirs.map((d) => d && path.join(d, EXE)));
}

/**
 * Resolve the pandoc binary. Bundled copy first — the packaged app ships it at
 * resources/bin (process.resourcesPath), and running from source resolves the
 * project's own resources/bin — then any pandoc on PATH. In plain node (tests)
 * there is no process.resourcesPath, so the project copy is what runs.
 */
function locatePandoc(override) {
  if (override && fs.existsSync(override)) return override;
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, "bin", EXE) : null;
  const dev = path.join(__dirname, "..", "..", "resources", "bin", EXE);
  return firstExisting([packaged, dev]) || onPath();
}

const hasPandoc = (override) => Boolean(locatePandoc(override));

// UI extension -> pandoc reader / writer token. Extensions are what the user
// picks; pandoc speaks its own format names (e.g. .tex is the "latex" writer).
const READERS = {
  md: "markdown", markdown: "markdown", html: "html", htm: "html",
  docx: "docx", odt: "odt", epub: "epub", rst: "rst", org: "org",
  tex: "latex", latex: "latex", ipynb: "ipynb",
};
const WRITERS = {
  docx: "docx", odt: "odt", epub: "epub", tex: "latex", rst: "rst",
  org: "org", adoc: "asciidoc", asciidoc: "asciidoc", html: "html",
  md: "markdown", markdown: "markdown",
};

// Container formats carry their media inside the file; a rich->rich conversion
// keeps images without touching the disk, but a rich->text conversion would drop
// them unless they're extracted.
const CONTAINER = new Set(["docx", "odt", "epub"]);

const readerFor = (ext) => READERS[String(ext || "").toLowerCase()] || null;
const writerFor = (ext) => WRITERS[String(ext || "").toLowerCase()] || null;

function runPandoc(pandocPath, args, { signal, cwd, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      pandocPath,
      args,
      { cwd, signal, timeout, windowsHide: true, maxBuffer: 1 << 26 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || "pandoc failed").toString().trim();
          // Keep the last few lines — pandoc puts the real error at the end.
          reject(new Error(msg.split("\n").slice(-4).join(" ").slice(0, 400)));
        } else {
          resolve(String(stderr || "")); // warnings come on stderr even on success
        }
      }
    );
  });
}

/**
 * Convert one file with pandoc, fully offline. `from`/`to` are UI extensions
 * (e.g. "docx" -> "md"), mapped to pandoc tokens here. Embedded media from a
 * container source is extracted into a sibling "<name>-media" folder when the
 * target is a text format. Returns { mediaDir } — the relative media folder if
 * one was written, else null.
 */
async function convertWithPandoc({ pandocPath, inputPath, outputPath, from, to, signal }) {
  const reader = readerFor(from);
  const writer = writerFor(to);
  if (!reader) throw new Error(`pandoc can't read .${from} files.`);
  if (!writer) throw new Error(`pandoc can't write .${to} files.`);

  const outDir = path.dirname(outputPath);
  const outBase = path.basename(outputPath);
  const stem = path.basename(outputPath, path.extname(outputPath));

  const args = ["--sandbox", "--from", reader, "--to", writer, "--standalone", "-o", outBase];
  // EPUB requires a nonempty title or pandoc warns and defaults it.
  if (writer === "epub") args.push("--metadata", `title=${stem}`);

  // Extract embedded images to a sibling folder only for container -> text, so
  // they aren't lost; container -> container keeps them internal.
  let mediaDir = null;
  if (CONTAINER.has(reader) && !CONTAINER.has(writer)) {
    mediaDir = `${stem}-media`;
    args.push("--extract-media", mediaDir);
  }
  args.push(inputPath);

  // Run with cwd = output dir so -o and --extract-media stay relative and the
  // media references written into the output remain portable.
  await runPandoc(pandocPath, args, { signal, cwd: outDir });
  if (!fs.existsSync(outputPath)) throw new Error("pandoc produced no output.");
  return { mediaDir: mediaDir && fs.existsSync(path.join(outDir, mediaDir)) ? mediaDir : null };
}

module.exports = {
  locatePandoc, hasPandoc, convertWithPandoc, runPandoc,
  READERS, WRITERS, CONTAINER, readerFor, writerFor,
};
