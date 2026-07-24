// LibreOffice sidecar. Jdot Utilities doesn't bundle LibreOffice (it's ~400 MB); instead
// it uses an installed copy. Each conversion runs headless with a unique user
// profile so batches can run several at once without clobbering each other.
// Still fully offline — LibreOffice makes no network calls here.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CANDIDATES = {
  win32: [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ],
  darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"],
  linux: ["/usr/bin/soffice", "/usr/bin/libreoffice", "/opt/libreoffice/program/soffice"],
};

// Returns an absolute path to soffice, or null if none can be found.
function locateSoffice(override) {
  if (override && fs.existsSync(override)) return override;
  for (const p of CANDIDATES[process.platform] || []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function convertOffice({ inputPath, outputPath, targetExt, sofficePath, onProgress }) {
  if (!sofficePath) {
    throw new Error("LibreOffice not found. Install it, or set its path in Settings.");
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-lo-"));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-loprof-"));
  // UserInstallation must be a real file URL. Concatenating "file://" onto a
  // Windows path yields "file://C:\Users\..." — wrong scheme form AND backslashes
  // — which LibreOffice rejects, so every Office conversion failed on Windows.
  // pathToFileURL produces "file:///C:/Users/..." correctly on every platform.
  const profile = pathToFileURL(profileDir).href;

  // Both temp dirs are cleaned in `finally`. A LibreOffice profile is not small,
  // and previously the profile was never removed at all while the output dir was
  // only removed on the success path — so every failed conversion, and every
  // conversion full stop, left directories behind in the user's temp folder.
  try {
    onProgress?.(0.2);

    await new Promise((resolve, reject) => {
      execFile(
        sofficePath,
        ["--headless", "-env:UserInstallation=" + profile, "--convert-to", targetExt, "--outdir", outDir, inputPath],
        { timeout: 120000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error((stderr || err.message || "LibreOffice failed").toString().trim()));
          else resolve();
        }
      );
    });
    onProgress?.(0.85);

    const produced = path.join(outDir, path.basename(inputPath, path.extname(inputPath)) + "." + targetExt);
    if (!fs.existsSync(produced)) {
      throw new Error(`LibreOffice produced no .${targetExt} output (unsupported pair?).`);
    }
    fs.copyFileSync(produced, outputPath);
    onProgress?.(1);
  } finally {
    for (const dir of [outDir, profileDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = { locateSoffice, convertOffice, CANDIDATES };
