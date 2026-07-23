// PDF operations that aren't format conversion. Pure JS via pdf-lib — offline.

const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, PDFName, degrees } = require("pdf-lib");
const { parsePageSpec, pageIndices, complementIndices } = require("./pagespec");

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

  out.setProducer("Jdot Utilities");
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

// Build a new document from a subset of another's pages, in a given order.
// Centralizes the copyPages dance so extract/delete/split stay one-liners.
async function pagesToNewDoc(src, indices) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  out.setProducer("Jdot Utilities");
  out.setCreationDate(new Date());
  return out;
}

/**
 * Split one PDF into several. `mode`:
 *   "each"    one file per page
 *   "every"   groups of `size` pages
 *   "ranges"  one file per comma-separated range in `spec` (e.g. "1-3,4-6")
 *
 * `allocate(suffix, ext)` comes from the explode runner and returns a
 * collision-safe path. Returns { outputs, warnings }.
 */
async function splitPdf(inputPath, { mode = "each", size = 1, spec = "" } = {}, allocate, onProgress, opts = {}) {
  const src = await loadPdf(inputPath, path.basename(inputPath));
  const total = src.getPageCount();

  // Each group is a list of 0-based indices that becomes one output file.
  let groups;
  if (mode === "ranges") {
    const terms = String(spec).split(",").map((s) => s.trim()).filter(Boolean);
    if (!terms.length) throw new Error("Enter at least one range, e.g. 1-3, 4-6.");
    groups = terms.map((t) => parsePageSpec(t, total).map((p) => p - 1));
  } else if (mode === "every") {
    const n = Math.max(1, Math.floor(size));
    groups = [];
    for (let i = 0; i < total; i += n) {
      groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    }
  } else {
    groups = Array.from({ length: total }, (_, i) => [i]);
  }

  const outputs = [];
  for (let g = 0; g < groups.length; g += 1) {
    if (opts.signal?.aborted) throw new Error("Cancelled");
    const out = await pagesToNewDoc(src, groups[g]);
    // Label single-page outputs by page number; multi-page by 1-based sequence.
    const suffix = groups[g].length === 1 ? `p${groups[g][0] + 1}` : `part${g + 1}`;
    const target = allocate(suffix, "pdf");
    await fs.promises.writeFile(target, await out.save());
    outputs.push(target);
    onProgress?.((g + 1) / groups.length);
  }
  return { outputs };
}

/** Keep only the pages named by `spec` (1-based), in that order, to one file. */
async function extractPages(inputPath, outputPath, spec, onProgress) {
  const src = await loadPdf(inputPath, path.basename(inputPath));
  const idx = pageIndices(spec, src.getPageCount());
  if (!idx.length) throw new Error("That range selected no pages.");
  onProgress?.(0.4);
  const out = await pagesToNewDoc(src, idx);
  await fs.promises.writeFile(outputPath, await out.save());
  onProgress?.(1);
  return { outputPath, pages: idx.length };
}

/** Remove the pages named by `spec`, keeping the rest, to one file. */
async function deletePages(inputPath, outputPath, spec, onProgress) {
  const src = await loadPdf(inputPath, path.basename(inputPath));
  const total = src.getPageCount();
  const keep = complementIndices(spec, total);
  if (!keep.length) throw new Error("That would delete every page.");
  if (keep.length === total) throw new Error("That range matched no pages to delete.");
  onProgress?.(0.4);
  const out = await pagesToNewDoc(src, keep);
  await fs.promises.writeFile(outputPath, await out.save());
  onProgress?.(1);
  return { outputPath, pages: keep.length, removed: total - keep.length };
}

/**
 * Rotate pages by a multiple of 90 degrees. `spec` limits which pages (default
 * all). Rotation is relative to each page's existing rotation, so it composes.
 */
async function rotatePages(inputPath, outputPath, angle, spec, onProgress) {
  const turn = ((Math.round(Number(angle) / 90) * 90) % 360 + 360) % 360;
  if (turn === 0) throw new Error("Pick a rotation of 90, 180, or 270 degrees.");

  const src = await loadPdf(inputPath, path.basename(inputPath));
  const total = src.getPageCount();
  const targets = new Set(parsePageSpec(spec || "", total));
  const pages = src.getPages();

  pages.forEach((page, i) => {
    if (!targets.has(i + 1)) return;
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + turn) % 360));
  });
  onProgress?.(0.6);

  // Re-save through a copy so metadata stays clean (see loadPdf's note).
  src.setProducer("Jdot Utilities");
  await fs.promises.writeFile(outputPath, await src.save());
  onProgress?.(1);
  return { outputPath, pages: targets.size, angle: turn };
}

module.exports = {
  mergePdfs,
  pageCount,
  inspect,
  loadPdf,
  splitPdf,
  extractPages,
  deletePages,
  rotatePages,
};
