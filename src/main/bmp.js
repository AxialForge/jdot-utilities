// Minimal, dependency-free BMP codec.
//
// Why hand-rolled: this app's prebuilt sharp/libvips has no BMP support at all
// (verified empirically — no read, no write, and the `magick` loader is absent).
// BMP is a simple enough container that writing it here beats adding an
// unmaintained dependency, and it keeps the app pure-JS and fully offline.
//
// Scope, deliberately: uncompressed BI_RGB at 1/4/8/24/32 bpp and BI_BITFIELDS
// at 16/32 bpp — which covers essentially every BMP in the wild. RLE-compressed
// BMPs (BI_RLE8/BI_RLE4) are rare and are rejected with a clear message rather
// than decoded wrong.

const FILE_HEADER = 14;
const INFO_HEADER = 40;

// ── encode ────────────────────────────────────────────────────
//
// Writes a 24-bit BI_RGB bottom-up BMP: the most universally readable variant.
// BMP alpha is inconsistently supported across readers, so an alpha channel is
// flattened onto `background` (default white) rather than written as 32-bit and
// rendered unpredictably. Input is raw top-down RGB/RGBA, as sharp produces.
function encodeBmp({ data, width, height, channels }, { background = 255 } = {}) {
  if (!width || !height) throw new Error("BMP: zero-sized image.");
  const rowSize = ((width * 3 + 3) >> 2) << 2; // padded to a 4-byte boundary
  const pixels = rowSize * height;
  const buf = Buffer.alloc(FILE_HEADER + INFO_HEADER + pixels);

  buf.write("BM", 0, "latin1");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(FILE_HEADER + INFO_HEADER, 10); // pixel data offset
  buf.writeUInt32LE(INFO_HEADER, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive = bottom-up
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30); // BI_RGB
  buf.writeUInt32LE(pixels, 34);
  buf.writeInt32LE(2835, 38); // ~72 DPI
  buf.writeInt32LE(2835, 42);

  const base = FILE_HEADER + INFO_HEADER;
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * width * channels; // bottom-up
    let dst = base + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const i = src + x * channels;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (channels === 4) {
        const a = data[i + 3] / 255;
        r = Math.round(r * a + background * (1 - a));
        g = Math.round(g * a + background * (1 - a));
        b = Math.round(b * a + background * (1 - a));
      }
      buf[dst++] = b; buf[dst++] = g; buf[dst++] = r; // BMP stores BGR
    }
  }
  return buf;
}

// ── decode ────────────────────────────────────────────────────

// Turn a channel mask (e.g. 0x7C00) into a shift + scale so any bit layout
// normalises to 0-255.
function maskInfo(mask) {
  if (!mask) return null;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift += 1;
  const bits = ((mask >>> shift) >>> 0).toString(2).replace(/0+$/, "").length;
  const max = (1 << bits) - 1;
  return { shift, max };
}
const apply = (raw, m) => (m ? Math.round((((raw & (m.max << m.shift)) >>> m.shift) * 255) / m.max) : 0);

/** Decode a BMP buffer to raw top-down RGBA. Returns { data, width, height, channels: 4 }. */
function decodeBmp(buf) {
  if (buf.length < FILE_HEADER + 12 || buf.toString("latin1", 0, 2) !== "BM") {
    throw new Error("Not a BMP file.");
  }
  const dataOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  if (dibSize < 12) throw new Error("BMP: unsupported header.");

  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  let clrUsed = buf.readUInt32LE(46);

  if (width <= 0 || height <= 0) throw new Error("BMP: bad dimensions.");
  if (compression === 1 || compression === 2) throw new Error("BMP: RLE-compressed files aren't supported.");
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error(`BMP: unsupported bit depth (${bpp}).`);

  // Channel masks: inline for V4/V5 headers, otherwise trailing the info header.
  let masks = null;
  if (compression === 3) {
    const at = dibSize >= 52 ? FILE_HEADER + 40 : FILE_HEADER + dibSize;
    masks = {
      r: maskInfo(buf.readUInt32LE(at)),
      g: maskInfo(buf.readUInt32LE(at + 4)),
      b: maskInfo(buf.readUInt32LE(at + 8)),
      a: dibSize >= 56 ? maskInfo(buf.readUInt32LE(FILE_HEADER + 52)) : null,
    };
  }

  // Palette (indexed depths only).
  let palette = null;
  if (bpp <= 8) {
    if (!clrUsed) clrUsed = 1 << bpp;
    const at = FILE_HEADER + dibSize;
    palette = new Uint8Array(clrUsed * 4);
    for (let i = 0; i < clrUsed; i += 1) {
      const p = at + i * 4;
      if (p + 3 > buf.length) break;
      palette[i * 4] = buf[p + 2];     // R (stored BGRA)
      palette[i * 4 + 1] = buf[p + 1]; // G
      palette[i * 4 + 2] = buf[p];     // B
      palette[i * 4 + 3] = 255;
    }
  }

  const rowSize = ((bpp * width + 31) >> 5) << 2;
  if (dataOffset + rowSize * height > buf.length) throw new Error("BMP: truncated pixel data.");

  const out = Buffer.alloc(width * height * 4);
  let sawAlpha = false;

  for (let y = 0; y < height; y += 1) {
    const srcRow = dataOffset + (topDown ? y : height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, a = 255;

      if (bpp === 24) {
        const p = srcRow + x * 3;
        b = buf[p]; g = buf[p + 1]; r = buf[p + 2];
      } else if (bpp === 32) {
        const p = srcRow + x * 4;
        if (masks) {
          const v = buf.readUInt32LE(p);
          r = apply(v, masks.r); g = apply(v, masks.g); b = apply(v, masks.b);
          if (masks.a) { a = apply(v, masks.a); sawAlpha = sawAlpha || a !== 0; }
        } else {
          b = buf[p]; g = buf[p + 1]; r = buf[p + 2]; a = buf[p + 3];
          sawAlpha = sawAlpha || a !== 0;
        }
      } else if (bpp === 16) {
        const v = buf.readUInt16LE(srcRow + x * 2);
        if (masks) {
          r = apply(v, masks.r); g = apply(v, masks.g); b = apply(v, masks.b);
        } else {
          // Default 16-bit layout is X1R5G5B5.
          r = Math.round((((v >> 10) & 31) * 255) / 31);
          g = Math.round((((v >> 5) & 31) * 255) / 31);
          b = Math.round(((v & 31) * 255) / 31);
        }
      } else {
        // Indexed: 1, 4, or 8 bits per pixel, most-significant bit first.
        const per = 8 / bpp;
        const byte = buf[srcRow + Math.floor(x / per)];
        const shift = 8 - bpp * ((x % per) + 1);
        const idx = (byte >> shift) & ((1 << bpp) - 1);
        const p = idx * 4;
        r = palette[p]; g = palette[p + 1]; b = palette[p + 2];
      }

      const o = (y * width + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }

  // A 32-bit BI_RGB BMP frequently leaves the 4th byte zeroed rather than
  // meaning "fully transparent". If nothing was ever non-zero, it's opaque.
  if (bpp === 32 && !sawAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }

  return { data: out, width, height, channels: 4 };
}

const isBmp = (buf) => buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d;

module.exports = { encodeBmp, decodeBmp, isBmp };
