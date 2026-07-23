// Images -> one PDF, one image per page. Offline: sharp normalizes anything it
// can read into PNG/JPEG bytes, pdf-lib embeds them. pdf-lib itself only embeds
// PNG and JPEG, so sharp is the adapter for everything else (webp, tiff, gif…).

const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");

const PAGE = {
  // width x height in PDF points (1/72"), portrait.
  Letter: [612, 792],
  A4: [595.28, 841.89],
  Legal: [612, 1008],
};

// Formats pdf-lib embeds directly; everything else routes through sharp -> png.
const DIRECT = new Set([".jpg", ".jpeg", ".png"]);

async function toEmbeddable(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (DIRECT.has(ext)) {
    const bytes = await fs.promises.readFile(inputPath);
    return { bytes, kind: ext === ".png" ? "png" : "jpg" };
  }
  // sharp is already a dependency (image converter). Flatten alpha onto white so
  // a transparent PNG/WebP doesn't turn black on the page.
  const sharp = require("sharp");
  const bytes = await sharp(inputPath).flatten({ background: "#ffffff" }).png().toBuffer();
  return { bytes, kind: "png" };
}

/**
 * @param {string[]} inputPaths  images in the desired page order
 * @param {string}   outputPath  where to write the PDF
 * @param {object}   options     { pageSize: "Letter"|"A4"|"Legal"|"Fit", margin: pts }
 */
async function imagesToPdf(inputPaths, outputPath, options = {}, onProgress, opts = {}) {
  if (!inputPaths?.length) throw new Error("Add at least one image.");
  const doc = await PDFDocument.create();
  const sizeName = options.pageSize || "Fit";
  const margin = Number.isFinite(options.margin) ? Math.max(0, options.margin) : 18;
  const warnings = [];

  for (let i = 0; i < inputPaths.length; i += 1) {
    if (opts.signal?.aborted) throw new Error("Cancelled");
    const name = path.basename(inputPaths[i]);

    let img;
    try {
      const { bytes, kind } = await toEmbeddable(inputPaths[i]);
      img = kind === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch (err) {
      warnings.push(`Skipped ${name}: ${err.message}`);
      continue;
    }

    if (sizeName === "Fit") {
      // Page is exactly the image size — no scaling, no borders.
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const [pw, ph] = PAGE[sizeName] || PAGE.Letter;
      const page = doc.addPage([pw, ph]);
      const maxW = pw - margin * 2;
      const maxH = ph - margin * 2;
      // Contain: scale down to fit, never up past the image's natural size.
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    onProgress?.((i + 1) / inputPaths.length);
  }

  if (doc.getPageCount() === 0) throw new Error("None of the images could be read.");

  doc.setProducer("JDot Utilities");
  doc.setCreationDate(new Date());
  await fs.promises.writeFile(outputPath, await doc.save());
  return { outputPath, pages: doc.getPageCount(), warnings };
}

module.exports = { imagesToPdf, PAGE_SIZES: Object.keys(PAGE) };
