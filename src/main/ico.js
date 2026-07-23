// Minimal, dependency-free ICO (Windows icon) codec.
//
// sharp can't write ICO and can't read it either, so both directions live here.
// An .ico is a tiny directory of independent images; on Vista+ each frame may be
// a PNG, which is what we write — one PNG per requested size, so a single icon
// file carries every resolution Windows asks for.
//
// Reading is the messier half: frames may be PNG *or* a headerless BMP ("DIB")
// whose stored height is doubled because a 1-bit transparency mask is appended
// after the colour data. Both are handled.

const { decodeBmp } = require("./bmp");

const DIR = 6;   // ICONDIR size
const ENTRY = 16; // ICONDIRENTRY size
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Sizes Windows actually asks for, smallest to largest.
const STANDARD_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Build an .ico from pre-rendered PNG frames.
 * @param {Array<{size:number, png:Buffer}>} frames
 */
function encodeIco(frames) {
  const list = frames.filter((f) => f && f.png && f.png.length).sort((a, b) => a.size - b.size);
  if (!list.length) throw new Error("ICO: no frames to write.");
  if (list.length > 255) throw new Error("ICO: too many frames.");

  const header = Buffer.alloc(DIR + ENTRY * list.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon (2 would be a cursor)
  header.writeUInt16LE(list.length, 4);

  let offset = header.length;
  list.forEach((f, i) => {
    const at = DIR + i * ENTRY;
    // 256 is stored as 0 — the field is a single byte.
    header[at] = f.size >= 256 ? 0 : f.size;
    header[at + 1] = f.size >= 256 ? 0 : f.size;
    header[at + 2] = 0; // palette count (0 = truecolour)
    header[at + 3] = 0; // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(f.png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += f.png.length;
  });

  return Buffer.concat([header, ...list.map((f) => f.png)], offset);
}

const isIco = (buf) =>
  buf.length >= DIR && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1 && buf.readUInt16LE(4) > 0;

/** List the frames in an .ico without decoding them. */
function listIcoFrames(buf) {
  if (!isIco(buf)) throw new Error("Not an ICO file.");
  const count = buf.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const at = DIR + i * ENTRY;
    if (at + ENTRY > buf.length) break;
    frames.push({
      width: buf[at] === 0 ? 256 : buf[at],
      height: buf[at + 1] === 0 ? 256 : buf[at + 1],
      bytes: buf.readUInt32LE(at + 8),
      offset: buf.readUInt32LE(at + 12),
    });
  }
  if (!frames.length) throw new Error("ICO: no frames.");
  return frames;
}

// A frame's DIB has no BMP file header and claims twice its real height (colour
// rows + mask rows). Rebuild a normal BMP around it so the shared decoder works.
function decodeDibFrame(dib) {
  const dibSize = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  const height = Math.abs(dib.readInt32LE(8)) >> 1; // stored doubled
  const bpp = dib.readUInt16LE(14);
  let clrUsed = dib.readUInt32LE(32);
  if (bpp <= 8 && !clrUsed) clrUsed = 1 << bpp;
  const paletteBytes = bpp <= 8 ? clrUsed * 4 : 0;
  const pixelStart = dibSize + paletteBytes;

  const colourRow = ((bpp * width + 31) >> 5) << 2;
  const colourBytes = colourRow * height;

  const file = Buffer.alloc(14 + pixelStart + colourBytes);
  file.write("BM", 0, "latin1");
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(14 + pixelStart, 10);
  dib.copy(file, 14, 0, pixelStart);
  file.writeInt32LE(height, 14 + 8); // patch the doubled height
  dib.copy(file, 14 + pixelStart, pixelStart, pixelStart + colourBytes);

  const img = decodeBmp(file);

  // Apply the trailing 1-bit AND mask (set bit = transparent) for depths that
  // carry no alpha of their own.
  if (bpp < 32) {
    const maskRow = ((width + 31) >> 5) << 2;
    const maskStart = pixelStart + colourBytes;
    for (let y = 0; y < height; y += 1) {
      const row = maskStart + (height - 1 - y) * maskRow; // mask is bottom-up
      for (let x = 0; x < width; x += 1) {
        const byte = dib[row + (x >> 3)];
        if (byte === undefined) continue;
        if ((byte >> (7 - (x & 7))) & 1) img.data[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
  return img;
}

/**
 * Decode the largest frame of an .ico.
 * Returns either { png } (hand straight to sharp) or raw { data, width, height, channels }.
 */
function decodeIco(buf) {
  const frames = listIcoFrames(buf);
  const best = frames.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const payload = buf.subarray(best.offset, best.offset + best.bytes);
  if (payload.length < 8) throw new Error("ICO: truncated frame.");
  if (payload.subarray(0, 8).equals(PNG_SIG)) return { png: payload };
  return decodeDibFrame(payload);
}

module.exports = { encodeIco, decodeIco, listIcoFrames, isIco, STANDARD_SIZES };
