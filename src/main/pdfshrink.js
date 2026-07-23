// Built-in PDF shrinker — no Ghostscript, no external engine.
//
// Ghostscript compresses a PDF *structurally*: it downsamples the embedded
// images and rewrites the streams while leaving the text as text. Reproducing
// that in pure JS would mean parsing every image XObject, filter, and colour
// space — a large, fragile job.
//
// This takes the other honest route: render each page and store it as one JPEG
// at a chosen DPI and quality. That reliably shrinks the files people actually
// need shrunk (scans, image-heavy exports, phone-photo PDFs), needs nothing
// installed, and is MIT-clean.
//
// The trade-off is real and is stated plainly in the tool's description: pages
// become pictures, so text stops being selectable or searchable. For a
// structure-preserving squeeze, the Ghostscript tool is still the right one.

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { openDocument } = require("./pdfjs");

const MIN_DPI = 36;
const MAX_DPI = 300;

const clampDpi = (dpi) => Math.min(MAX_DPI, Math.max(MIN_DPI, Number(dpi) || 120));
const clampQuality = (q) => Math.min(0.95, Math.max(0.2, Number(q) || 0.6));

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {object} options  { dpi, quality (0-1), grayscale, skipIfLarger }
 */
async function shrinkPdf(inputPath, outputPath, options = {}, onProgress, opts = {}) {
  const dpi = clampDpi(options.dpi);
  const quality = clampQuality(options.quality);
  const grayscale = !!options.grayscale;
  const skipIfLarger = options.skipIfLarger !== false; // default on

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

  const out = await PDFDocument.create();
  const scale = dpi / 72;
  const total = pdf.numPages;

  for (let n = 1; n <= total; n += 1) {
    if (opts.signal?.aborted) throw new Error("Cancelled");
    const page = await pdf.getPage(n);

    // Points, for the output page — so the shrunk PDF keeps its physical size.
    const pt = page.getViewport({ scale: 1 });
    const view = page.getViewport({ scale });

    const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha; paint white so transparent regions aren't black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view }).promise;

    // Encode from the canvas' raw pixels with sharp, in both colour and grey.
    // Using canvas.toBuffer("image/jpeg") for one and sharp for the other means
    // two different encoders whose quality scales don't agree — so the same
    // `quality` value would produce wildly different files depending on the
    // greyscale toggle. One encoder keeps the setting meaningful, and mozjpeg
    // buys extra compression at no quality cost.
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let frame = sharp(Buffer.from(px.data.buffer, px.data.byteOffset, px.data.byteLength), {
      raw: { width: canvas.width, height: canvas.height, channels: 4 },
    });
    if (grayscale) frame = frame.grayscale();
    const jpeg = await frame.jpeg({ quality: Math.round(quality * 100), mozjpeg: true }).toBuffer();

    const img = await out.embedJpg(jpeg);
    const p = out.addPage([pt.width, pt.height]);
    p.drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });

    onProgress?.(n / total);
  }

  out.setProducer("Jdot Utilities");
  const saved = await out.save();

  const before = (await fs.promises.stat(inputPath)).size;
  const after = saved.length;

  // Rasterizing a text-only PDF can easily make it bigger. Silently handing back
  // a larger "compressed" file is the one outcome nobody wants, so by default
  // fall back to the original instead.
  if (skipIfLarger && after >= before) {
    await fs.promises.copyFile(inputPath, outputPath);
    return { outputPath, pages: total, before, after: before, shrunk: false };
  }

  await fs.promises.writeFile(outputPath, saved);
  return { outputPath, pages: total, before, after, shrunk: true };
}

module.exports = { shrinkPdf, clampDpi, clampQuality };
