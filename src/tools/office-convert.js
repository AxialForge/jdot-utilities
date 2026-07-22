// Office document conversion via LibreOffice. Split into three families so the
// UI only ever offers valid pairs (each family converts within itself and to PDF).
// Exports an array of tool descriptors — the registry accepts that.

const { locateSoffice, convertOffice } = require("../main/office");
const settings = require("../main/settings");

function make(id, name, description, inputs, outputs) {
  return {
    id,
    name,
    category: "Office",
    description,
    inputFormats: inputs,
    outputFormats: outputs,
    options: [],
    async convert({ inputPath, outputPath, outputFormat, onProgress }) {
      const soffice = locateSoffice(settings.readSync().libreOfficePath);
      await convertOffice({ inputPath, outputPath, targetExt: outputFormat, sofficePath: soffice, onProgress });
    },
  };
}

module.exports = [
  make(
    "office-word",
    "Word Documents",
    "Convert Word/OpenDocument text (docx, doc, odt, rtf) and to PDF. Requires LibreOffice.",
    ["docx", "doc", "odt", "rtf"],
    ["pdf", "docx", "odt", "rtf"]
  ),
  make(
    "office-sheet",
    "Spreadsheets",
    "Convert spreadsheets (xlsx, xls, ods, csv) and to PDF. Requires LibreOffice.",
    ["xlsx", "xls", "ods", "csv"],
    ["pdf", "xlsx", "ods", "csv"]
  ),
  make(
    "office-slides",
    "Presentations",
    "Convert presentations (pptx, ppt, odp) and to PDF. Requires LibreOffice.",
    ["pptx", "ppt", "odp"],
    ["pdf", "pptx", "odp"]
  ),
];
