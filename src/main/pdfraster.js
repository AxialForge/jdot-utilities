// PDF -> raster images, one file per page, via pdfjs rendering onto a
// @napi-rs/canvas surface. Prebuilt native (like sharp), runs under plain Node,
// so it is covered by `npm test`.

const fs = require("node:fs");
const path = require("node:path");
const { openDocument } = require("./pdfjs");
const { parsePageSpec } = require("./pagespec");

const MIN_SCALE = 0.5;
const MAX_SCALE = 6; // ~432 DPI; guards against a huge canvas from a silly DPI

function clampScale(dpi) {
  const s = (Number(dpi) || 150) / 72;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * @param {string} inputPath          source PDF
 * @param {object} options            { format:"png"|"jpg", dpi:number, pages:"1-3,5" }
 * @param {(suffix,ext)=>string} allocate  collision-safe path from the explode runner
 */
async function rasterizePdf(inputPath, options = {}, allocate, onProgress, opts = {}) {
  const format = options.format === "jpg" || options.format === "jpeg" ? "jpg" : "png";
  const scale = clampScale(options.dpi);

  const bytes = new Uint8Array(await fs.promises.readFile(inputPath));
  let pdf;
  try {
    pdf = await openDocument(bytes);
  } catch (err) {
    throw new Error(`${path.basename(inputPath)}: not a readable PDF (${err.message})`);
  }
  const total = pdf.numPages;

  const wanted =
    options.pages && String(options.pages).trim()
      ? parsePageSpec(options.pages, total)
      : Array.from({ length: total }, (_, i) => i + 1);

  // Require the native canvas lazily so the rest of the app (and the non-image
  // PDF paths) don't pay for loading it, and so a missing binary fails here with
  // a clear message rather than at module load.
  let createCanvas;
  try {
    ({ createCanvas } = require("@napi-rs/canvas"));
  } catch (err) {
    throw new Error("Image rendering component is unavailable in this build.");
  }

  const outputs = [];
  for (let i = 0; i < wanted.length; i += 1) {
    if (opts.signal?.aborted) throw new Error("Cancelled");
    const n = wanted[i];
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    // JPEG has no alpha; paint white so transparent PDF regions aren't black.
    if (format === "jpg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page.render({ canvasContext: ctx, viewport }).promise;

    const buf =
      format === "jpg"
        ? canvas.toBuffer("image/jpeg", 0.92)
        : canvas.toBuffer("image/png");

    const target = allocate(`p${n}`, format);
    await fs.promises.writeFile(target, buf);
    outputs.push(target);
    onProgress?.((i + 1) / wanted.length);
  }

  return { outputs };
}

module.exports = { rasterizePdf, clampScale };
