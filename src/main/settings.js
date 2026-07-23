// Persistent settings, stored as JSON in the OS user-data folder. A synchronous
// reader exists so main.js can decide on hardware acceleration before app-ready.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  theme: "grey", // "light" | "black" | "grey"
  defaultOutputDir: null, // null = save next to each source file
  pdfPageSize: "Letter", // Letter | A4 | Legal | Tabloid
  concurrency: 4, // parallel conversions for large batches
  hardwareAcceleration: "auto", // auto | on | off
  recurseFolders: false, // "Add folder" pulls files from nested subfolders too
  libreOfficePath: null, // override path to soffice; null = auto-detect
  ghostscriptPath: null, // override path to gs; null = auto-detect (Compress / PDF-A)
  hideEngineNotice: false, // dismissed the "optional engine missing" banner
};

let filePath = null; // resolved once we know userData

function setPath(userDataDir) {
  filePath = path.join(userDataDir, "settings.json");
}

function readSync() {
  if (!filePath) return { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(patch) {
  const merged = { ...readSync(), ...patch };
  try {
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save settings:", err.message);
  }
  return merged;
}

module.exports = { DEFAULTS, setPath, readSync, write };
