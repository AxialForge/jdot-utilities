// Ghostscript sidecar — PDF compression and PDF/A (archival) conversion. pdf-lib
// can't do either (compression needs image downsampling; PDF/A needs embedded
// fonts, ICC color, and XMP), so this shells out to Ghostscript.
//
// Resolution order lets the same code work bundled or with an installed copy:
//   1. a bundled binary in resources/bin/ (the packaged app ships one there),
//   2. an installed Ghostscript (auto-detected, like LibreOffice),
//   3. a path override the user set in Settings.
// Still fully offline — Ghostscript makes no network calls here.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IS_WIN = process.platform === "win32";
const EXE = IS_WIN ? ["gswin64c.exe", "gswin32c.exe"] : ["gs"];

function firstExisting(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

// Auto-detect an installed Ghostscript. On Windows it installs to
// C:\Program Files\gs\gs<version>\bin\gswin64c.exe (version dir varies).
function detectInstalled() {
  if (IS_WIN) {
    for (const root of ["C:\\Program Files\\gs", "C:\\Program Files (x86)\\gs"]) {
      let versions = [];
      try { versions = fs.readdirSync(root).sort().reverse(); } catch { continue; }
      for (const v of versions) {
        const hit = firstExisting(EXE.map((e) => path.join(root, v, "bin", e)));
        if (hit) return hit;
      }
    }
    return null;
  }
  return firstExisting(["/usr/bin/gs", "/usr/local/bin/gs", "/opt/homebrew/bin/gs", "/opt/local/bin/gs"]);
}

function locateGs(override) {
  if (override && fs.existsSync(override)) return override;
  const bundled = process.resourcesPath
    ? firstExisting(EXE.map((e) => path.join(process.resourcesPath, "bin", e)))
    : null;
  return bundled || detectInstalled();
}

function runGs(gsPath, args) {
  return new Promise((resolve, reject) => {
    execFile(gsPath, args, { timeout: 180000, maxBuffer: 1 << 24 }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || "Ghostscript failed").toString().trim().slice(0, 400)));
      else resolve();
    });
  });
}

const BASE = ["-dBATCH", "-dNOPAUSE", "-dSAFER", "-dQUIET", "-sDEVICE=pdfwrite"];

// PDFSETTINGS presets, coarsest → finest. `screen` downsamples hardest.
const QUALITY = new Set(["screen", "ebook", "printer", "prepress"]);

/**
 * Compress a PDF by re-writing it with image downsampling. `quality` picks the
 * Ghostscript preset (screen/ebook/printer/prepress). Reports the size change.
 */
async function compressPdf(gsPath, inputPath, outputPath, { quality = "ebook" } = {}) {
  const q = QUALITY.has(quality) ? quality : "ebook";
  await runGs(gsPath, [
    ...BASE,
    "-dCompatibilityLevel=1.6",
    `-dPDFSETTINGS=/${q}`,
    `-sOutputFile=${outputPath}`,
    inputPath,
  ]);
  if (!fs.existsSync(outputPath)) throw new Error("Ghostscript produced no output.");
  const before = fs.statSync(inputPath).size;
  const after = fs.statSync(outputPath).size;
  return { outputPath, before, after, saved: before - after };
}

// PDF/A conformance level -> Ghostscript's -dPDFA value.
const PDFA_LEVEL = { "pdfa-1b": 1, "pdfa-2b": 2, "pdfa-3b": 3 };

/**
 * Convert to PDF/A (archival). `level` is one of pdfa-1b / pdfa-2b / pdfa-3b.
 * `quality` optionally downsamples images at the same time.
 */
async function toPdfA(gsPath, inputPath, outputPath, { level = "pdfa-2b", quality } = {}) {
  const n = PDFA_LEVEL[level] || 2;
  const args = [
    ...BASE,
    `-dPDFA=${n}`,
    "-dPDFACompatibilityPolicy=1",
    "-sColorConversionStrategy=RGB",
    "-sProcessColorModel=DeviceRGB",
  ];
  if (quality && QUALITY.has(quality)) args.push(`-dPDFSETTINGS=/${quality}`);
  args.push(`-sOutputFile=${outputPath}`, inputPath);
  await runGs(gsPath, args);
  if (!fs.existsSync(outputPath)) throw new Error("Ghostscript produced no PDF/A output.");
  return { outputPath, level, before: fs.statSync(inputPath).size, after: fs.statSync(outputPath).size };
}

module.exports = { locateGs, detectInstalled, compressPdf, toPdfA, QUALITY: [...QUALITY], PDFA_LEVELS: Object.keys(PDFA_LEVEL) };
