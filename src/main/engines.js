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

const { locateSoffice } = require("./office");
const { locateGs } = require("./gs");

const ENGINES = {
  libreoffice: {
    id: "libreoffice",
    name: "LibreOffice",
    needed: "Word, spreadsheet, and presentation conversions",
    url: "https://www.libreoffice.org/",
    settingKey: "libreOfficePath",
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
    locate: (s) => locateGs(s.ghostscriptPath),
  },
};

const isEngine = (id) => Object.prototype.hasOwnProperty.call(ENGINES, id);

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

module.exports = { ENGINES, engineStatus, missingEngines, isEngine };
