// PDF operations that aren't format conversion. Pure JS via pdf-lib — offline.

const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, PDFName } = require("pdf-lib");

/**
 * Load a PDF, failing with a message a user can act on.
 *
 * pdf-lib's `ignoreEncryption` only skips the *check*; it cannot decrypt content
 * streams. Loading a password-protected file with it set yields a document whose
 * pages are unreadable garbage rather than an error, so encrypted input is
 * rejected up front instead.
 */
async function loadPdf(inputPath, label) {
  let bytes;
  try {
    bytes = await fs.promises.readFile(inputPath);
  } catch (err) {
    throw new Error(`${label}: cannot read file (${err.code || err.message})`);
  }
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw new Error(`${label}: not a PDF file`);
  }
  let doc;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      // pdf-lib's constructor calls updateInfoDict() when this is true (its
      // default), which rewrites Producer and ModificationDate the moment a file
      // is opened. A file utility must not silently restamp the user's metadata,
      // and any in-place operation (rotate, split, delete pages) would persist it.
      updateMetadata: false,
    });
  } catch (err) {
    throw new Error(`${label}: corrupt or unreadable PDF (${err.message})`);
  }
  if (doc.isEncrypted) {
    throw new Error(`${label}: password-protected. Remove the password first.`);
  }
  return doc;
}

/**
 * Merge PDFs in the given order into one file.
 *
 * Known limits of a pdf-lib page copy, surfaced in the returned `warnings` so the
 * UI can tell the user rather than silently changing their document:
 *  - Interactive form fields do not survive. `copyPages` brings page content and
 *    widget annotations across, but the AcroForm dictionary that makes them
 *    fillable belongs to the source document and is not copied.
 *  - Bookmarks/outlines are not carried over.
 */
async function mergePdfs(inputPaths, outputPath, onProgress, { signal } = {}) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error("Merging needs at least two PDFs.");
  }

  const out = await PDFDocument.create();
  const warnings = [];
  const sources = [];
  let hadForm = false;
  let hadOutline = false;

  for (let i = 0; i < inputPaths.length; i += 1) {
    if (signal?.aborted) throw new Error("Cancelled");

    const label = path.basename(inputPaths[i]);
    const src = await loadPdf(inputPaths[i], label);

    // Detect what the copy is about to drop. Best-effort: never fail over this.
    try {
      if (src.catalog.lookup(PDFName.of("AcroForm"))) hadForm = true;
      if (src.catalog.lookup(PDFName.of("Outlines"))) hadOutline = true;
    } catch {
      /* ignore */
    }

    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
    sources.push({ file: label, pages: pages.length });
    onProgress?.((i + 1) / inputPaths.length);
  }

  if (hadForm) {
    warnings.push("Form fields were flattened — pdf-lib cannot carry interactive fields across a merge.");
  }
  if (hadOutline) {
    warnings.push("Bookmarks from the source files were not carried over.");
  }

  out.setProducer("JDot Utilities");
  out.setCreationDate(new Date());

  const merged = await out.save();
  await fs.promises.writeFile(outputPath, merged);
  return { outputPath, pages: out.getPageCount(), sources, warnings };
}

/** Page count for a single PDF, or null if it can't be read. */
async function pageCount(inputPath) {
  try {
    const doc = await loadPdf(inputPath, path.basename(inputPath));
    return doc.getPageCount();
  } catch {
    return null;
  }
}

/**
 * Inspect a PDF for the merge list: page count plus why it might be unusable.
 * Returns { pages, error } where `error` is a user-facing reason, or null.
 */
async function inspect(inputPath) {
  try {
    const doc = await loadPdf(inputPath, path.basename(inputPath));
    return { pages: doc.getPageCount(), error: null };
  } catch (err) {
    return { pages: null, error: err.message };
  }
}

module.exports = { mergePdfs, pageCount, inspect, loadPdf };
