// Small page thumbnails for the page picker, so Rotate / Delete / Extract can
// be driven by looking at the document instead of typing page numbers blind.
//
// Same engine as pdfraster.js (pdfjs onto a @napi-rs/canvas surface), but tuned
// for many small images at once: low scale, JPEG, and a hard cap, since a
// 500-page document would otherwise spend a long time producing pictures nobody
// scrolled to. Returns data URLs so the renderer can use them directly without
// touching the filesystem.

const fs = require("node:fs");
const path = require("node:path");
const { openDocument } = require("./pdfjs");

const DEFAULT_WIDTH = 116; // css px; the grid cell size
const DEFAULT_LIMIT = 150; // pages rendered before we stop and say so
const MAX_WIDTH = 400;

/**
 * @param {string} inputPath
 * @param {object} options { width, limit, from } — `from` is a 1-based offset
 *        so a long document can be paged through in chunks.
 * @returns {{ total, from, thumbs: [{page, url, w, h, rotation}], truncated }}
 */
async function pdfThumbnails(inputPath, options = {}, opts = {}) {
  const width = Math.min(MAX_WIDTH, Math.max(40, Number(options.width) || DEFAULT_WIDTH));
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
  const from = Math.max(1, Number(options.from) || 1);

  const bytes = new Uint8Array(await fs.promises.readFile(inputPath));
  let pdf;
  try {
    pdf = await openDocument(bytes);
  } catch (err) {
    throw new Error(`${path.basename(inputPath)}: not a readable PDF (${err.message})`);
  }

  let createCanvas;
  try {
    ({ createCanvas } = require("@napi-rs/canvas"));
  } catch {
    throw new Error("Image rendering component is unavailable in this build.");
  }

  const total = pdf.numPages;
  const last = Math.min(total, from + limit - 1);
  const thumbs = [];

  for (let n = from; n <= last; n += 1) {
    if (opts.signal?.aborted) break;
    const page = await pdf.getPage(n);

    // scale:1 gives points; derive the scale that lands on the target width.
    // getViewport already accounts for the page's own /Rotate, so a landscape
    // page comes back landscape and the grid cell matches what the user sees.
    const natural = page.getViewport({ scale: 1 });
    const scale = width / natural.width;
    const view = page.getViewport({ scale });

    const canvas = createCanvas(Math.max(1, Math.ceil(view.width)), Math.max(1, Math.ceil(view.height)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view }).promise;

    thumbs.push({
      page: n,
      url: canvas.toDataURL("image/jpeg", 0.72),
      w: canvas.width,
      h: canvas.height,
      rotation: natural.rotation || 0,
    });
  }

  return { total, from, thumbs, truncated: last < total };
}

module.exports = { pdfThumbnails, DEFAULT_WIDTH, DEFAULT_LIMIT };
