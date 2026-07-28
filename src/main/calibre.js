// Calibre sidecar — ebook conversion (EPUB, Kindle MOBI/AZW3, FB2, comics…).
// Unlike pandoc/ffmpeg, Calibre is a large multi-file application, not a single
// binary, so it is NOT bundled: it's an optional engine, installed on demand
// (winget: calibre.calibre) and auto-detected, exactly like LibreOffice. The
// conversion itself runs `ebook-convert`, which makes no network calls.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IS_WIN = process.platform === "win32";
const EXE = IS_WIN ? "ebook-convert.exe" : "ebook-convert";

function firstExisting(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

// The user's override may point straight at ebook-convert, or at the Calibre
// folder / calibre.exe next to it — accept any of those.
function resolveOverride(override) {
  if (!override) return null;
  try {
    const stat = fs.statSync(override);
    if (stat.isDirectory()) return firstExisting([path.join(override, EXE)]);
    if (path.basename(override).toLowerCase().startsWith("ebook-convert")) return override;
    // Some other file (e.g. calibre.exe) — look for ebook-convert beside it.
    return firstExisting([path.join(path.dirname(override), EXE)]) || override;
  } catch {
    return null;
  }
}

// Calibre installs to C:\Program Files\Calibre2\ on Windows.
function detectInstalled() {
  if (IS_WIN) {
    return firstExisting([
      "C:\\Program Files\\Calibre2\\" + EXE,
      "C:\\Program Files (x86)\\Calibre2\\" + EXE,
    ]);
  }
  return firstExisting(["/usr/bin/ebook-convert", "/usr/local/bin/ebook-convert", "/opt/homebrew/bin/ebook-convert"]);
}

function onPath() {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  return firstExisting(dirs.map((d) => d && path.join(d, EXE)));
}

function locateCalibre(override) {
  return resolveOverride(override) || detectInstalled() || onPath();
}

/** Convert one ebook. ebook-convert infers formats from the file extensions. */
function convertEbook(exe, inputPath, outputPath, { signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      [inputPath, outputPath],
      { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24, signal, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message || "Calibre failed").toString().trim().split("\n").slice(-3).join(" ").slice(0, 400)));
        else resolve();
      }
    );
  });
}

module.exports = { locateCalibre, convertEbook, detectInstalled };
