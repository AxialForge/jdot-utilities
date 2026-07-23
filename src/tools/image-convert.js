// Image converter powered by sharp (libvips) — modern formats, fast, high quality.
//
// Three formats need help from our own code because this sharp build can't do
// them (verified: no magick loader):
//   HEIC/HEIF in  -> heic-convert (sharp's prebuilt libvips omits HEIF decode)
//   BMP in/out    -> src/main/bmp.js
//   ICO in/out    -> src/main/ico.js  (out = one PNG frame per icon size)
// Everything runs offline.

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const heicConvert = require("heic-convert");
const { encodeBmp, decodeBmp } = require("../main/bmp");
const { encodeIco, decodeIco, STANDARD_SIZES } = require("../main/ico");

const INPUTS = ["png", "jpg", "jpeg", "webp", "avif", "tiff", "gif", "svg", "heic", "heif", "bmp", "ico"];
const OUTPUTS = ["png", "jpg", "jpeg", "webp", "avif", "tiff", "gif", "bmp", "ico"];

const normOut = (f) => (f === "jpg" ? "jpeg" : f);

// Icon size sets. Windows picks the closest frame, so shipping several is normal.
const ICO_SETS = {
  "Standard (16, 32, 48, 256)": [16, 32, 48, 256],
  "All sizes (16 - 256)": STANDARD_SIZES,
  "Small only (16, 32)": [16, 32],
  "256 only": [256],
};
const DEFAULT_ICO_SET = "Standard (16, 32, 48, 256)";

// Common downscale targets, so the usual job is one pick instead of typing.
const RESIZE_PRESETS = {
  "Original size": 0,
  "3840 px (4K)": 3840,
  "1920 px (1080p)": 1920,
  "1280 px (720p)": 1280,
  "800 px (web)": 800,
  "400 px (thumbnail)": 400,
};
const DEFAULT_RESIZE = "Original size";

// Build a sharp instance from any supported input, including the three formats
// libvips can't open on its own.
async function openImage(inputPath) {
  const ext = (path.extname(inputPath).slice(1) || "").toLowerCase();

  if (ext === "heic" || ext === "heif") {
    return sharp(await heicConvert({ buffer: fs.readFileSync(inputPath), format: "PNG" }));
  }
  if (ext === "bmp") {
    const { data, width, height, channels } = decodeBmp(fs.readFileSync(inputPath));
    return sharp(data, { raw: { width, height, channels } });
  }
  if (ext === "ico") {
    const frame = decodeIco(fs.readFileSync(inputPath));
    return frame.png
      ? sharp(frame.png)
      : sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: frame.channels } });
  }
  return sharp(inputPath, { animated: true, limitInputPixels: false });
}

module.exports = {
  id: "image-convert",
  name: "Image Converter",
  category: "Image",
  description:
    "Convert between image formats (incl. WebP, AVIF, HEIC, BMP, and Windows ICO), with optional resize and quality.",

  inputFormats: INPUTS,
  outputFormats: OUTPUTS,

  options: [
    { key: "resize", label: "Resize", type: "select", choices: Object.keys(RESIZE_PRESETS), default: DEFAULT_RESIZE },
    { key: "maxWidth", label: "Custom max width (px, 0 = use preset above)", type: "number", min: 0, max: 40000, default: 0 },
    { key: "quality", label: "Quality (JPEG/WebP/AVIF)", type: "number", min: 1, max: 100, default: 90 },
    { key: "icoSizes", label: "Icon sizes (ICO output only)", type: "select", choices: Object.keys(ICO_SETS), default: DEFAULT_ICO_SET },
  ],

  async convert({ inputPath, outputPath, outputFormat, options, onProgress }) {
    onProgress?.(0.1);
    let img = await openImage(inputPath);
    onProgress?.(0.35);

    const quality = Math.min(100, Math.max(1, Number(options?.quality) || 90));

    // ── ICO: square frames at several sizes, each a PNG ──
    if (outputFormat === "ico") {
      const sizes = ICO_SETS[options?.icoSizes] || ICO_SETS[DEFAULT_ICO_SET];
      // Flatten to one PNG first; a sharp instance can only be consumed once.
      const base = await img.png().toBuffer();
      const frames = [];
      for (let i = 0; i < sizes.length; i += 1) {
        const size = sizes[i];
        frames.push({
          size,
          png: await sharp(base)
            .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer(),
        });
        onProgress?.(0.35 + (0.55 * (i + 1)) / sizes.length);
      }
      await fs.promises.writeFile(outputPath, encodeIco(frames));
      onProgress?.(1);
      return;
    }

    // A custom width wins over the preset; 0 on both means leave it alone.
    const width = Number(options?.maxWidth) || RESIZE_PRESETS[options?.resize] || 0;
    if (width > 0) img = img.resize({ width, withoutEnlargement: true });
    onProgress?.(0.6);

    // ── BMP: hand libvips' raw pixels to our encoder ──
    if (outputFormat === "bmp") {
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      await fs.promises.writeFile(
        outputPath,
        encodeBmp({ data, width: info.width, height: info.height, channels: info.channels })
      );
      onProgress?.(1);
      return;
    }

    await img.toFormat(normOut(outputFormat), { quality }).toFile(outputPath);
    onProgress?.(1);
  },
};
