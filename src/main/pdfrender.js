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

const idle = [];
const waiting = [];
let created = 0;
let shuttingDown = false;

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

function makeWindow() {
  const { BrowserWindow } = require("electron");
  return new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      session: getRenderSession(),

      // The document being rendered is generated from a user file, so it is
      // treated as untrusted content:
      //  - javascript:false  — a converted .html file cannot execute anything.
      //  - webSecurity:false — needed so relative <img>/<link> in the source
      //    resolve through the <base href="file://…"> we inject, even though the
      //    intermediate itself lives in the temp dir. Scoped by the session
      //    above, which refuses every non-local scheme, so this window can do
      //    nothing but read local files the user explicitly chose to convert.
      javascript: false,
      webSecurity: false,
    },
  });
}

async function acquire() {
  const reusable = idle.pop();
  if (reusable && !reusable.isDestroyed()) return reusable;
  if (reusable) created -= 1; // it died while parked; don't count it
  if (created < POOL_SIZE) {
    created += 1;
    return makeWindow();
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
      next(makeWindow());
    }
    return;
  }
  const next = waiting.shift();
  if (next) next(win);
  else idle.push(win);
}

/**
 * Render a complete HTML document to a PDF file.
 *
 * The document is expected to carry a <base href="file:///source/dir/"> so that
 * relative assets in the original file still resolve — see htmlutil.wrapDocument.
 * That lets the intermediate live in the temp dir instead of being written into
 * the user's own folders.
 */
async function renderPdf(fullHtml, outputPath, { pageSize = "Letter", landscape = false } = {}) {
  const tmp = path.join(os.tmpdir(), `jdot-render-${crypto.randomUUID()}.html`);
  await fs.promises.writeFile(tmp, fullHtml, "utf8");

  const win = await acquire();
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
    release(win);
    fs.promises.unlink(tmp).catch(() => {});
  }
}

// Called on app quit so hidden windows don't keep the process alive.
function shutdown() {
  shuttingDown = true;
  for (const win of idle.splice(0)) {
    try { win.destroy(); } catch {}
  }
  created = 0;
}

module.exports = { renderPdf, shutdown, POOL_SIZE, RENDER_PARTITION };
