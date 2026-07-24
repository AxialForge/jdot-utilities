// HTML -> PDF via Electron's bundled Chromium.
//
// Previously every file in a batch created and destroyed its own offscreen
// BrowserWindow; a 300-file job created 300 windows. This keeps a small pool of
// reusable hidden windows instead, so a batch costs POOL_SIZE windows total.
//
// Only usable inside Electron's main process — plain `node` has no BrowserWindow,
// which is why electron is required lazily.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const POOL_SIZE = 3; // enough to overlap I/O without spawning a renderer per file

// Schemes the render window may load. Everything else — notably http/https — is
// refused outright.
const LOCAL_SCHEME = /^(file|data|blob|about):/i;

// Its own session, so the block below can never affect the main window.
const RENDER_PARTITION = "jdot-pdfrender";
let renderSession = null;

/**
 * Session for the pooled render windows, with all non-local requests blocked.
 *
 * `javascript: false` stops scripts from *executing*, but it does NOT stop
 * Chromium's resource loader from fetching remote URLs named in markup —
 * <img src="https://…">, <link rel="stylesheet">, CSS url(…), <iframe>. So
 * converting any document that hotlinks an image (an emailed .docx, a
 * downloaded template) fired a real network request during rendering. That
 * breaks this app's central promise of being fully offline, and it hands
 * whoever sent the file a read receipt — and a blind probe of the local
 * network. Verified with a real render before this was added: three remote
 * requests went out from a document containing no JavaScript at all.
 *
 * Blocking at the session is the reliable place: it covers every resource type
 * and every redirect, rather than trying to sanitize markup beforehand.
 */
function getRenderSession() {
  if (renderSession) return renderSession;
  const { session } = require("electron");
  renderSession = session.fromPartition(RENDER_PARTITION);
  // A redirect issues a fresh request, so this one handler covers those too.
  renderSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !LOCAL_SCHEME.test(details.url) });
  });
  return renderSession;
}

// Offscreen render window, in the locked-down offline session. `javascript`
// differs by pool: false for the untrusted converted-HTML pool (a .html file
// cannot execute anything), true for the docx pool (docx-preview must run, and
// only our bundled code does — the session still refuses every non-local
// request). webSecurity:false lets relative <img>/<link> resolve through the
// <base href="file://…"> we inject; scoped by the session, the window can do
// nothing but read local files the user chose to convert.
function makeWindow(javascript) {
  const { BrowserWindow } = require("electron");
  return new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      session: getRenderSession(),
      javascript,
      webSecurity: false,
    },
  });
}

// A pool of reusable hidden windows. Reuse (rather than create/destroy per file)
// is what keeps a 300-file batch to POOL_SIZE windows — and, on Electron 43,
// what avoids a hard renderer crash: destroying a window and immediately
// creating another in the same session deadlocks the second one. Callers MUST
// park the window on about:blank and await that navigation before release()
// (see renderPdf / renderDocxPdf), or the next job's load races the parking nav.
function createPool(javascript) {
  const idle = [];
  const waiting = [];
  let created = 0;
  let shuttingDown = false;

  async function acquire() {
    const reusable = idle.pop();
    if (reusable && !reusable.isDestroyed()) return reusable;
    if (reusable) created -= 1; // it died while parked; don't count it
    if (created < POOL_SIZE) {
      created += 1;
      return makeWindow(javascript);
    }
    return new Promise((resolve) => waiting.push(resolve));
  }

  function release(win) {
    if (shuttingDown || win.isDestroyed()) {
      created -= 1;
      // Hand a fresh window to anyone queued, or they wait forever.
      const next = waiting.shift();
      if (next && !shuttingDown) {
        created += 1;
        next(makeWindow(javascript));
      }
      return;
    }
    const next = waiting.shift();
    if (next) next(win);
    else idle.push(win);
  }

  function shutdown() {
    shuttingDown = true;
    for (const win of idle.splice(0)) {
      try { win.destroy(); } catch {}
    }
    created = 0;
  }

  return { acquire, release, shutdown };
}

// The converted-HTML pool (js off) and the Word-render pool (js on). Both go
// through the same offline session.
const htmlPool = createPool(false);
const docxPool = createPool(true);

// A grayscale ("Black & White") request is honoured by a single CSS filter on
// the root element. Chromium applies it during printToPDF (with printBackground
// on), so every colour — text, table fills, images — is desaturated in the
// output while layout is untouched. Both the prefixed and unprefixed forms are
// set because the print path has historically wanted -webkit-.
const GRAYSCALE_STYLE =
  "<style>html{filter:grayscale(100%);-webkit-filter:grayscale(100%);}</style>";

function withGrayscale(fullHtml, grayscale) {
  if (!grayscale) return fullHtml;
  // wrapDocument always emits a </head>; inject there so the filter is in place
  // before first paint. Fall back to a prefix if a caller passed a bare fragment.
  return fullHtml.includes("</head>")
    ? fullHtml.replace("</head>", GRAYSCALE_STYLE + "</head>")
    : GRAYSCALE_STYLE + fullHtml;
}

/**
 * Render a complete HTML document to a PDF file.
 *
 * The document is expected to carry a <base href="file:///source/dir/"> so that
 * relative assets in the original file still resolve — see htmlutil.wrapDocument.
 * That lets the intermediate live in the temp dir instead of being written into
 * the user's own folders.
 */
async function renderPdf(
  fullHtml,
  outputPath,
  { pageSize = "Letter", landscape = false, grayscale = false } = {}
) {
  const tmp = path.join(os.tmpdir(), `jdot-render-${crypto.randomUUID()}.html`);
  await fs.promises.writeFile(tmp, withGrayscale(fullHtml, grayscale), "utf8");

  const win = await htmlPool.acquire();
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      pageSize,
      landscape,
      printBackground: true,
      margins: { marginType: "default" },
    });
    await fs.promises.writeFile(outputPath, pdf);
  } finally {
    // Park on a blank page so the window isn't holding the source document —
    // and WAIT for that navigation to finish before handing the window on.
    //
    // Releasing first left the parking navigation in flight while the next job
    // called loadFile() on the same window. On Electron 32 that race was
    // survivable; on 43 it takes the renderer process down hard, so a batch
    // crashed the moment a window was reused — i.e. at concurrency > POOL_SIZE.
    // Reproduced exactly: 1-3 concurrent renders fine, 4 killed the process.
    try {
      await win.loadURL("about:blank");
    } catch {
      // Destroyed or already navigating away; release() handles a dead window.
    }
    htmlPool.release(win);
    fs.promises.unlink(tmp).catch(() => {});
  }
}

// ── High-fidelity Word (.docx) -> PDF ────────────────────────────────────────
//
// mammoth (used for docx -> md/txt/html) throws away all styling: table borders,
// column widths, cell fills, fonts, rotated text. For a form-like document that
// collapses the whole layout, so docx -> pdf produced something that looked
// nothing like Word. This path instead renders the .docx faithfully with
// docx-preview (pure JS, reads the OOXML directly) inside an offscreen Chromium
// window, then prints that to PDF — a genuine 1:1 conversion, still fully offline.
//
// It runs in docxPool — JavaScript-enabled, unlike htmlPool (which stays
// javascript:false to run untrusted converted HTML). Only our two bundled
// libraries and a fixed bootstrap run here, and the render session refuses every
// non-local request, so enabling scripts changes nothing about the offline
// guarantee. Each render loads a fresh full page (libs + bootstrap), so a reused
// window is fully replaced; the window is parked on about:blank before release,
// the same discipline renderPdf's pool needs to avoid the reuse crash.

let libCache = null;
// Read the browser builds of docx-preview + jszip once and inline them into the
// render page. docx-preview's package `exports` hides the dist subpath, so its
// entry is resolved and the sibling .min.js read from disk. fs reads work inside
// the packaged asar, so nothing here needs asarUnpack.
function docxLibs() {
  if (libCache) return libCache;
  const jszipPath = require.resolve("jszip/dist/jszip.min.js");
  const dpEntry = require.resolve("docx-preview"); // .../dist/docx-preview.js
  const dpMin = path.join(path.dirname(dpEntry), "docx-preview.min.js");
  // A </script> inside a library's own string literals would otherwise close the
  // inline <script> early; neutralise it (the browser reads <\/script the same).
  const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
  libCache = {
    jszip: safe(fs.readFileSync(jszipPath, "utf8")),
    docx: safe(fs.readFileSync(dpMin, "utf8")),
  };
  return libCache;
}

/**
 * Read a .docx's own page geometry (size + orientation are already baked into
 * w:w / w:h as physical dimensions) so the PDF paginates exactly like Word does.
 * Twips are 1/1440 inch. Pure string parsing — exported for unit testing. Any
 * malformed or missing value falls back to US Letter.
 */
function parseDocxPageSize(documentXml) {
  const fallback = { widthIn: 8.5, heightIn: 11 };
  const tag = /<w:pgSz\b[^>]*\/?>/.exec(String(documentXml || ""));
  if (!tag) return fallback;
  const w = /w:w="(\d+)"/.exec(tag[0]);
  const h = /w:h="(\d+)"/.exec(tag[0]);
  const widthIn = w ? Number(w[1]) / 1440 : fallback.widthIn;
  const heightIn = h ? Number(h[1]) / 1440 : fallback.heightIn;
  if (!(widthIn > 0) || !(heightIn > 0)) return fallback;
  return { widthIn, heightIn };
}

async function docxPageSize(buf) {
  try {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(buf);
    const file = zip.file("word/document.xml");
    if (!file) return { widthIn: 8.5, heightIn: 11 };
    return parseDocxPageSize(await file.async("string"));
  } catch {
    return { widthIn: 8.5, heightIn: 11 };
  }
}

function docxRenderPage({ jszip, docx, docxBase64, widthIn, heightIn, grayscale }) {
  const gray = grayscale
    ? "html{filter:grayscale(100%);-webkit-filter:grayscale(100%);}"
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${widthIn}in ${heightIn}in;margin:0;}
html,body{margin:0;padding:0;}
${gray}
</style>
<script>${jszip}</script>
<script>${docx}</script>
</head><body><div id="c"></div>
<script>
window.__renderDocx = (async function () {
  var b64 = "${docxBase64}";
  var bin = atob(b64);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  await window.docx.renderAsync(arr.buffer, document.getElementById("c"), null, {
    inWrapper: false,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    useBase64URL: true,
  });
  return true;
})();
</script></body></html>`;
}

/**
 * Render a Word (.docx) file to a PDF file with full visual fidelity.
 * `grayscale: true` produces a Black & White PDF.
 */
async function renderDocxPdf(inputPath, outputPath, { grayscale = false } = {}) {
  const buf = await fs.promises.readFile(inputPath);
  const { widthIn, heightIn } = await docxPageSize(buf);
  const { jszip, docx } = docxLibs();

  const html = docxRenderPage({
    jszip,
    docx,
    docxBase64: buf.toString("base64"),
    widthIn,
    heightIn,
    grayscale,
  });
  const tmp = path.join(os.tmpdir(), `jdot-docx-${crypto.randomUUID()}.html`);
  await fs.promises.writeFile(tmp, html, "utf8");

  const win = await docxPool.acquire();
  try {
    await win.loadFile(tmp);
    // renderAsync resolves once the document is laid out; await it in the page.
    await win.webContents.executeJavaScript("window.__renderDocx", true);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true, // honour the @page size derived from the .docx
      margins: { marginType: "none" },
    });
    await fs.promises.writeFile(outputPath, pdf);
  } finally {
    // Park on about:blank (awaited) before release — same reuse discipline as
    // renderPdf. Releasing with the navigation in flight races the next load.
    try {
      await win.loadURL("about:blank");
    } catch {
      // Destroyed or already navigating; release() handles a dead window.
    }
    docxPool.release(win);
    fs.promises.unlink(tmp).catch(() => {});
  }
}

// Called on app quit so hidden windows don't keep the process alive.
function shutdown() {
  htmlPool.shutdown();
  docxPool.shutdown();
}

module.exports = { renderPdf, renderDocxPdf, parseDocxPageSize, shutdown, POOL_SIZE, RENDER_PARTITION };
