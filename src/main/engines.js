// One place that knows about the optional external engines.
//
// Almost everything in the app is self-contained, but two tools shell out:
// Office conversion needs LibreOffice, and Compress / PDF-A needs Ghostscript.
// Before this module existed, a missing engine only surfaced as a failed
// conversion *after* the user had picked files and pressed go. Now the app can
// ask up front and say so plainly.
//
// A tool opts in by declaring `requiresEngine: "libreoffice"` (or
// "ghostscript") in its descriptor — no list to maintain here.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { locateSoffice } = require("./office");
const { locateGs } = require("./gs");

const ENGINES = {
  libreoffice: {
    id: "libreoffice",
    name: "LibreOffice",
    needed: "Word, spreadsheet, and presentation conversions",
    url: "https://www.libreoffice.org/",
    settingKey: "libreOfficePath",
    // Installed through Windows Package Manager when it's available. Delegating
    // means Microsoft's client does the downloading, hash check and signature
    // verification — this app never fetches or executes an installer itself,
    // and only ever runs on an explicit click.
    winget: "TheDocumentFoundation.LibreOffice",
    sizeHint: "about 400 MB",
    locate: (s) => locateSoffice(s.libreOfficePath),
  },
  ghostscript: {
    id: "ghostscript",
    name: "Ghostscript",
    needed: "Compress / PDF-A",
    // Shrink PDF (built-in) covers plain compression with nothing installed, so
    // this is only genuinely required for PDF/A.
    alternative: "Shrink PDF (built-in) compresses without it.",
    url: "https://www.ghostscript.com/releases/gsdnld.html",
    settingKey: "ghostscriptPath",
    // Not carried by winget (only unrelated packages tag it), so the download
    // page is the honest option here rather than a button that can't work.
    winget: null,
    sizeHint: "about 60 MB",
    locate: (s) => locateGs(s.ghostscriptPath),
  },
};

const isEngine = (id) => Object.prototype.hasOwnProperty.call(ENGINES, id);

// Is Windows Package Manager available to install with? Cached — the answer
// can't change while the app runs, and this is called from the UI.
let wingetPath;
function findWinget() {
  if (wingetPath !== undefined) return wingetPath;
  wingetPath = null;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const candidates = [local && path.join(local, "Microsoft", "WindowsApps", "winget.exe")].filter(Boolean);
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) { wingetPath = c; break; }
      } catch { /* keep looking */ }
    }
  }
  return wingetPath;
}

/** Status of every optional engine. Safe to call often; each check is a few stat()s. */
function engineStatus(settingsObj = {}) {
  return Object.values(ENGINES).map((e) => {
    let path = null;
    try {
      path = e.locate(settingsObj) || null;
    } catch {
      path = null;
    }
    return {
      id: e.id,
      name: e.name,
      needed: e.needed,
      alternative: e.alternative || null,
      url: e.url,
      settingKey: e.settingKey,
      found: Boolean(path),
      path,
    };
  });
}

/** Just the engines that are missing — what the first-run notice renders from. */
const missingEngines = (settingsObj) => engineStatus(settingsObj).filter((e) => !e.found);

/**
 * Install an engine through Windows Package Manager.
 *
 * Deliberately narrow: the id must name a known engine, and the package id is
 * taken from the table above — never from the caller — so this cannot be used
 * to install arbitrary software. execFile with an argument array means there is
 * no shell to inject into. Runs only when the user clicks Install.
 */
function installEngine(id, onOutput) {
  return new Promise((resolve) => {
    const engine = ENGINES[id];
    if (!engine) return resolve({ ok: false, error: `Unknown component: ${id}` });
    if (!engine.winget) {
      return resolve({ ok: false, error: `${engine.name} has no Windows Package Manager entry — use the download page.` });
    }
    const exe = findWinget();
    if (!exe) {
      return resolve({ ok: false, error: "Windows Package Manager (winget) isn't available on this PC — use the download page." });
    }

    const child = execFile(
      exe,
      [
        "install", "--id", engine.winget, "--exact",
        "--accept-package-agreements", "--accept-source-agreements",
        "--disable-interactivity",
      ],
      { timeout: 30 * 60 * 1000, maxBuffer: 1 << 24 },
      (err, stdout, stderr) => {
        if (err) {
          const text = (stderr || stdout || err.message || "").toString().trim();
          resolve({ ok: false, error: text.split("\n").slice(-3).join(" ").slice(0, 300) || "Install failed." });
        } else {
          resolve({ ok: true });
        }
      }
    );
    // winget reports progress on stdout; pass it through so the UI isn't silent
    // for several minutes on a 400 MB download.
    child.stdout?.on("data", (d) => onOutput?.(String(d)));
    child.stderr?.on("data", (d) => onOutput?.(String(d)));
  });
}

const canInstall = () => Boolean(findWinget());

module.exports = { ENGINES, engineStatus, missingEngines, isEngine, installEngine, canInstall };
