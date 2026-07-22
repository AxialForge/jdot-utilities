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

function makeWindow() {
  const { BrowserWindow } = require("electron");
  return new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,

      // The document being rendered is generated from a user file, so it is
      // treated as untrusted content:
      //  - javascript:false  — a converted .html file cannot execute anything.
      //  - webSecurity:false — needed so relative <img>/<link> in the source
      //    resolve through the <base href="file://…"> we inject, even though the
      //    intermediate itself lives in the temp dir. Safe only *because* JS is
      //    off and the app makes no network calls; this window can do nothing but
      //    read local files the user explicitly chose to convert.
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
    // Park on a blank page so the window isn't holding the source document.
    win.loadURL("about:blank").catch(() => {});
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

module.exports = { renderPdf, shutdown, POOL_SIZE };
