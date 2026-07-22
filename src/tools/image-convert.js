// Image converter powered by sharp (libvips) — modern formats, fast, high quality.
// HEIC/HEIF decode goes through heic-convert (pure JS) since sharp's prebuilt
// libvips usually omits HEIF decode. Everything runs offline.

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const heicConvert = require("heic-convert");

const INPUTS = ["png", "jpg", "jpeg", "webp", "avif", "tiff", "gif", "svg", "heic", "heif"];
const OUTPUTS = ["png", "jpg", "jpeg", "webp", "avif", "tiff", "gif"];

const normOut = (f) => (f === "jpg" ? "jpeg" : f);

module.exports = {
  id: "image-convert",
  name: "Image Converter",
  category: "Image",
  description: "Convert between image formats (incl. WebP, AVIF, HEIC), with optional resize and quality.",

  inputFormats: INPUTS,
  outputFormats: OUTPUTS,

  options: [
    { key: "maxWidth", label: "Max width (px, 0 = keep original)", type: "number", min: 0, max: 40000, default: 0 },
    { key: "quality", label: "Quality (JPEG/WebP/AVIF)", type: "number", min: 1, max: 100, default: 90 },
  ],

  async convert({ inputPath, outputPath, outputFormat, options, onProgress }) {
    const inExt = (path.extname(inputPath).slice(1) || "").toLowerCase();
    onProgress?.(0.1);

    let img;
    if (inExt === "heic" || inExt === "heif") {
      const buf = await heicConvert({ buffer: fs.readFileSync(inputPath), format: "PNG" });
      img = sharp(buf);
    } else {
      img = sharp(inputPath, { animated: true, limitInputPixels: false });
    }
    onProgress?.(0.4);

    const maxWidth = Number(options?.maxWidth) || 0;
    if (maxWidth > 0) img = img.resize({ width: maxWidth, withoutEnlargement: true });

    const quality = Math.min(100, Math.max(1, Number(options?.quality) || 90));
    img = img.toFormat(normOut(outputFormat), { quality });

    onProgress?.(0.8);
    await img.toFile(outputPath);
    onProgress?.(1);
  },
};
